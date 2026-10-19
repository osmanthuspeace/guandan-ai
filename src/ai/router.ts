/**
 * 顶层路由：按阶段分发到 贡还牌 / 末局搜索 / 出牌牌理。
 * 残局触发：任一未出完玩家（含自己）剩余牌数 ≤ threshold。
 */
import { Action, GameState, Policy } from "../types.js";
import { CardTracker } from "../search/tracker.js";
import { EndgameOptions, EndgameSearch } from "../search/endgame.js";
import { RulePolicy } from "../policy/rule.js";
import { TributePolicy } from "../policy/tribute.js";

export class RouterPolicy implements Policy {
  readonly name = "router";
  readonly tracker = new CardTracker();
  private tribute = new TributePolicy();
  private rule: RulePolicy;
  private endgame: EndgameSearch;
  private threshold: number;
  private useEndgame: boolean;

  constructor(opts: EndgameOptions & {
    endgameThreshold?: number; useEndgame?: boolean; rule?: RulePolicy;
  } = {}) {
    this.endgame = new EndgameSearch(this.tracker, opts);
    this.rule = opts.rule ?? new RulePolicy();
    this.threshold = opts.endgameThreshold ?? 10;
    this.useEndgame = opts.useEndgame ?? true;
  }

  chooseAction(state: GameState, actions: Action[]): number {
    this.tracker.update(state);
    if (state.stage !== "play") return this.tribute.chooseAction(state, actions);
    const minRest = Math.min(
      state.handCards.length,
      ...state.publicInfo
        .filter((_, p) => p !== state.myPos && !state.finished.includes(p))
        .map((pi) => pi.rest),
    );
    if (this.useEndgame && minRest <= this.threshold
        && state.publicInfo.some((pi) => pi.rest <= this.threshold)) {
      return this.endgame.chooseAction(state, actions);
    }
    return this.rule.chooseAction(state, actions);
  }
}
