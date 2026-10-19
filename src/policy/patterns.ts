/**
 * 手牌工具：按点数分组。
 * 供组牌(arrange)、进贡(tribute)、末局搜索(endgame)共用。
 */
import { CardLabel, rankOf } from "../types.js";

/** 按点数分组（不含万能牌），返回 rank -> cards */
export function groupByRank(cards: CardLabel[]): Map<string, CardLabel[]> {
  const m = new Map<string, CardLabel[]>();
  for (const c of cards) {
    const r = rankOf(c);
    if (!m.has(r)) m.set(r, []);
    m.get(r)!.push(c);
  }
  return m;
}
