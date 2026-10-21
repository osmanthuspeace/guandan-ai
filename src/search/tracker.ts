/**
 * 记牌器（成员 C）：全量跟踪 108 张牌的出现情况。
 * 原理：未见过的牌 = 全副牌 − 我手上 − 已打出（含贡品明牌）。
 */
import {
  Action, CardLabel, GameState, PlayRecord, RANKS, SUITS, TrackerView, isPass,
} from "../types.js";

/** 构造全副 108 张牌 */
export function fullDeck(): CardLabel[] {
  const deck: CardLabel[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const s of SUITS) for (const r of RANKS) deck.push(s + r);
    deck.push("SB", "HR");
  }
  return deck;
}

export class CardTracker implements TrackerView {
  /** 本局已打出/明牌的出现次数（key 为牌面字符串，两副牌同面最多 2 次） */
  private seen = new Map<CardLabel, number>();
  /** 我当前手牌的出现次数（每次 update 整体替换，不累计） */
  private hand = new Map<CardLabel, number>();
  private records: PlayRecord[] = [];

  reset(): void {
    this.seen.clear();
    this.records = [];
  }

  /** 每轮决策前调用：登记我的手牌 + 增量历史；history 变短说明跨局了，先重置 */
  update(state: GameState): void {
    if (state.history.length < this.records.length) this.reset();
    this.hand = new Map();
    for (const c of state.handCards) this.hand.set(c, (this.hand.get(c) ?? 0) + 1);
    for (const rec of state.history.slice(this.records.length)) {
      this.records.push(rec);
      if (!isPass(rec.action)) {
        for (const c of rec.action[2]) this.markSeen(c); // 出牌与贡还明牌都记
      }
    }
  }

  private markSeen(c: CardLabel): void {
    this.seen.set(c, (this.seen.get(c) ?? 0) + 1);
  }

  /** 未见过的牌（在另外三家手中）= 2 − 本局已打出 − 我手上 */
  unseenCards(_excludeHand: CardLabel[] = []): CardLabel[] {
    const res: CardLabel[] = [];
    const m = new Map<CardLabel, number>();
    for (const c of fullDeck()) {
      m.set(c, 2 - (this.seen.get(c) ?? 0) - (this.hand.get(c) ?? 0));
    }
    for (const [c, n] of m) for (let i = 0; i < n; i++) res.push(c);
    return res;
  }

  unseenCountByRank(rank: string): number {
    let n = 0;
    for (const c of this.unseenCards([])) if (c[1] === rank) n++;
    return n;
  }

  passHistory(pos: number): Action[] {
    return this.records.filter((r) => r.pos === pos && isPass(r.action)).map((r) => r.action);
  }

  playHistory(pos: number): Action[] {
    return this.records.filter((r) => r.pos === pos && !isPass(r.action)).map((r) => r.action);
  }
}
