/**
 * 游戏状态管理：一条 WebSocket 连接 + useReducer。
 * 所有服务端事件在这里归并成 UiState，组件只读状态。
 */
import { useEffect, useReducer, useRef } from "react";
import { ServerMsg, UiState } from "./types";

const MAX_LOGS = 2000;

const initialState: UiState = {
  connected: false,
  status: "idle",
  mode: "local",
  episode: 0,
  selfRank: "2",
  oppoRank: "2",
  hand: [],
  rests: [27, 27, 27, 27],
  last: [null, null, null, null],
  trick: null,
  logs: [],
  score: [0, 0],
  games: [0, 0],
  result: null,
  matchInfo: null,
  manual: false,
  awaiting: false,
  awaitingText: null,
};

type ReducerAction =
  | { type: "conn"; ok: boolean }
  | { type: "startRun"; mode: "local" | "match" }
  | { type: "setManual"; on: boolean }
  | { type: "stepAck" }
  | { type: "msg"; msg: ServerMsg };

let logSeq = 0;

/** 从手牌中移除一组牌（同名牌每次只删一张，两副牌有重复） */
function removeCards(hand: string[], cards: string[]): string[] {
  const next = [...hand];
  for (const c of cards) {
    const i = next.indexOf(c);
    if (i >= 0) next.splice(i, 1);
  }
  return next;
}

function reduceMsg(s: UiState, msg: ServerMsg): UiState {
  switch (msg.kind) {
    case "start": {
      const rests = [0, 1, 2, 3].map((i) => msg.hands[i]?.length ?? 27);
      return {
        ...s,
        episode: msg.episode,
        selfRank: msg.selfRank,
        oppoRank: msg.oppoRank,
        hand: msg.hands[0] ?? [],
        rests,
        last: [null, null, null, null],
        trick: null,
      };
    }
    case "play": {
      const rests = [...s.rests];
      const last = [...s.last];
      const [pat, , cards] = msg.curAction;
      let hand = s.hand;
      if (pat !== "PASS") {
        rests[msg.curPos] = Math.max(0, rests[msg.curPos] - cards.length);
        if (msg.curPos === 0) hand = removeCards(s.hand, cards); // 我方手牌同步减少
      }
      last[msg.curPos] = pat === "PASS" ? "PASS" : cards;
      const trick = msg.greaterAction && msg.greaterAction[0] !== "PASS"
        ? { pos: msg.greaterPos, cards: msg.greaterAction[2] }
        : s.trick;
      return { ...s, rests, last, trick, hand };
    }
    case "tribute":
    case "back": {
      const rests = [...s.rests];
      let hand = s.hand;
      for (const [from, to, card] of msg.result ?? []) {
        rests[from] = Math.max(0, rests[from] - 1);
        rests[to] += 1;
        if (from === 0) hand = removeCards(hand, [card]); // 贡出
        if (to === 0) hand = [...hand, card];               // 收贡
      }
      return { ...s, rests, hand };
    }
    case "episodeOver":
      return { ...s, rests: [27, 27, 27, 27], score: msg.score ?? s.score };
    case "gameOver":
      // 一场结束：大局取 worker 入账值；本场比分/局数清零，待下一场从 2 重打
      return { ...s, games: msg.games, score: [0, 0], episode: 0, trick: null };
    case "result":
      return {
        ...s,
        status: "finished",
        awaiting: false,
        awaitingText: null,
        games: msg.games,
        score: msg.score ?? s.score,
        result: { victory: msg.victory, episodes: msg.episodes, score: msg.score ?? [0, 0] },
      };
    case "awaiting":
      return { ...s, awaiting: true, awaitingText: msg.text ?? null };
    case "match":
      return { ...s, matchInfo: { roomId: msg.roomId, urls: msg.urls } };
    case "log": {
      const logs = [...s.logs, { id: ++logSeq, text: msg.text }];
      if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
      return { ...s, logs };
    }
    case "error":
      return {
        ...s,
        status: "error",
        logs: [...s.logs, { id: ++logSeq, text: msg.text }],
      };
  }
}

function reducer(s: UiState, a: ReducerAction): UiState {
  switch (a.type) {
    case "conn":
      return { ...s, connected: a.ok };
    case "startRun":
      // 重新开始即全新对决：大局比分一并清零（manual 选择保留）
      return { ...initialState, connected: s.connected, status: "running", mode: a.mode, manual: s.manual };
    case "setManual":
      return a.on
        ? { ...s, manual: true }
        : { ...s, manual: false, awaiting: false, awaitingText: null };
    case "stepAck":
      return { ...s, awaiting: false, awaitingText: null };
    case "msg":
      return reduceMsg(s, a.msg);
  }
}

export interface StartParams {
  mode: "local" | "match";
  p02: string;
  p13: string;
  rounds: number;
}

export function useGameSocket() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => dispatch({ type: "conn", ok: true });
    ws.onclose = () => dispatch({ type: "conn", ok: false });
    ws.onmessage = (e) => {
      try {
        dispatch({ type: "msg", msg: JSON.parse(e.data) as ServerMsg });
      } catch {}
    };
    return () => ws.close();
  }, []);

  const send = (obj: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  };

  const startRun = (p: StartParams) => {
    dispatch({ type: "startRun", mode: p.mode });
    // manual 随 start 下发：worker 是全新进程，开局即手动，避免开局后切换的竞态
    send({ type: "start", ...p, manual: state.manual });
  };
  const stopRun = () => send({ type: "stop" });
  const setManual = (on: boolean) => {
    dispatch({ type: "setManual", on });
    send({ type: "setManual", on });
  };
  const step = () => {
    dispatch({ type: "stepAck" });
    send({ type: "step" });
  };

  return { state, startRun, stopRun, setManual, step };
}
