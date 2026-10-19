/**
 * 组牌算法（成员 B）。
 * 思路：先整后零——炸弹/同花顺 > 顺子/三连对/钢板 > 三带二 > 对子/三张 > 单张；
 * 逢人配逐个尝试"最赚的位置"（补炸弹 > 补顺子 > 配大单牌）。
 * 生成若干候选组法，调用 A 的 Evaluator 比选。
 */
import {
  Arrangement, CardLabel, Evaluator, HandGroup,
  SEQ_VALUE, isWild, rankOf, suitOf,
} from "../types.js";
import { countControls } from "./evaluate.js";
import { groupByRank } from "./patterns.js";

interface Pool {
  byRank: Map<string, CardLabel[]>; // 自然牌按点数
  wilds: CardLabel[];
}

function takeRank(pool: Pool, rank: string, n: number): CardLabel[] {
  const arr = pool.byRank.get(rank) ?? [];
  const take = arr.splice(0, n);
  if (arr.length === 0) pool.byRank.delete(rank);
  return take;
}

function buildArrangement(groups: HandGroup[], level: string): Arrangement {
  const singles = groups.filter((g) => g.pattern === "Single").flatMap((g) => g.cards);
  const bombs = groups.filter(
    (g) => g.pattern === "Bomb" || g.pattern === "StraightFlush" || g.pattern === "FourKings",
  );
  const all = groups.flatMap((g) => g.cards);
  return {
    groups,
    handsCount: groups.length,
    singles,
    bombCount: bombs.length,
    controlCount: countControls(
      singles.concat(groups.filter((g) => g.pattern !== "Bomb").flatMap((g) => g.cards)),
      level,
    ),
  };
}

/** 在 pool 中尝试抽一条顺子（可用 1 张万能牌补缺），成功返回该组 */
function tryExtractStraight(pool: Pool): HandGroup | null {
  const ranks = [...pool.byRank.keys()];
  // A 有双身份：既当 1（A2345）也当 14（10JQKA），两个位置都登记
  const seqVals = new Map<number, string>();
  for (const r of ranks) {
    if (r === "A") {
      seqVals.set(1, "A");
      seqVals.set(14, "A");
    } else {
      seqVals.set(SEQ_VALUE[r], r);
    }
  }
  for (let lo = 1; lo <= 10; lo++) {
    const window: string[] = [];
    let miss = 0;
    for (let v = lo; v < lo + 5; v++) {
      const r = seqVals.get(v);
      if (r) window.push(r); else miss++;
    }
    if (miss <= pool.wilds.length && window.length + miss === 5 && miss <= 1) {
      const cards: CardLabel[] = [];
      for (const r of window) cards.push(...takeRank(pool, r, 1));
      for (let i = 0; i < miss; i++) cards.push(pool.wilds.pop()!);
      return { pattern: "Straight", rank: window[window.length - 1], cards };
    }
  }
  return null;
}

/** 贪心组牌的可调行为：不同取值组合产出不同候选组法，交给 Evaluator 比选 */
interface GreedyOptions {
  preferStraight?: boolean;      // 是否抽顺子（默认 true）
  straightLate?: boolean;        // 顺子放到三张/对子之后兜底抽（默认 false：炸后即抽，保顺子）
  wildBomb?: boolean;            // 逢人配优先补炸弹（默认 true；false 则留给顺子/配大单）
  bigPairWithTrips?: boolean;    // 三带二配大对子（默认 false：配最小对子，保留大对子）
}

/** 连续抽顺子，直到抽不出为止（每条最多用 1 张万能牌） */
function extractStraights(pool: Pool, groups: HandGroup[]): void {
  let g = tryExtractStraight(pool);
  let guard = 0;
  while (g && guard++ < 6) { groups.push(g); g = tryExtractStraight(pool); }
}

