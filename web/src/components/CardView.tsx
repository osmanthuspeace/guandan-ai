/** 单张牌："H5" → 红 ♥5，王牌显示中文 */
const SUIT: Record<string, string> = { S: "♠", H: "♥", C: "♣", D: "♦" };

export function CardView({ c }: { c: string }) {
  if (c === "SB") return <span className="card">小王</span>;
  if (c === "HR") return <span className="card red">大王</span>;
  const red = c[0] === "H" || c[0] === "D";
  return (
    <span className={`card${red ? " red" : ""}`}>
      {SUIT[c[0]] ?? c[0]}{c.slice(1)}
    </span>
  );
}
