/**
 * 牌力评估（成员 A 的算法模块）。
 * 对一种组法（Arrangement）从四个维度打分：手数、单牌、炸弹、控制力。
 */
import {
  Arrangement, DEFAULT_EVAL_WEIGHTS, Evaluator, EvalWeights,
  isWild, rankOf, rankValue,
} from "../types.js";

export class HandEvaluator implements Evaluator {
  weights: EvalWeights;

  constructor(weights: EvalWeights = { ...DEFAULT_EVAL_WEIGHTS }) {
    this.weights = weights;
  }

  score(arr: Arrangement, level: string): number {
    const w = this.weights;
    let s = 0;
    // 手数：越少越好
    s += arr.handsCount * w.perHand;
    // 单牌：数量惩罚 + 小单牌（<T 且非级牌/万能牌）额外惩罚
    s += arr.singles.length * w.perSingle;
    for (const c of arr.singles) {
      if (!isWild(c, level) && rankValue(rankOf(c), level) < 10) {
        s += w.smallSingle;
      }
    }
    // 炸弹与威慑
    s += arr.bombCount * w.perBomb;
    // 控制牌（大王/小王/级牌等能夺出牌权的牌）
    s += arr.controlCount * w.perControl;
    return s;
  }
}

/** 统计一手牌里的控制牌数量（王与级牌） */
export function countControls(cards: string[], level: string): number {
  let n = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === "B" || r === "R" || (r === level && !isWild(c, level))) n++;
  }
  return n;
}
