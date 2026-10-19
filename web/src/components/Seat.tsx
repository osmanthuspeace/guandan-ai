import { CardView } from "./CardView";
import { LastPlay } from "../types";

interface SeatProps {
  pos: number;
  team: "A" | "B";
  role?: string;
  rest: number;
  last: LastPlay;
  className?: string;
}

/** 座位卡片：队色标识 + 剩余牌数 + 最近一手 */
export function Seat({ pos, team, role, rest, last, className }: SeatProps) {
  return (
    <div className={`seat ${className ?? ""}`}>
      <div className="seat-name">
        <span>座{pos}</span>
        <span className={team === "A" ? "team-a" : "team-b"}>
          {team}队{role ? `·${role}` : ""}
        </span>
      </div>
      <div className="seat-rest">剩余 {rest} 张</div>
      <div className="seat-last">
        {last === "PASS" ? "不要"
          : last ? last.map((c, i) => <CardView key={`${c}-${i}`} c={c} />)
          : ""}
      </div>
    </div>
  );
}
