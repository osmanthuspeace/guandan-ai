/**
 * 末局搜索（成员 C）。
 * 三步：猜牌（约束采样：历史 PASS 推断的持牌上限过滤）、
 * 每种假设下拟人 rollout 到底（每个座位都用牌理同款评分器从自己的视角选招）、
 * 得票最高者定案。
 *
 * 简化假设：
 * - 模拟器只生成 单/对/三张/三带二/炸弹/四王，不生成顺子类长牌型（控制分支因子）；
 * - 逢人配在模拟中按原点数参与，不展开配牌可能。
 */
import {
  Action, ActionWeights, CardLabel, GameState, Policy, TrackerView,
  DEFAULT_ACTION_WEIGHTS,
  isPass, rankValue, removeCards,
} from "../types.js";
import { groupByRank } from "../policy/patterns.js";
import { HandEvaluator } from "../policy/evaluate.js";
import { scorePlayAction } from "../policy/actionEval.js";
import { countViolations, extractCaps } from "./constraints.js";

// 采样：把未见牌按各自剩余张数分给其他三家
// 有历史 PASS 约束时做拒绝采样：多次重试，取违反约束最少的分法

const SAMPLE_TRIES = 40;

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sampleHands(
  state: GameState, tracker: TrackerView, rng: () => number = Math.random,
): CardLabel[][] {
  const pool = tracker.unseenCards([]);
  const caps = extractCaps(state);
  const constrained = caps.some(Boolean);
  let best: CardLabel[][] | null = null;
  let bestBad = Infinity;

  for (let t = 0; t < (constrained ? SAMPLE_TRIES : 1); t++) {
    const unseen = shuffle(pool, rng);
    const hands: CardLabel[][] = [[], [], [], []];
    hands[state.myPos] = [...state.handCards];
    let idx = 0;
    for (let seat = 0; seat < 4; seat++) {
      if (seat === state.myPos) continue;
      const need = state.publicInfo[seat].rest;
      hands[seat] = unseen.slice(idx, idx + need);
      idx += need;
    }
    if (!constrained) return hands;
    const bad = countViolations(hands, caps, state.curRank, state.myPos);
    if (bad === 0) return hands;
    if (bad < bestBad) { bestBad = bad; best = hands; }
  }
  return best!; // 约束互相打架时取违约最少的分法（best-effort）
}

// 炸弹等级：4炸40 < 5炸50 < 同花顺55 < 6炸60 ... < 四王90

function bombLevel(a: Action): number {
  if (a[0] === "FourKings") return 90;
  if (a[0] === "StraightFlush") return 55;
  if (a[0] === "Bomb") return a[2].length * 10;
  return 0;
}

/** a 能否压 b（b 为 null 表示自由出牌） */
export function canBeat(a: Action, b: Action | null, level: string): boolean {
  if (isPass(a)) return false;
  if (!b || isPass(b)) return true;
  const la = bombLevel(a), lb = bombLevel(b);
  if (la > 0 || lb > 0) {
    if (la === 0) return false;
    if (lb === 0) return true;
    if (la !== lb) return la > lb;
    return rankValue(a[1], level) > rankValue(b[1], level);
  }
  if (a[0] !== b[0] || a[2].length !== b[2].length) return false;
  return rankValue(a[1], level) > rankValue(b[1], level);
}

// 模拟器：简化的合法动作生成（不生成顺子类长牌型，控制分支因子）

export function genMoves(hand: CardLabel[], level: string, greater: Action | null): Action[] {
  const byRank = groupByRank(hand.filter((c) => c[1] !== "B" && c[1] !== "R"));
  const jokers = hand.filter((c) => c[1] === "B" || c[1] === "R");
  const moves: Action[] = [];
  const ranks = [...byRank.keys()].sort((x, y) => rankValue(x, level) - rankValue(y, level));

  for (const r of ranks) {
    const cs = byRank.get(r)!;
    if (cs.length >= 1) moves.push(["Single", r, [cs[0]]]);
    if (cs.length >= 2) moves.push(["Pair", r, cs.slice(0, 2)]);
    if (cs.length >= 3) moves.push(["Trips", r, cs.slice(0, 3)]);
    if (cs.length >= 4) moves.push(["Bomb", r, cs.slice(0, cs.length)]);
  }
  // 三带二（三张配最小对子）
  for (const r of ranks) {
    const cs = byRank.get(r)!;
    if (cs.length >= 3) {
      const pair = ranks.find((p) => p !== r && (byRank.get(p)?.length ?? 0) >= 2);
      if (pair) {
        moves.push(["ThreeWithTwo", r, cs.slice(0, 3).concat(byRank.get(pair)!.slice(0, 2))]);
      }
    }
  }
  for (const j of jokers) moves.push(["Single", j[1], [j]]);
  if (jokers.length === 4) moves.push(["FourKings", "R", [...jokers]]);

  const legal = moves.filter((m) => canBeat(m, greater, level));
  if (greater && !isPass(greater)) legal.unshift(["PASS", "PASS", ["PASS"]]);
  return legal;
}

