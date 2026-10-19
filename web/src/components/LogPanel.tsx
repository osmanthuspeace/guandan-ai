import { Fragment, useEffect, useRef } from "react";
import { LogLine } from "../types";

/** 按内容归类行样式（与 logFormat.ts 的输出格式对应） */
function classify(text: string): string {
  if (text.startsWith("──") || text.startsWith("─ 局终")) return "divider";
  if (text.includes("出完")) return "finish";
  if (text.startsWith("★")) return "final";
  return "";
}

/** 红桃花色、方片花色与大王标红 */
function colored(text: string) {
  const parts = text.split(/(♥\S*|♦\S*|大王)/g);
  return parts.map((p, i) =>
    /^(♥|♦|大王)/.test(p)
      ? <span key={i} className="red">{p}</span>
      : <Fragment key={i}>{p}</Fragment>
  );
}

/** 日志侧栏：自动滚到底部 */
export function LogPanel({ logs }: { logs: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <aside className="side">
      <div className="side-head">对局日志</div>
      <div className="log" ref={ref}>
        {logs.map((l) => (
          <div key={l.id} className={classify(l.text)}>{colored(l.text)}</div>
        ))}
      </div>
    </aside>
  );
}
