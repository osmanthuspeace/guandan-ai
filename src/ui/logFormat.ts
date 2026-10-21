/**
 * 日志格式化：把牌局事件统一转成中文文本行。
 * 集中在这一处产生日志，UI 页面只负责展示（避免前后端重复打日志）。
 */

const SUIT: Record<string, string> = { S: "♠", H: "♥", C: "♣", D: "♦" };

export const PATTERN_CN: Record<string, string> = {
  Single: "单张", Pair: "对子", Trips: "三张", ThreeWithTwo: "三带二",
  ThreePair: "钢板", TwoTrips: "木板", Straight: "顺子",
  StraightFlush: "同花顺", Bomb: "炸弹", FourKings: "四大天王",
  tribute: "进贡", back: "还贡", PASS: "过",
};

export function fmtCard(c: string): string {
  if (c === "SB") return "小王";
  if (c === "HR") return "大王";
  return `${SUIT[c[0]] ?? c[0]}${c.slice(1)}`;
}

export const fmtCards = (cs: string[]): string => cs.map(fmtCard).join(" ");

/** 座位标签：0/2 为 A 队，1/3 为 B 队 */
export const seatTag = (pos: number): string => `座${pos}·${pos % 2 === 0 ? "A" : "B"}`;

/** 一行出牌记录："座0·A  对子  ♠5 ♥5" / "座1·B  过" */
export function fmtPlay(pos: number, action: [string, string, string[]]): string {
  const [pat, , cards] = action;
  if (pat === "PASS") return `${seatTag(pos)}  过`;
  const name = pat === "Bomb" ? `炸弹×${cards.length}` : (PATTERN_CN[pat] ?? pat);
  return `${seatTag(pos)}  ${name}  ${fmtCards(cards)}`;
}

export function fmtEpisodeStart(n: number, selfRank: string, oppoRank: string): string {
  return `── 第 ${n} 局 · A队打${selfRank} B队打${oppoRank} ──`;
}

const PLACE_NAMES = ["头游", "二游", "三游", "末游"];

export function fmtFinish(pos: number, place: number): string {
  return `${seatTag(pos)}  出完 · ${PLACE_NAMES[place] ?? `第${place + 1}名`}`;
}

/** 进贡/还贡，每个组合一行 */
export function fmtTribute(kind: string, result: [number, number, string][]): string[] {
  const verb = kind === "tribute" ? "进贡" : "还贡";
  return (result ?? []).map(([from, to, card]) =>
    `${seatTag(from)} → ${seatTag(to)}  ${verb} ${fmtCard(card)}`);
}

export function fmtAntiTribute(antiPos: unknown): string {
  const list = Array.isArray(antiPos) ? antiPos : [];
  const who = list.length ? list.map((p) => seatTag(Number(p))).join("、") : "两家";
  return `${who} 抗贡，本轮免除进贡`;
}

export function fmtEpisodeOver(order: number[], score?: [number, number]): string {
  const ord = (order ?? []).map(seatTag).join(" › ");
  const s = score ? ` · 胜局 A ${score[0]}:${score[1]} B` : "";
  // 双方下局打几看下一局开头的"A队打X B队打Y"（episodeOver 不带双方新等级）
  return `─ 局终 · 名次 ${ord}${s} ─`;
}

export function fmtGameOver(game: number, victory: number | null, games: [number, number]): string {
  const winner = victory === 0 ? "A队" : victory === 1 ? "B队" : "未知队伍";
  return `━━ 第 ${game} 场结束 · ${winner}过A胜 · 大局 A ${games[0]}:${games[1]} B ━━`;
}

export function fmtResult(
  victory: unknown, episodes: number, score?: [number, number], games?: [number, number],
): string {
  const winner = victory === 0 ? "A队" : victory === 1 ? "B队" : `Team${victory}`;
  const g = games ? ` · 大局 A ${games[0]}:${games[1]} B` : "";
  const s = score ? ` · 末场胜局 A ${score[0]}:${score[1]} B` : "";
  return `★ 比赛结束 · 末场${winner}胜（先过A）${g}${s} · 共 ${episodes} 局`;
}
