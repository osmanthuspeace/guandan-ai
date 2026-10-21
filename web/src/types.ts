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
  score: [number, number];
}
/** 单场（大场）结束：worker 按"等级回退"逐场探测入账（服务端 gameOver 仅在全部场次末尾到达一次） */
export interface GameOverMsg {
  kind: "gameOver";
  victory: number | null;   // 本场胜方 0=A队 1=B队
  games: [number, number];  // 大局比分（累计胜场）
  game: number;             // 刚结束的是第几场
}
export interface ResultMsg {
  kind: "result";
  victory: number | null;
  episodes: number;
  score: [number, number];
  games: [number, number];
}
export interface LogMsg { kind: "log"; text: string; }
export interface ErrorMsg { kind: "error"; text: string; }
/** 联机约战：房间已创建，等待外部玩家加入座位 1&3 */
export interface MatchInfoMsg {
  kind: "match";
  roomId: number;
  urls: string[];
}

export type ServerMsg =
  | StartMsg | PlayMsg | TributeMsg | EpisodeOverMsg | GameOverMsg
  | ResultMsg | LogMsg | ErrorMsg | MatchInfoMsg;

/** 页面状态 */
export interface LogLine { id: number; text: string; }
export type LastPlay = string[] | "PASS" | null;
export type RunStatus = "idle" | "running" | "stopped" | "finished" | "error";

export interface UiState {
  connected: boolean;
  status: RunStatus;
  /** 对战模式：local=本机自对战；match=联机约战（记分板仅此模式显示） */
  mode: "local" | "match";
  episode: number;
  selfRank: string;
  oppoRank: string;
  hand: string[];
  rests: number[];
  last: LastPlay[];
  trick: { pos: number; cards: string[] } | null;
  logs: LogLine[];
  /** 本场局比分 [A队胜局数, B队胜局数]（worker 上报，每场重新开始） */
  score: [number, number];
  /** 大局比分 [A队胜场数, B队胜场数]（worker 逐场入账，点「开始」清零） */
  games: [number, number];
  result: { victory: number | null; episodes: number; score: [number, number] } | null;
  /** 联机约战信息（房间号 + 局域网地址），非约战模式为 null */
  matchInfo: { roomId: number; urls: string[] } | null;
}
