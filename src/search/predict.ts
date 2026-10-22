/**
 * 手牌预测（成员 C）：排除法估计各座位的握炸嫌疑。
 * 原则：只写有把握的推断，某点数未见过 ≥4 张才可能有炸；
 * "不要"过该点数相关牌型的座位嫌疑下调。
 */
import { GameState, RANKS, TrackerView } from "../types.js";

export interface Prediction {
  /** 各座位握有炸弹的嫌疑值 0~1（座位号为下标） */
  bombRisk: [number, number, number, number];
  /** 未见牌中可能凑成炸弹的点数 */
  suspectedBombRanks: string[];
}

export function predict(state: GameState, tracker: TrackerView): Prediction {
  const unseen = tracker.unseenCards([]);
  const unseenTotal = unseen.length || 1;
  const bombRisk: [number, number, number, number] = [0, 0, 0, 0];
  const suspectedBombRanks: string[] = [];

  for (const r of RANKS) {
    const cnt = tracker.unseenCountByRank(r);
    if (cnt < 4) continue; // 不够 4 张，凑不出炸
    suspectedBombRanks.push(r);
    for (let seat = 0; seat < 4; seat++) {
      if (seat === state.myPos || state.finished.includes(seat)) continue;
      const rest = state.publicInfo[seat].rest;
      if (rest < 4) continue;
      // 基础嫌疑：该座位牌量占未见牌的比例 × 该点数剩余比例
      let risk = (rest / unseenTotal) * (cnt / 8);
      // 排除法：该座位曾在该点数的单张/对子上"不要" → 嫌疑下调
      const passed = tracker.passHistory(seat).length;
      risk *= Math.max(0.3, 1 - passed * 0.05);
      bombRisk[seat] = Math.min(1, bombRisk[seat] + risk);
    }
  }
  return { bombRisk, suspectedBombRanks };
}
