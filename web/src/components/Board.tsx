import { CardView } from "./CardView";
import { Seat } from "./Seat";
import { UiState } from "../types";

/** 牌桌：三家座位 + 中央牌池 + 底部我方手牌 */
export function Board({ state }: { state: UiState }) {
  return (
    <div className="board">
      <Seat pos={2} team="A" role="队友" rest={state.rests[2]} last={state.last[2]} className="area-top" />
      <Seat pos={3} team="B" rest={state.rests[3]} last={state.last[3]} className="area-left" />
      <Seat pos={1} team="B" rest={state.rests[1]} last={state.last[1]} className="area-right" />

      <div className="felt">
        <div className="felt-label">当前最大出牌</div>
        <div className="trick">
          {state.trick
            ? <>座{state.trick.pos}　{state.trick.cards.map((c, i) => <CardView key={`${c}-${i}`} c={c} />)}</>
            : <span className="felt-label">—</span>}
        </div>
        {state.episode > 0 ? (
          <div className="scoreboard">
            <div className="sb-row">
              <span className="sb-tag">大局</span>
              <span className="sb-team sb-a">A</span>
              <span className="sb-num">{state.games[0]}</span>
              <span className="sb-colon">:</span>
              <span className="sb-num">{state.games[1]}</span>
              <span className="sb-team sb-b">B</span>
            </div>
            <div className="sb-row sb-sub">
              <span className="sb-tag">本场</span>
              <span className="sb-team sb-a">A</span>
              <span className="sb-num2">{state.score[0]}</span>
              <span className="sb-colon">:</span>
              <span className="sb-num2">{state.score[1]}</span>
              <span className="sb-team sb-b">B</span>
            </div>
            <div className="sb-meta">
              第 {state.episode} 局 · A队打 {state.selfRank} · B队打 {state.oppoRank}
            </div>
          </div>
        ) : state.mode === "match" ? (
          <div className="sb-meta">等待外部玩家加入，满员自动开局</div>
        ) : null}
      </div>

      <div className="hand">
        <div className="hand-name">座0（A队·视角）</div>
        <div className="hand-cards">
          {state.hand.map((c, i) => <CardView key={`${c}-${i}`} c={c} />)}
        </div>
      </div>
    </div>
  );
}
