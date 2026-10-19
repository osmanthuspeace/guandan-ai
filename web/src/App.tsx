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
      const v = s.result?.victory;
      const winner = v === 0 ? "A队" : v === 1 ? "B队" : `Team${v}`;
      return `已结束 · ${winner}胜 · 共 ${s.result?.episodes ?? 0} 局`;
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
      <div className="main">
        <Board state={state} />
        <LogPanel logs={state.logs} />
      </div>
    </div>
  );
}
