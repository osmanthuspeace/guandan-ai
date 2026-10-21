/**
 * 策略注册表：算法与座位/工程完全解耦——
 * 任何实现了 Policy 接口的策略注册一个名字，就能在 bench / UI 里被任意座位选用。
 */
import { Policy } from "../types.js";
import { RouterPolicy } from "./router.js";
import { RandomPolicy } from "./random.js";

export interface PolicyDef {
  label: string;
  create: () => Policy;
}

export const POLICIES: Record<string, PolicyDef> = {
  rule: {
    label: "规则AI(含末局搜索)",
    create: () => new RouterPolicy({ samples: 16, timeMs: 800 }),
  },
  "rule-ns": {
    label: "规则AI(无搜索)",
    create: () => new RouterPolicy({ useEndgame: false }),
  },
  "rule-se": { // 兼容旧命令/日志的别名，等同 rule
    label: "规则AI(含末局搜索)",
    create: () => new RouterPolicy({ samples: 16, timeMs: 800 }),
  },
  random: {
    label: "随机",
    create: () => new RandomPolicy(),
  },
};

export const POLICY_KINDS = Object.keys(POLICIES);

export function makePolicy(kind: string): Policy {
  const def = POLICIES[kind];
  if (!def) throw new Error(`未知策略 "${kind}"，可选：${POLICY_KINDS.join(" / ")}`);
  return def.create();
}