/** 贪心组一版：优先炸弹，其余顺序由 opts 决定 */
function greedyArrange(hand: CardLabel[], level: string, opts: GreedyOptions): Arrangement {
  const {
    preferStraight = true, straightLate = false,
    wildBomb = true, bigPairWithTrips = false,
  } = opts;
  const pool: Pool = {
    byRank: groupByRank(hand.filter((c) => !isWild(c, level))),
    wilds: hand.filter((c) => isWild(c, level)),
  };
  const groups: HandGroup[] = [];

  // 1. 四王
  const jokers = hand.filter((c) => c[1] === "B" || c[1] === "R");
  if (jokers.length === 4) {
    for (const j of jokers) takeRank(pool, j[1], 1);
    groups.push({ pattern: "FourKings", rank: "R", cards: jokers });
  }
  // 2. 自然炸弹（4 张及以上同点）
  for (const [r, arr] of [...pool.byRank.entries()]) {
    if (arr.length >= 4) {
      groups.push({ pattern: "Bomb", rank: r, cards: takeRank(pool, r, arr.length) });
    }
  }
  // 3. 万能牌补炸弹：三张 + 1 万能 = 4 炸（最赚的位置）
  if (wildBomb && pool.wilds.length > 0) {
    for (const [r, arr] of [...pool.byRank.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      if (arr.length === 3 && pool.wilds.length > 0) {
        const cards = takeRank(pool, r, 3);
        cards.push(pool.wilds.pop()!);
        groups.push({ pattern: "Bomb", rank: r, cards });
      }
    }
  }
  // 4. 顺子（早抽：优先保顺子）
  if (preferStraight && !straightLate) extractStraights(pool, groups);
  // 5. 三带二
  for (const [r, arr] of [...pool.byRank.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    if (arr.length >= 3) {
      const pairEntry = [...pool.byRank.entries()]
        .filter(([pr, pa]) => pr !== r && pa.length >= 2)
        .sort((a, b) => bigPairWithTrips
          ? SEQ_VALUE[b[0]] - SEQ_VALUE[a[0]]
          : SEQ_VALUE[a[0]] - SEQ_VALUE[b[0]])[0];
      if (pairEntry) {
        const cards = takeRank(pool, r, 3).concat(takeRank(pool, pairEntry[0], 2));
        groups.push({ pattern: "ThreeWithTwo", rank: r, cards });
      }
    }
  }
  // 6. 三张、对子
  for (const [r, arr] of [...pool.byRank.entries()]) {
    if (arr.length >= 3) groups.push({ pattern: "Trips", rank: r, cards: takeRank(pool, r, 3) });
  }
  for (const [r, arr] of [...pool.byRank.entries()]) {
    while ((pool.byRank.get(r)?.length ?? 0) >= 2) {
      groups.push({ pattern: "Pair", rank: r, cards: takeRank(pool, r, 2) });
    }
  }
  // 6.5 顺子（晚抽：对子/三张先保，顺子用散牌兜底）
  if (preferStraight && straightLate) extractStraights(pool, groups);
  // 7. 剩余万能牌配最大单张成对，否则成单
  for (const [r, arr] of [...pool.byRank.entries()].sort(
    (a, b) => SEQ_VALUE[b[0]] - SEQ_VALUE[a[0]],
  )) {
    if (pool.wilds.length > 0 && arr.length >= 1) {
      const cards = takeRank(pool, r, 1);
      cards.push(pool.wilds.pop()!);
      groups.push({ pattern: "Pair", rank: r, cards });
    }
  }
  while (pool.wilds.length > 0) {
    groups.push({ pattern: "Single", rank: level, cards: [pool.wilds.pop()!] });
  }
  // 8. 剩余单张
  for (const [r, arr] of pool.byRank.entries()) {
    for (const c of arr) groups.push({ pattern: "Single", rank: r, cards: [c] });
  }
  return buildArrangement(groups, level);
}

/**
 * 组牌缓存：同一手牌（多重集合相同）在同一等级、同一评估权重下结果不变，
 * 而玩家在未出牌/被压过的连续决策点会用同一手牌反复组牌，缓存可直接命中。
 * 键 = 等级 | 权重指纹 | 排序后的手牌；简单 FIFO 限量防膨胀。
 */
const arrangeCache = new Map<string, Arrangement>();
const ARRANGE_CACHE_LIMIT = 1024;

function cacheKey(hand: CardLabel[], level: string, ev: Evaluator): string {
  const w = ev.weights;
  const sorted = [...hand].sort().join(",");
  const fp = `${w.perHand},${w.perSingle},${w.smallSingle},${w.perBomb},${w.perControl}`;
  return `${level}|${fp}|${sorted}`;
}

/**
 * 生成 5 套候选组法（顺子优先 / 不顺子 / 顺子兜底 / 逢人配不补炸 / 三带二配大对），
 * 用 Evaluator 比选返回最优组法；结果按 (手牌, 等级, 权重) 缓存。
 */
export function arrange(hand: CardLabel[], level: string, evaluator: Evaluator): Arrangement {
  const key = cacheKey(hand, level, evaluator);
  const hit = arrangeCache.get(key);
  if (hit) return hit;

  const variants: GreedyOptions[] = [
    { preferStraight: true },
    { preferStraight: false },
    { preferStraight: true, straightLate: true },
    { preferStraight: true, wildBomb: false },
    { preferStraight: true, bigPairWithTrips: true },
  ];
  const candidates = variants.map((o) => greedyArrange(hand, level, o));

  let best = candidates[0], bestScore = -Infinity;
  for (const c of candidates) {
    const s = evaluator.score(c, level);
    if (s > bestScore) { bestScore = s; best = c; }
  }

  arrangeCache.set(key, best);
  if (arrangeCache.size > ARRANGE_CACHE_LIMIT) {
    const oldest = arrangeCache.keys().next().value;
    if (oldest !== undefined) arrangeCache.delete(oldest);
  }
  return best;
}
