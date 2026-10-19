/** 与 UI 服务（server.ts / aiWorker）约定的事件协议 */

export type Action = [string, string, string[]];

export interface StartMsg {
  kind: "start";
  hands: Record<number, string[]>;
  episode: number;
  selfRank: string;
  oppoRank: string;
}
export interface PlayMsg {
  kind: "play";
  curPos: number;
  curAction: Action;
  greaterPos: number;
  greaterAction: Action | null;
}
export interface TributeMsg {
  kind: "tribute" | "back";
  result: [number, number, string][];
}
export interface EpisodeOverMsg {
  kind: "episodeOver";
  order: number[];
  curRank: string;
}
export interface ResultMsg {
  kind: "result";
  victory: number | null;
  episodes: number;
}
export interface LogMsg { kind: "log"; text: string; }
export interface ErrorMsg { kind: "error"; text: string; }

export type ServerMsg =
  | StartMsg | PlayMsg | TributeMsg | EpisodeOverMsg
  | ResultMsg | LogMsg | ErrorMsg;

/** 页面状态 */
export interface LogLine { id: number; text: string; }
export type LastPlay = string[] | "PASS" | null;
export type RunStatus = "idle" | "running" | "stopped" | "finished" | "error";

export interface UiState {
  connected: boolean;
  status: RunStatus;
  episode: number;
  selfRank: string;
  oppoRank: string;
  hand: string[];
  rests: number[];
  last: LastPlay[];
  trick: { pos: number; cards: string[] } | null;
  logs: LogLine[];
  result: { victory: number | null; episodes: number } | null;
}
