/**
 * 动作评估（成员 A）：出牌与跟牌共用同一打分，PASS 与压牌同量纲可比。
 * 基线：PASS = 当前手牌的组法分（不动则手牌结构不变）；
 *       压牌 = 出完后剩余手牌重新组法的评估分。
 * 两者之差即"这一手对牌结构的净收益 Δ"（上界约 +50、下界约 -50），
 * 让队友 / 拦截紧迫度 / PASS 代价等局面修正在此基础上加减。
 * 各权重量级的推导依据见 types.ts 中 DEFAULT_ACTION_WEIGHTS 的注释。
 */
import {
  Action, ActionWeights, Evaluator, GameState, isPass, removeCards,
} from "../types.js";
import { arrange } from "./arrange.js";

export function scorePlayAction(
  state: GameState, action: Action, evaluator: Evaluator, aw: ActionWeights,
): number {
  const partner = (state.myPos + 2) % 4;
  const partnerWinning = state.greaterPos === partner && !state.finished.includes(partner);
  const opponents = [(state.myPos + 1) % 4, (state.myPos + 3) % 4];
  const minOppoRest = Math.min(
    ...opponents.filter((p) => !state.finished.includes(p))
      .map((p) => state.publicInfo[p].rest),
    99,
  );

  // 基线分：手牌保持现状的组法分（同一决策点内只算一次，arrange 有缓存）
  const base = evaluator.score(
    arrange(state.handCards, state.curRank, evaluator), state.curRank,
  );

  if (isPass(action)) {
    let s = base;
    if (partnerWinning) s += aw.passPartner;       // 队友领先：让牌
    else if (minOppoRest <= 2) s += aw.passDanger; // 对手逼近出完：PASS 代价
    return s;
  }

  // 多重集合扣除：两副牌有同名牌，不能按 Set 过滤
  const rest = removeCards(state.handCards, action[2]);
  // 一手出完：终局事件，直接封顶，优先于一切（含让队友）
  if (rest.length === 0) return aw.finish;

  // 基分：剩余手牌最优组法的评估分；与 PASS 的基线分同量纲，差值即 Δ
  let s = evaluator.score(arrange(rest, state.curRank, evaluator), state.curRank);

  // 队友正领先：压队友需要理由（能出完已在上面的 finish 封顶处理）
  if (partnerWinning) s += aw.beatPartner;
  // 对手逼近出完且非队友领先：赢下这一墩的拦截价值，越逼近越值钱
  const isLead = state.greaterPos === -1 || state.greaterPos === state.myPos;
  if (!isLead && !partnerWinning && minOppoRest <= 5) {
    s += (6 - minOppoRest) * aw.intercept;
  }
  return s;
}
