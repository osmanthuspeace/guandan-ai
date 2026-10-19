/**
 * 核心类型与公共接口（D1 冻结的契约）。
 * 所有策略模块面向此文件开发，互不依赖对方实现。
 */

// ---------------------------------------------------------------------------
// 牌的表示：服务端用长度为 2 的字符串，如 "S2"、"HT"、"SB"、"HR"
// 花色 S=黑桃 H=红桃 C=梅花 D=方块；点数 A,2-9,T,J,Q,K,B(小王),R(大王)
// ---------------------------------------------------------------------------

export type CardLabel = string;

export const SUITS = ["S", "H", "C", "D"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;

/** 点数的基础大小（未升级时）：2=2 ... A=14，小王 16，大王 17 */
export const BASE_RANK_VALUE: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14, B: 16, R: 17,
};

/** 顺子用的连续序号：A=1, 2=2 ... K=13（A 仅可作为 1 或 14 的衔接点） */
export const SEQ_VALUE: Record<string, number> = {
  A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13,
};

export function suitOf(card: CardLabel): string {
  return card[0];
}

export function rankOf(card: CardLabel): string {
  return card[1];
}

/** 比较用点数：级牌提升到 15（高于 A，低于王），其余用基础值 */
export function rankValue(rank: string, level: string): number {
  if (rank === level) return 15;
  return BASE_RANK_VALUE[rank] ?? 0;
}

/** 判断是否为"逢人配"（红桃级牌，万能牌） */
export function isWild(card: CardLabel, level: string): boolean {
  return card[0] === "H" && card[1] === level;
}

/** 判断两张牌比较大小（仅同牌型比点数时有意义） */
export function cardValue(card: CardLabel, level: string): number {
  return rankValue(rankOf(card), level);
}

// ---------------------------------------------------------------------------
// 动作：服务端 actionList 的条目，形如 ["Single", "5", ["D5"]]
// ---------------------------------------------------------------------------

export type PatternType =
  | "Single" | "Pair" | "Trips" | "ThreePair" | "ThreeWithTwo"
  | "TwoTrips" | "Straight" | "StraightFlush" | "Bomb" | "FourKings"
  | "tribute" | "back" | "PASS";

/** [Pattern, Rank, CardList] */
export type Action = [string, string, string[]];

export const PASS_ACTION: Action = ["PASS", "PASS", ["PASS"]];

export function isPass(a: Action): boolean {
  return a[0] === "PASS";
}

export function isBombLike(a: Action): boolean {
  return a[0] === "Bomb" || a[0] === "FourKings" || a[0] === "StraightFlush";
}

// ---------------------------------------------------------------------------
// 组法（Arrangement）：B 定义结构，A 的 Evaluator 对其打分
// ---------------------------------------------------------------------------

/** 组法中的一"手" */
export interface HandGroup {
  pattern: string;        // 牌型，如 "Pair"、"Straight"
  rank: string;           // 主点数
  cards: CardLabel[];     // 包含的牌（含逢人配的实际占位）
}

/** 一种组法 = 把整手牌划分成若干手 */
export interface Arrangement {
  groups: HandGroup[];
  /** 冗余统计（由 B 填好，A 的评估直接使用，避免重复计算） */
  handsCount: number;      // 总手数
  singles: CardLabel[];    // 所有单张
  bombCount: number;       // 炸弹数（含同花顺、四大天王）
  controlCount: number;    // 控制牌数（大王、小王、级牌单张等"上手牌"）
}

// ---------------------------------------------------------------------------
// 局面与策略接口
// ---------------------------------------------------------------------------

export interface PlayRecord {
  pos: number;             // 出牌者座位
  action: Action;          // 出的牌（PASS 也记录）
}

export interface GameState {
  myPos: number;                       // 我方座位 0-3
  handCards: CardLabel[];              // 我方手牌
  publicInfo: { rest: number }[];      // 各家剩余牌数
  selfRank: string;                    // 我方等级
  oppoRank: string;                    // 对方等级
  curRank: string;                     // 当前级牌
  curPos: number;                      // 当前应该行动的玩家（== myPos）
  greaterPos: number;                  // 当前最大出牌者座位（-1 表示新一轮）
  curAction: Action | null;            // 当前被压的动作
  greaterAction: Action | null;        // 目前最大动作
  history: PlayRecord[];               // 本局全部出牌/PASS 历史
  finished: number[];                  // 已出完牌的玩家座位（按名次顺序）
  stage: "play" | "tribute" | "back";
}

/** 唯一决策接口：输入局面 + 合法动作表，输出动作索引 */
export interface Policy {
  readonly name: string;
  chooseAction(state: GameState, actions: Action[]): number;
}

// ---------------------------------------------------------------------------
// 记牌器只读视图（C 实现，A/B 只读访问）
// ---------------------------------------------------------------------------

export interface TrackerView {
  /** 除我手牌外，尚未出现的牌（在另外三家手中） */
  unseenCards(excludeHand: CardLabel[]): CardLabel[];
  /** 某点数在全牌堆中剩余未见的张数 */
  unseenCountByRank(rank: string): number;
  /** 某个座位"不要"过的牌型历史 */
  passHistory(pos: number): Action[];
  /** 某座位出过牌的历史 */
  playHistory(pos: number): Action[];
}

// ---------------------------------------------------------------------------
// 牌力评估（A 实现，B 调用）
// ---------------------------------------------------------------------------

export interface Evaluator {
  /** 给一种组法打分，越高越好 */
  score(arr: Arrangement, level: string): number;
  /** 评估参数（可调权） */
  weights: EvalWeights;
}

export interface EvalWeights {
  perHand: number;        // 每多一手扣多少分（负值）
  perSingle: number;      // 每多一张单牌扣分（负值）
  smallSingle: number;    // 小单牌（<T）额外扣分（负值）
  perBomb: number;        // 每个炸弹加分
  perControl: number;     // 每张控制牌加分
}

// 坐标上升调参结果（bench/tuneEval.ts，tuned vs 旧默认 20:0，见 bench/tuned-weights.json）
export const DEFAULT_EVAL_WEIGHTS: EvalWeights = {
  perHand: -5,
  perSingle: -3,
  smallSingle: -2,
  perBomb: 25,
  perControl: 8,
};

// ---------------------------------------------------------------------------
// 动作评估（A 实现，B 调用）：出牌决策 = 剩余手牌 Evaluator 分 + 局面修正
// ---------------------------------------------------------------------------

export interface ActionWeights {
  finish: number;       // 一手出完的奖励
  beatPartner: number;  // 队友领先时仍压队友（且走不完）的惩罚（负值）
  intercept: number;    // 对手逼近出完时赢墩的每档奖励（按 6-对手最小剩牌 放大）
  passPartner: number;  // 队友领先时 PASS 的奖励
  passDanger: number;   // 对手 ≤2 张且非队友领先时 PASS 的惩罚（负值）
}

export const DEFAULT_ACTION_WEIGHTS: ActionWeights = {
  finish: 150,
  beatPartner: -240,
  intercept: 30,
  passPartner: 60,
  passDanger: -360,
};
