import { useState } from "react";
import { Button, Select, Space, Typography } from "antd";
import { StartParams } from "../useGameSocket";

const POLICY_OPTS = [
  { value: "rule", label: "规则AI(含搜索)" },
  { value: "rule-ns", label: "规则AI(无搜索)" },
  { value: "random", label: "随机" },
];
const ROUND_OPTS = [1, 2, 4].map((n) => ({ value: n, label: `${n} 局` }));

interface ControlBarProps {
  statusText: string;
  running: boolean;
  onStart: (p: StartParams) => void;
  onStop: () => void;
}

/** 顶栏：队伍策略选择 + 局数 + 启停 + 状态 */
export function ControlBar({ statusText, running, onStart, onStop }: ControlBarProps) {
  const [p02, setP02] = useState("rule");
  const [p13, setP13] = useState("random");
  const [rounds, setRounds] = useState(1);

  return (
    <header className="topbar">
      <Typography.Text strong className="brand">掼蛋 AI 对战台</Typography.Text>
      <Space size="middle">
        <span className="field">
          <span className="field-label">A队(0&2)</span>
          <Select value={p02} onChange={setP02} options={POLICY_OPTS} style={{ width: 150 }} />
        </span>
        <span className="field">
          <span className="field-label">B队(1&3)</span>
          <Select value={p13} onChange={setP13} options={POLICY_OPTS} style={{ width: 150 }} />
        </span>
        <span className="field">
          <span className="field-label">局数</span>
          <Select value={rounds} onChange={setRounds} options={ROUND_OPTS} style={{ width: 80 }} />
        </span>
        <Button type="primary" onClick={() => onStart({ p02, p13, rounds })}>开始</Button>
        <Button disabled={!running} onClick={onStop}>停止</Button>
      </Space>
      <Typography.Text type="secondary" className="status">{statusText}</Typography.Text>
    </header>
  );
}
