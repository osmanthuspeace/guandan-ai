/**
 * 动作评估（成员 A）：让 Evaluator 直接参与出牌决策，替代手写经验加减分。
 * 原则：动作的基分 = 出掉这些牌后"剩余手牌重新组牌"的 Evaluator 分数——
 * 手数消减、单牌处理、拆弹损失、控制牌消耗全部由评估器统一定价；
 * 仅在静态手牌评估无法覆盖的地方叠加少量局面修正：
 * 队友领先让牌、对手逼近出完时的拦截紧迫度、PASS 的代价、一手出完封顶。
 */
import {
  Action, ActionWeights, Evaluator, GameState, isPass,
} from "../types.js";
import { arrange } from "./arrange.js";

export function scorePlayAction(
  state: GameState, a: Action, ev: Evaluator, aw: ActionWeights,
): number {
  const partner = (state.myPos + 2) % 4;
  const partnerWinning = state.greaterPos === partner && !state.finished.includes(partner);
  const opponents = [(state.myPos + 1) % 4, (state.myPos + 3) % 4];
  const minOppoRest = Math.min(
    ...opponents.filter((p) => !state.finished.includes(p))
      .map((p) => state.publicInfo[p].rest),
    99,
  );

  if (isPass(a)) {
    let s = partnerWinning ? aw.passPartner : 0;
    if (!partnerWinning && minOppoRest <= 2) s += aw.passDanger;
    return s;
  }

  const played = new Set(a[2]);
  const rest = state.handCards.filter((c) => !played.has(c));
  // 一手出完：直接封顶，出完优先于一切（含让队友）
  if (rest.length === 0) return aw.finish;

  // 基分：剩余手牌最优组法的评估分（同一决策点内横向比较各候选动作）
  let s = ev.score(arrange(rest, state.curRank, ev), state.curRank);

  // 队友正领先：压队友需要理由（能出完已在上面的 finish 封顶处理）
  if (partnerWinning) s += aw.beatPartner;
  // 对手逼近出完且非队友领先：赢下这一墩的拦截价值，越逼近越值钱
  const isLead = state.greaterPos === -1 || state.greaterPos === state.myPos;
  if (!isLead && !partnerWinning && minOppoRest <= 5) {
    s += (6 - minOppoRest) * aw.intercept;
  }
  return s;
}
