/**
 * 约束采样（成员 C）：从历史 PASS 推断各家"不太可能持有的牌型上限"，
 * 采样时优先采用不违反约束的分牌结果，让模拟世界更贴近真实。
 *
 * 约束语义（软约束 + 自洽过滤）：
 * - P 在对手的 单/对/三张 前 PASS → P 没有更大的同类天然牌型；
 * - P 在对手的炸弹前 PASS → P 没有更大的天然炸弹；
 * - 队友领先时的 PASS 不产生约束（正常让牌，无信息）；
 * - "憋牌"会让推断出错，所以仅当 P 之后的实际出牌不与推断矛盾时才采用
 *   （牌只会越打越少：之后打出的牌当时一定在手里）。
 */
import {
  Action, CardLabel, GameState, isPass, isWild, rankValue,
} from "../types.js";

export interface HandCaps {
  single?: number; // 无点数严格大于该值的单张
  pair?: number;   // 无点数严格大于该值的天然对子
  trips?: number;  // 无点数严格大于该值的天然三张
  bomb?: number;   // 无强度大于该值的天然炸弹（强度：4炸40 < 5炸50 < … < 四王90）
}

interface CapCandidate {
  pos: number;
  kind: keyof HandCaps;
  v: number;
  idx: number; // 历史下标，用于自洽过滤
}

const bombStrength = (a: Action): number => {
  if (a[0] === "FourKings") return 90;
  if (a[0] === "StraightFlush") return 55;
  if (a[0] === "Bomb") return a[2].length * 10;
  return 0;
};

/** 从历史提取每家的持牌上限约束 */
export function extractCaps(state: GameState): (HandCaps | null)[] {
  const caps: (HandCaps | null)[] = [null, null, null, null];
  const laterPlays: { idx: number; a: Action }[][] = [[], [], [], []];
  const candidates: CapCandidate[] = [];
  let standAction: Action | null = null;
  let standPos = -1;

  for (let i = 0; i < state.history.length; i++) {
    const { pos, action } = state.history[i];
    if (action[0] === "tribute" || action[0] === "back") continue;
    if (isPass(action)) {
      // 只有"对手领先时的 PASS"才含信息
      if (standAction && standPos !== pos && standPos % 2 !== pos % 2) {
        const bs = bombStrength(standAction);
        if (bs > 0) {
          candidates.push({ pos, kind: "bomb", v: bs, idx: i });
        } else if (["Single", "Pair", "Trips"].includes(standAction[0])) {
          candidates.push({
            pos,
            kind: standAction[0].toLowerCase() as keyof HandCaps,
            v: rankValue(standAction[1], state.curRank),
            idx: i,
          });
        }
        // 顺子/三带二等长牌型跳过（检测成本高、收益低）
      }
    } else {
      standAction = action;
      standPos = pos;
      laterPlays[pos].push({ idx: i, a: action });
    }
  }

  for (const c of candidates) {
    // 自洽过滤：之后的出牌若违反该推断，说明当时是憋牌，丢弃
    const contradicted = laterPlays[c.pos].some(
      (p) => p.idx > c.idx && playViolates(p.a, c.kind, c.v, state.curRank),
    );
    if (contradicted) continue;
    const cap = (caps[c.pos] ??= {});
    if (cap[c.kind] === undefined || c.v < cap[c.kind]!) cap[c.kind] = c.v; // 取最强推断
  }
  return caps;
}

/** 打出 a 是否与"P 没有大于 v 的 kind 牌型"矛盾 */
function playViolates(a: Action, kind: keyof HandCaps, v: number, level: string): boolean {
  if (kind === "single") {
    // 之后打出任何点数 > v 的牌即矛盾（任意牌型，牌当时一定在手里）
    return a[2].some((c) => rankValue(c[1], level) > v);
  }
  const cnt = new Map<string, number>();
  let jb = 0, jr = 0;
  for (const c of a[2]) {
    if (c[1] === "B") { jb++; continue; }
    if (c[1] === "R") { jr++; continue; }
    cnt.set(c[1], (cnt.get(c[1]) ?? 0) + 1);
  }
  if (kind === "bomb") {
    if (bombStrength(a) <= v) return false;
    if (jb === 2 && jr === 2) return true; // 天然四王
    for (const n of cnt.values()) if (n >= 4) return true; // 天然 4+ 同点
    return false; // 可能是逢人配凑的炸，不算矛盾
  }
  const need = kind === "pair" ? 2 : 3;
  for (const [r, n] of cnt) if (n >= need && rankValue(r, level) > v) return true;
  return false;
}

/**
 * 统计分牌结果违反约束的次数（0 = 完全满足）。
 * 万能牌（红桃级牌）按原点数参与单张检查，不计入天然对子/三张/炸弹。
 */
export function countViolations(
  hands: CardLabel[][], caps: (HandCaps | null)[], level: string, myPos: number,
): number {
  let bad = 0;
  for (let p = 0; p < 4; p++) {
    const cap = caps[p];
    if (!cap || p === myPos || hands[p].length === 0) continue;
    const cnt = new Map<string, number>();
    let maxSingle = -1, jb = 0, jr = 0, maxNaturalBomb = 0;
    for (const c of hands[p]) {
      maxSingle = Math.max(maxSingle, rankValue(c[1], level));
      if (c[1] === "B") { jb++; continue; }
      if (c[1] === "R") { jr++; continue; }
      if (isWild(c, level)) continue; // 万能牌不算天然组合
      cnt.set(c[1], (cnt.get(c[1]) ?? 0) + 1);
    }
    if (jb === 2 && jr === 2) maxNaturalBomb = 90;
    let maxPair = -1, maxTrips = -1;
    for (const [r, n] of cnt) {
      const v = rankValue(r, level);
      if (n >= 4) maxNaturalBomb = Math.max(maxNaturalBomb, n * 10);
      if (n >= 2) maxPair = Math.max(maxPair, v);
      if (n >= 3) maxTrips = Math.max(maxTrips, v);
    }
    if (cap.single !== undefined && maxSingle > cap.single) bad++;
    if (cap.pair !== undefined && maxPair > cap.pair) bad++;
    if (cap.trips !== undefined && maxTrips > cap.trips) bad++;
    if (cap.bomb !== undefined && maxNaturalBomb > cap.bomb) bad++;
  }
  return bad;
}
