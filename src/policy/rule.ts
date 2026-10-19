/**
 * 出牌牌理（成员 B）：动作排序完全由 A 的动作评估驱动——
 * 基分为"出完这手后剩余手牌"的 Evaluator 组法分（见 actionEval.ts），
 * 仅叠加队友让牌 / 拦截紧迫度 / PASS 代价等少量局面修正。
 */
import {
  Action, ActionWeights, DEFAULT_ACTION_WEIGHTS,
  Evaluator, GameState, Policy,
} from "../types.js";
import { HandEvaluator } from "./evaluate.js";
import { scorePlayAction } from "./actionEval.js";

export class RulePolicy implements Policy {
  readonly name = "rule";
  private ev: Evaluator;
  private aw: ActionWeights;

  constructor(ev?: Evaluator, aw?: ActionWeights) {
    this.ev = ev ?? new HandEvaluator();
    this.aw = aw ?? { ...DEFAULT_ACTION_WEIGHTS };
  }

  chooseAction(state: GameState, actions: Action[]): number {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < actions.length; i++) {
      const s = scorePlayAction(state, actions[i], this.ev, this.aw);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
  }
}
