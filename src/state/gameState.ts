/**
 * 游戏状态机（成员 A）：把服务端消息流重建为 GameState，维护出牌历史。
 */
import { Action, GameState, PlayRecord, isPass } from "../types.js";

/** 服务端 act 消息的结构（只取需要的字段） */
export interface ActMessage {
  stage: "play" | "tribute" | "back";
  handCards: string[];
  publicInfo?: { rest: number }[];
  selfRank?: string;
  oppoRank?: string;
  curRank?: string;
  curPos?: number;
  curAction?: Action | null;
  greaterAction?: Action | null;
  greaterPos?: number;
  actionList: Action[];
  tributePos?: number;
  tribute?: string;
}

export class BotState {
  myPos = -1;
  handCards: string[] = [];
  history: PlayRecord[] = [];
  finished: number[] = [];
  restCounts = [27, 27, 27, 27];
  selfRank = "2";
  oppoRank = "2";
  curRank = "2";

  resetEpisode(): void {
    this.history = [];
    this.finished = [];
    this.restCounts = [27, 27, 27, 27];
  }

  handleNotify(msg: Record<string, unknown>): void {
    const stage = msg.stage as string;
    if (stage === "beginning") {
      this.resetEpisode();
      this.myPos = msg.myPos as number;
      this.handCards = (msg.handCards as string[]) ?? [];
      this.restCounts[this.myPos] = this.handCards.length;
      if (msg.curRank) this.curRank = msg.curRank as string;
      if (msg.selfRank) this.selfRank = msg.selfRank as string;
      if (msg.oppoRank) this.oppoRank = msg.oppoRank as string;
    } else if (stage === "play") {
      const curPos = msg.curPos as number;
      const curAction = msg.curAction as Action;
      this.history.push({ pos: curPos, action: curAction });
      if (!isPass(curAction)) {
        this.restCounts[curPos] = Math.max(0, this.restCounts[curPos] - curAction[2].length);
        if (this.restCounts[curPos] === 0 && !this.finished.includes(curPos)) {
          this.finished.push(curPos);
        }
      }
    } else if (stage === "tribute" || stage === "back") {
      const result = (msg.result as [number, number, string][]) ?? [];
      for (const [from, to, card] of result) {
        this.history.push({
          pos: from,
          action: [stage === "tribute" ? "tribute" : "back", stage, [card]],
        });
        this.restCounts[from] = Math.max(0, this.restCounts[from] - 1);
        this.restCounts[to] += 1;
      }
    } else if (stage === "episodeOver") {
      this.finished = (msg.order as number[]) ?? this.finished;
      if (msg.curRank) this.curRank = msg.curRank as string;
    }
  }

  buildGameState(act: ActMessage): GameState {
    this.handCards = act.handCards ?? this.handCards;
    if (act.selfRank) this.selfRank = act.selfRank;
    if (act.oppoRank) this.oppoRank = act.oppoRank;
    if (act.curRank) this.curRank = act.curRank;
    if (act.publicInfo) {
      act.publicInfo.forEach((pi, p) => {
        this.restCounts[p] = pi.rest;
        if (pi.rest === 0 && !this.finished.includes(p)) this.finished.push(p);
      });
    }
    return {
      myPos: this.myPos,
      handCards: this.handCards,
      publicInfo: this.restCounts.map((rest) => ({ rest })),
      selfRank: this.selfRank,
      oppoRank: this.oppoRank,
      curRank: this.curRank,
      curPos: act.curPos ?? this.myPos,
      greaterPos: act.greaterPos ?? -1,
      curAction: act.curAction ?? null,
      greaterAction: act.greaterAction ?? null,
      history: this.history,
      finished: this.finished,
      stage: act.stage,
    };
  }
}
