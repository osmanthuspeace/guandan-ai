/**
 * 末局搜索（成员 C）。
 * 三步：猜牌（按剩余牌分布采样对手手牌）→ 每种假设下推算到底
 * （我选最好、对手按最坏、队友按配合；剪枝砍掉没必要算的分支）→ 得票最高者定案。
 *
 * 简化假设（已在报告候选中声明）：
 * - 模拟器只生成 单/对/三张/三带二/炸弹/四王 动作，不生成顺子类长牌型（控制分支因子）；
 * - 接风规则简化为：领先者已出完时由其下家顺时针领出。
 */
import {
  Action, CardLabel, GameState, Policy, TrackerView,
  isBombLike, isPass, rankOf, rankValue, removeCards,
} from "../types.js";
import { groupByRank } from "../policy/patterns.js";

// ---------------------------------------------------------------------------
// 采样：把未见牌随机分给其他三家（按各自剩余张数）
// ---------------------------------------------------------------------------

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
  const unseen = shuffle(tracker.unseenCards([]), rng);
  const hands: CardLabel[][] = [[], [], [], []];
  hands[state.myPos] = [...state.handCards];
  let idx = 0;
  for (let seat = 0; seat < 4; seat++) {
    if (seat === state.myPos) continue;
    const need = state.publicInfo[seat].rest;
    hands[seat] = unseen.slice(idx, idx + need);
    idx += need;
  }
  return hands;
}

// ---------------------------------------------------------------------------
// 炸弹等级：4炸40 < 5炸50 < 同花顺55 < 6炸60 ... < 四王90
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 模拟器：简化合法动作生成
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 推算：我选最好、对手按最坏、队友按配合（paranoid 化简 + alpha-beta 剪枝）
// ---------------------------------------------------------------------------

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
  const myFirst = Math.min(order.indexOf(rootPos), order.indexOf(partner));
  const mySecond = Math.max(order.indexOf(rootPos), order.indexOf(partner));
  if (myFirst === 0 && mySecond === 1) return 3;
  if (myFirst === 0 && mySecond === 2) return 2;
  if (myFirst === 0) return 1;
  return 0;
}

function nextActive(s: SimState, from: number): number {
  for (let i = 1; i <= 4; i++) {
    const p = (from + i) % 4;
    if (!s.order.includes(p)) return p;
  }
  return from;
}

export function search(
  s: SimState, level: string, rootPos: number,
  alpha: number, beta: number, depth: number, budget: { nodes: number },
): number {
  if (--budget.nodes <= 0) return 0;
  if (s.order.length >= 3) return payoff(s.order, rootPos) * 100;
  if (depth <= 0) {
    // 深度截断启发：我方两队剩余牌差
    const partner = (rootPos + 2) % 4;
    const mine = s.hands[rootPos].length + s.hands[partner].length;
    const opp = s.hands[(rootPos + 1) % 4].length + s.hands[(rootPos + 3) % 4].length;
    return (opp - mine) * 2;
  }
  const me = s.turn;
  const isMine = me === rootPos || me === (rootPos + 2) % 4;
  const moves = genMoves(s.hands[me], level, s.greater)
    .sort((a, b) => (isBombLike(a) ? 1 : 0) - (isBombLike(b) ? 1 : 0)); // 炸弹后置
  let best = isMine ? -Infinity : Infinity;
  for (const m of moves) {
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
    if (ns.hands[me].length === 0 && !ns.order.includes(me)) ns.order.push(me);
    // 三家 PASS → 新的一轮，由领先者（或其下家）领出
    if (ns.passCount >= 3 - ns.order.length) {
      ns.greater = null;
      ns.passCount = 0;
      ns.turn = ns.order.includes(ns.greaterPos) ? nextActive(ns, ns.greaterPos) : ns.greaterPos;
    } else {
      ns.turn = nextActive(ns, me);
    }
    if (ns.order.length >= 4) break;
    const v = search(ns, level, rootPos, alpha, beta, depth - 1, budget);
    if (isMine) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break; // 剪枝：这条线没必要再算
  }
  return best === Infinity || best === -Infinity ? 0 : best;
}

// ---------------------------------------------------------------------------
// Policy：采样 K 次 × 候选动作逐个推算，平均收益最高者胜出
// ---------------------------------------------------------------------------

export interface EndgameOptions {
  samples?: number;      // 猜牌次数，默认 24
  maxCandidates?: number;// 每次最多评估几个候选动作，默认 6
  depth?: number;        // 推算深度，默认 16
  nodeBudget?: number;   // 单动作单样本节点上限，默认 4000
  timeMs?: number;       // 总时间上限，默认 1500ms
}

export class EndgameSearch implements Policy {
  readonly name = "endgame";
  private tracker: TrackerView;
  private opts: Required<EndgameOptions>;

  constructor(tracker: TrackerView, opts: EndgameOptions = {}) {
    this.tracker = tracker;
    this.opts = {
      samples: opts.samples ?? 24,
      maxCandidates: opts.maxCandidates ?? 6,
      depth: opts.depth ?? 16,
      nodeBudget: opts.nodeBudget ?? 4000,
      timeMs: opts.timeMs ?? 1500,
    };
  }

  chooseAction(state: GameState, actions: Action[]): number {
    if (actions.length === 1) return 0;
    // 候选：非 PASS 动作按"多牌优先、炸弹靠后"预排序取前 K，另保留 PASS
    const passIdx = actions.findIndex(isPass);
    const candIdx = actions
      .map((a, i) => ({ a, i }))
      .filter((x) => !isPass(x.a))
      .sort((x, y) =>
        (isBombLike(x.a) ? 1 : 0) - (isBombLike(y.a) ? 1 : 0) ||
        y.a[2].length - x.a[2].length)
      .slice(0, this.opts.maxCandidates)
      .map((x) => x.i);
    if (passIdx >= 0 && state.greaterPos !== -1 && state.greaterPos !== state.myPos) {
      candIdx.push(passIdx);
    }
    if (candIdx.length === 0) return 0;

    const deadline = Date.now() + this.opts.timeMs;
    const total = new Map<number, number>(candIdx.map((i) => [i, 0]));
    let doneSamples = 0;

    for (let s = 0; s < this.opts.samples && Date.now() < deadline; s++) {
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
          sim.passCount = 1;
        } else {
          sim.greater = a;
          sim.greaterPos = state.myPos;
        }
        if (sim.hands[state.myPos].length === 0 && !sim.order.includes(state.myPos)) {
          sim.order.push(state.myPos);
        }
        sim.turn = nextActive(sim, state.myPos);
        const budget = { nodes: this.opts.nodeBudget };
        const v = sim.order.length >= 3
          ? payoff(sim.order, state.myPos) * 100
          : search(sim, state.curRank, state.myPos, -Infinity, Infinity, this.opts.depth, budget);
        total.set(i, total.get(i)! + v);
      }
      doneSamples++;
    }
    let best = candIdx[0], bestAvg = -Infinity;
    for (const i of candIdx) {
      const avg = total.get(i)! / Math.max(1, doneSamples);
      if (avg > bestAvg) { bestAvg = avg; best = i; }
    }
    return best;
  }
}