// 推算：拟人 rollout（PIMC），所有座位用同一套牌理评分器选招，推演到底

interface SimState {
  hands: CardLabel[][];
  turn: number;
  greater: Action | null;
  greaterPos: number;
  passCount: number;
  order: number[]; // 已出完的名次顺序
}

function payoff(order: number[], rootPos: number): number {
  const partner = (rootPos + 2) % 4;
  // 推算在 3 家出完时停止，剩余一家不在 order 中：他就是末游（第 4 名）
  const rank = (p: number) => {
    const i = order.indexOf(p);
    return i === -1 ? 3 : i;
  };
  const myFirst = Math.min(rank(rootPos), rank(partner));
  const mySecond = Math.max(rank(rootPos), rank(partner));
  if (myFirst === 0 && mySecond === 1) return 3;
  if (myFirst === 0 && mySecond === 2) return 2;
  if (myFirst === 0) return 1; // 含 头游+末游
  return 0;
}

function nextActive(s: SimState, from: number): number {
  for (let i = 1; i <= 4; i++) {
    const p = (from + i) % 4;
    if (!s.order.includes(p)) return p;
  }
  return from;
}

/**
 * me 行动后的状态推进：登记出完；若其余活跃玩家全 PASS 则一轮结束，
 * 由领先者领出；领先者已出完则对家接风（对家也出完则顺时针顺延）。
 */
function afterPlay(ns: SimState, me: number): void {
  if (ns.hands[me].length === 0 && !ns.order.includes(me)) ns.order.push(me);
  if (ns.passCount >= 3 - ns.order.length) {
    ns.greater = null;
    ns.passCount = 0;
    if (!ns.order.includes(ns.greaterPos)) {
      ns.turn = ns.greaterPos;
    } else {
      const partner = (ns.greaterPos + 2) % 4;
      ns.turn = ns.order.includes(partner) ? nextActive(ns, ns.greaterPos) : partner;
    }
  } else {
    ns.turn = nextActive(ns, me);
  }
}

/** 应用一个动作并推进状态（出完登记 / 轮次结束 / 接风） */
function applyMove(s: SimState, me: number, m: Action): SimState {
  const ns: SimState = {
    hands: s.hands.map((h, i) => (i === me ? removeCards(h, m[2]) : h)),
    turn: me, greater: s.greater, greaterPos: s.greaterPos,
    passCount: s.passCount, order: [...s.order],
  };
  if (isPass(m)) {
    ns.passCount++;
  } else {
    ns.passCount = 0;
    ns.greater = m;
    ns.greaterPos = me;
  }
  afterPlay(ns, me);
  return ns;
}

/**
 * 拟人 rollout：推演到底，每个座位都用牌理同款评分器（scorePlayAction）
 * 从自己的视角选招。对手不"透视"我方手牌，避免 paranoid 搜索的悲观偏差。
 */
export function rollout(
  s: SimState, level: string, rootPos: number,
  ev: HandEvaluator, aw: ActionWeights, maxPlies: number,
): number {
  for (let ply = 0; ply < maxPlies; ply++) {
    if (s.order.length >= 3) return payoff(s.order, rootPos) * 100;
    const me = s.turn;
    const moves = genMoves(s.hands[me], level, s.greater);
    if (moves.length === 0) return 0; // 不应发生：活跃玩家恒有 PASS 或可出的牌
    // 从 me 的视角构造评分状态（模拟中各家剩余张数已知）
    const view: GameState = {
      myPos: me, handCards: s.hands[me],
      publicInfo: s.hands.map((h) => ({ rest: h.length })),
      selfRank: level, oppoRank: level, curRank: level,
      curPos: me,
      greaterPos: s.greater === null ? -1 : s.greaterPos,
      curAction: s.greater, greaterAction: s.greater,
      history: [], finished: s.order, stage: "play",
    };
    let bestMove = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const sc = scorePlayAction(view, m, ev, aw);
      if (sc > bestScore) { bestScore = sc; bestMove = m; }
    }
    s = applyMove(s, me, bestMove);
  }
  // 步数兜底（正常不会到这）：按双方剩余牌差估值
  const partner = (rootPos + 2) % 4;
  const mine = s.hands[rootPos].length + s.hands[partner].length;
  const opp = s.hands[(rootPos + 1) % 4].length + s.hands[(rootPos + 3) % 4].length;
  return (opp - mine) * 2;
}

// Policy：采样 K 次，候选动作逐个推算，平均收益最高者胜出

