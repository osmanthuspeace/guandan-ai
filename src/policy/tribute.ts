/**
 * 贡还牌决策（成员 B 的算法模块）。
 * 进贡：规则强制给最大牌，可选时给损失最小的；
 * 还贡：只能还 ≤10 的牌，优先还"废牌"（小单张，不拆对子/顺子）。
 */
import { Action, GameState, Policy, rankOf, rankValue } from "../types.js";
import { groupByRank } from "./patterns.js";

export class TributePolicy implements Policy {
  readonly name = "tribute";

  chooseAction(state: GameState, actions: Action[]): number {
    if (state.stage === "tribute") return this.chooseTribute(state, actions);
    return this.chooseBack(state, actions);
  }

  /** 进贡：一般只有一项可选；有多项（同点数多张）时避开红桃级牌 */
  private chooseTribute(state: GameState, actions: Action[]): number {
    if (actions.length === 1) return 0;
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < actions.length; i++) {
      const card = actions[i][2][0];
      // 非红桃花色优先（保留逢人配的可能性——虽然规则上逢人配不必进贡，防御性处理）
      const s = card[0] === "H" ? -1 : 0;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
  }

  /**
   * 还贡打分：还出的牌越"废"越好。
   * 小点数、单张（拆散度低）优先；绝不拆对子/三张（由"重复度惩罚"体现）。
   */
  private chooseBack(state: GameState, actions: Action[]): number {
    const byRank = groupByRank(state.handCards);
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < actions.length; i++) {
      const card = actions[i][2][0];
      const r = rankOf(card);
      let s = 0;
      // 点数越小越好（还贡牌 ≤10）
      s -= rankValue(r, "") * 2;
      // 手中有同点数牌（还掉会破坏对子/三张）重罚
      const dup = (byRank.get(r)?.length ?? 1) - 1;
      s -= dup * 15;
      // 还给队友方向（下家是我方队友时无所谓，正常小牌即可）——保持简单
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
  }
}
