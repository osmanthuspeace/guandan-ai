/**
 * Bot 运行器（成员 A）：一个 WebSocket 连接 + 一个策略 = 一个 AI 玩家。
 */
import WebSocket from "ws";
import { Action, Policy } from "../types.js";
import { ActMessage, BotState } from "../state/gameState.js";

export interface BotOptions {
  url: string;                 // ws://127.0.0.1:8181
  userId: string;
  policy: Policy;
  roomId?: number;             // 指定则 JOIN_ROOM，否则 CREATE_ROOM
  round?: number;              // 创建房间时的局数
  seatNum?: number;
  onEvent?: (ev: Record<string, unknown>) => void; // UI 推送钩子
  onRoomCreated?: (roomId: number) => void;        // 建房/入房成功回调
}

export interface BotResult {
  userId: string;
  myPos: number;
  victory?: number;
  episodes: number;
}

export function runBot(opts: BotOptions): Promise<BotResult> {
  const state = new BotState();
  let roomId = opts.roomId ?? -1;
  let episodes = 0;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.url);
    const result: BotResult = { userId: opts.userId, myPos: -1, episodes: 0 };

    const send = (type: string, data: Record<string, unknown>) => {
      ws.send(JSON.stringify({ type, data }));
    };

    ws.on("open", () => {
      if (opts.roomId === undefined) {
        send("CREATE_ROOM", { userId: opts.userId, round: opts.round ?? 1, seatNum: opts.seatNum });
      } else {
        send("JOIN_ROOM", { userId: opts.userId, roomId: opts.roomId, seatNum: opts.seatNum });
      }
    });

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      opts.onEvent?.(msg);

      if (msg.type === "CREATE_ROOM" || msg.type === "JOIN_ROOM") {
        const data = msg.data as { roomId: number };
        roomId = data.roomId;
        opts.onRoomCreated?.(roomId);
        return;
      }
      if (msg.type === "notify") {
        state.handleNotify(msg);
        if (msg.stage === "beginning") result.myPos = state.myPos;
        if (msg.stage === "episodeOver") episodes++;
        if (msg.stage === "gameResult") {
          result.victory = msg.victory as number;
        }
        if (msg.stage === "gameOver" || msg.stage === "gameResult") {
          result.episodes = episodes;
          ws.close();
          resolve(result);
        }
        return;
      }
      if (msg.type === "act") {
        const act = msg as unknown as ActMessage;
        const gs = state.buildGameState(act);
        const actions = act.actionList ?? [];
        const idx = actions.length > 0 ? opts.policy.chooseAction(gs, actions) : 0;
        const chosen: Action = actions[idx] ?? actions[0];
        if (act.stage === "play") {
          send("PLAY", { roomId, player: state.myPos, act: chosen });
        } else if (act.stage === "tribute") {
          send("TRIBUTE", { roomId, player: state.myPos, act: chosen });
        } else if (act.stage === "back") {
          send("PAYTRIBUTE", {
            roomId, player: state.myPos,
            tributePos: act.tributePos, tribute: act.tribute, act: chosen,
          });
        }
        return;
      }
    });

    ws.on("error", reject);
    ws.on("close", () => {
      result.episodes = episodes;
      resolve(result);
    });
  });
}