export interface EndgameOptions {
  samples?: number;      // 猜牌次数基数，默认 24（未见牌越少实际采样越多）
  maxCandidates?: number;// 每次最多评估几个候选动作，默认 6
  maxPlies?: number;     // 单次 rollout 的最大步数兜底，默认 100
  timeMs?: number;       // 总时间上限，默认 1500ms
  overrideMargin?: number; // 搜索覆盖牌理首选所需的最小均值差，默认 25
}

export class EndgameSearch implements Policy {
  readonly name = "endgame";
  private tracker: TrackerView;
  private opts: Required<EndgameOptions>;
  private preEv = new HandEvaluator();      // 候选预筛与 rollout 选招共用（与牌理同套评估器）
  private preAw = DEFAULT_ACTION_WEIGHTS;

  constructor(tracker: TrackerView, opts: EndgameOptions = {}) {
    this.tracker = tracker;
    this.opts = {
      samples: opts.samples ?? 24,
      maxCandidates: opts.maxCandidates ?? 6,
      maxPlies: opts.maxPlies ?? 100,
      timeMs: opts.timeMs ?? 1500,
      overrideMargin: opts.overrideMargin ?? 25,
    };
  }

  chooseAction(state: GameState, actions: Action[]): number {
    if (actions.length === 1) return 0;
    // 候选预筛：全部动作用牌理评分器打分取前 K（不再按牌数粗排，
    // 避免残局正确的小牌控场打法被挤出候选集）；跟牌时 PASS 必留。
    const passIdx = actions.findIndex(isPass);
    const pre = new Map<number, number>(
      actions.map((a, i) => [i, scorePlayAction(state, a, this.preEv, this.preAw)]),
    );
    const candIdx = [...pre.keys()].sort((x, y) => pre.get(y)! - pre.get(x)!)
      .slice(0, this.opts.maxCandidates);
    if (passIdx >= 0 && !candIdx.includes(passIdx)
        && state.greaterPos !== -1 && state.greaterPos !== state.myPos) {
      candIdx.push(passIdx);
    }
    if (candIdx.length === 0) return 0;
    // 预评分最高者：搜索样本不足时的安全回退
    let preBest = candIdx[0];
    for (const i of candIdx) if (pre.get(i)! > pre.get(preBest)!) preBest = i;

    // 本轮已有的连续 PASS 数（历史尾部），用于正确模拟"我 PASS 后是否一轮结束"
    let trailingPasses = 0;
    for (let i = state.history.length - 1; i >= 0; i--) {
      if (isPass(state.history[i].action)) trailingPasses++;
      else break;
    }

    // 自适应采样：其他家未见牌越少，采样空间越小，加采样让均值收敛
    const unseen = state.publicInfo.reduce((s, pi, p) =>
      p === state.myPos || state.finished.includes(p) ? s : s + pi.rest, 0);
    const targetSamples = unseen <= 12 ? this.opts.samples * 2
      : unseen <= 20 ? Math.ceil(this.opts.samples * 1.5)
      : this.opts.samples;

    const deadline = Date.now() + this.opts.timeMs;
    const total = new Map<number, number>(candIdx.map((i) => [i, 0]));
    let doneSamples = 0;

    for (let s = 0; s < targetSamples && Date.now() < deadline; s++) {
      const hands = sampleHands(state, this.tracker);
      for (const i of candIdx) {
        if (Date.now() >= deadline) break;
        const a = actions[i];
        const sim: SimState = {
          hands: hands.map((h, seat) =>
            seat === state.myPos ? removeCards(h, a[2]) : h),
          turn: state.myPos, greater: state.greaterAction, greaterPos: state.greaterPos,
          passCount: 0, order: [...state.finished],
        };
        if (isPass(a)) {
          sim.passCount = trailingPasses + 1;
        } else {
          sim.greater = a;
          sim.greaterPos = state.myPos;
        }
        afterPlay(sim, state.myPos);
        const v = sim.order.length >= 3
          ? payoff(sim.order, state.myPos) * 100
          : rollout(sim, state.curRank, state.myPos, this.preEv, this.preAw, this.opts.maxPlies);
        total.set(i, total.get(i)! + v);
      }
      doneSamples++;
    }
    if (doneSamples < 4) return preBest; // 时间耗尽/样本太少：搜索结果是噪声，回退牌理
    let best = candIdx[0], bestAvg = -Infinity;
    for (const i of candIdx) {
      const avg = total.get(i)! / doneSamples;
      if (avg > bestAvg) { bestAvg = avg; best = i; }
    }
    // 覆盖裕度：只有搜索均值显著更好才推翻牌理首选，避免噪声覆盖
    if (best !== preBest) {
      const preAvg = total.get(preBest)! / doneSamples;
      if (bestAvg - preAvg < this.opts.overrideMargin) return preBest;
    }
    return best;
  }
}
