import { useGameSocket } from "./useGameSocket";
import { ControlBar } from "./components/ControlBar";
import { Board } from "./components/Board";
import { LogPanel } from "./components/LogPanel";

function statusTextOf(s: ReturnType<typeof useGameSocket>["state"]): string {
  switch (s.status) {
    case "running": return "对战中…";
    case "stopped": return "已停止";
    case "error": return "出错";
    case "finished": {
      const g = s.games;
      const mw = g[0] > g[1] ? "A队胜" : g[1] > g[0] ? "B队胜" : "平分";
      return `对战结束 · ${mw} · 大局 ${g[0]}:${g[1]} · 共 ${s.result?.episodes ?? 0} 局`;
    }
    default: return s.connected ? "就绪" : "连接中…";
  }
}

export default function App() {
  const { state, startRun, stopRun } = useGameSocket();
  return (
    <div className="app">
      <ControlBar
        statusText={statusTextOf(state)}
        running={state.status === "running"}
        onStart={startRun}
        onStop={stopRun}
      />
      {state.matchInfo && (
        <div className="match-banner">
          <span>
            联机约战 · 房间号 <b>{state.matchInfo.roomId}</b> · 座位 0&2 我方 AI，等待外部玩家加入 1&3（满员自动开局）
          </span>
          <code>
            npm run bot -- --url {state.matchInfo.urls[0]} --user &lt;唯一ID&gt;
            --room {state.matchInfo.roomId} --seat &lt;1|3&gt;
          </code>
        </div>
      )}
      <div className="main">
        <Board state={state} />
        <LogPanel logs={state.logs} />
      </div>
    </div>
  );
}
