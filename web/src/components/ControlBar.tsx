import { useState } from "react";
import { Button, Select, Space, Typography } from "antd";
import { StartParams } from "../useGameSocket";

const MODE_OPTS = [
  { value: "local", label: "本机自对战" },
  { value: "match", label: "联机约战" },
];
const POLICY_OPTS = [
  { value: "rule", label: "规则AI(含搜索)" },
  { value: "rule-ns", label: "规则AI(无搜索)" },
  { value: "random", label: "随机" },
];
const ROUND_OPTS = [1, 5, 10, 20].map((n) => ({ value: n, label: `${n} 局` }));

interface ControlBarProps {
  statusText: string;
  running: boolean;
  manual: boolean;
  awaiting: boolean;
  awaitingText: string | null;
  onStart: (p: StartParams) => void;
  onStop: () => void;
  onSetManual: (on: boolean) => void;
  onStep: () => void;
}

/** 顶栏：对战模式 + 队伍策略选择 + 局数 + 自动/手动 + 启停 + 状态 */
export function ControlBar({ statusText, running, manual, awaiting, awaitingText, onStart, onStop, onSetManual, onStep }: ControlBarProps) {
  const [mode, setMode] = useState<"local" | "match">("local");
  const [p02, setP02] = useState("rule");
  const [p13, setP13] = useState("random");
  const [rounds, setRounds] = useState(1);

  return (
    <header className="topbar">
      <Typography.Text strong className="brand">掼蛋 AI 对战台</Typography.Text>
      <Space size="middle">
        <span className="field">
          <span className="field-label">模式</span>
          <Select value={mode} onChange={setMode} options={MODE_OPTS} style={{ width: 110 }} />
        </span>
        <span className="field">
          <span className="field-label">A队(0&2)</span>
          <Select value={p02} onChange={setP02} options={POLICY_OPTS} style={{ width: 150 }} />
        </span>
        <span className="field">
          <span className="field-label">B队(1&3)</span>
          {mode === "match"
            ? <Typography.Text type="secondary">外部玩家接入</Typography.Text>
            : <Select value={p13} onChange={setP13} options={POLICY_OPTS} style={{ width: 150 }} />}
        </span>
        <span className="field">
          <span className="field-label">局数</span>
          <Select value={rounds} onChange={setRounds} options={ROUND_OPTS} style={{ width: 80 }} />
        </span>
        <span className="field">
          <span className="field-label">座0出牌</span>
          <Select
            value={manual ? "manual" : "auto"}
            onChange={(v) => onSetManual(v === "manual")}
            options={[
              { value: "auto", label: "自动" },
              { value: "manual", label: "手动" },
            ]}
            style={{ width: 100 }}
          />
        </span>
        {manual && awaiting && awaitingText && (
          <Typography.Text strong className="awaiting-text">
            {awaitingText}
          </Typography.Text>
        )}
        {manual && (
          <Button type="primary" disabled={!running || !awaiting} onClick={onStep}>
            下一步
          </Button>
        )}
        <Button type="primary" onClick={() => onStart({ mode, p02, p13, rounds })}>开始</Button>
        <Button disabled={!running} onClick={onStop}>停止</Button>
      </Space>
      <Typography.Text type="secondary" className="status">{statusText}</Typography.Text>
    </header>
  );
}
