/**
 * 顶层路由：按阶段分发到 贡还牌 / 末局搜索 / 出牌牌理。
 * 残局触发（搜索只在采样方差可控时才有正收益）：
 * 所有未出完玩家剩余牌数 ≤ threshold，或其他玩家未见牌总数 ≤ 2×threshold。
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
    const rests = state.publicInfo.map((pi, p) =>
      p === state.myPos ? state.handCards.length : pi.rest);
    const active = rests.filter((_, p) => !state.finished.includes(p));
    const maxRest = Math.max(...active);
    const unseenOthers = active.reduce((s, r) => s + r, 0) - state.handCards.length;
    if (this.useEndgame
        && (maxRest <= this.threshold || unseenOthers <= this.threshold * 2)) {
      return this.endgame.chooseAction(state, actions);
    }
    return this.rule.chooseAction(state, actions);
  }
}
