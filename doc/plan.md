# 掼蛋 AI 项目计划

> 依据 `prd.md` 与 OpenGuanDan 平台文档制定。
> 技术栈：**TypeScript** | 需要 **UI** | 周期：**约 1 周** | 团队：**3 人**

---

## 1. 项目目标（来自 PRD）

1. 基于比赛平台 [OpenGuanDan](https://github.com/GameAI-NJUPT/OpenGuanDan) 与示例代码，设计并实现掼蛋 AI；
2. 与其他选掼蛋课题的选手 PK；
3. 与已有掼蛋 AI 进行 PK；
4. 统计比赛结果，形成报告。

工程约束（PRD 提醒）：

- 自动跑对局的程序必须放到**独立线程**，不能卡 UI；
- **游戏逻辑与渲染严格分离**；
- 三人模块之间**低耦合**。

---

## 2. 算法方案调研与选型

### 2.1 候选方案对比

| 方案 | 代表工作 | 原理 | 效果 | 1 周可行性 |
|---|---|---|---|---|
| 深度强化学习 | DanZero / DanZero+（arXiv:2210.17087, 2312.02561） | 深度蒙特卡洛 + 分布式 Q-learning，神经网络 | 学界最强 | ❌ 需 GPU 集群 + 数周训练，排除 |
| 纯 MCTS/UCT | 多种牌类 AI | 蒙特卡洛树搜索 | DanZero 论文指出 UCT 版掼蛋 AI「仅略优于随机」：4 人、不完美信息、动作空间巨大导致模拟不可信 | ❌ 排除 |
| 纯规则启发式 | 工程界主流（记牌器、组牌辅助工具） | 手牌评估 + 人工牌理规则 | 强于随机，上限一般，策略写死后难调 | ⚠️ 可作基线 |
| **规则 + 末局搜索（混合）** | 斗地主 AI 的「猜牌采样 + minimax + alpha-beta」路线；**即 PRD 指定的分工方向** | 前中期规则决策；残局阶段对对手手牌采样后做完备/剪枝搜索 | 明显强于纯规则，工程量可控 | ✅ **采用** |

### 2.2 最终选型

**分层决策架构**：

- **前中期**：规则启发式。组牌（拆牌优化）+ 牌理策略（首发/跟牌/配合/炸弹时机/贡还牌）。
- **末局（残局）**：当各方剩余牌数低于阈值时，切换到搜索决策——基于记牌器推算剩余牌分布，对未知手牌做若干次**采样（假设完美信息）**，每次采样跑 **minimax + alpha-beta 剪枝**，投票选出最优动作。
- **记牌器与预测**：全程统计已出牌，维护剩余牌表；结合各家「PASS/不要」历史做排除法，估计炸弹概率与关键牌归属，供规则层和搜索层共用。

### 2.3 关键技术点

- **动作来源**：服务端每次下发 `actionList`，AI 只需输出**索引**（`actIndex`）。因此组牌/策略的输出必须**映射回 actionList 条目**，而不是自己造牌型——这是与示例代码对接的核心设计。
- **逢人配**：红桃级牌（heart rank card）可作万能牌，组牌枚举时需特殊处理（示例 `engine/` 中 `hearts_num` 逻辑可参考）。
- **还牌限制**：还贡牌点数不能大于 10（J/Q/K/A 非法），策略层需过滤。
- **线程模型**：Node 后端用 `worker_threads` 跑 AI 决策与批量对战，UI 进程只负责渲染与交互，满足 PRD 线程隔离要求。

---

## 3. 系统架构

```
┌─────────────────────────────────────────────┐
│  UI 前端（浏览器，渲染牌桌/控制自动跑/结果显示） │
└──────────────▲──────────────────────────────┘
               │ 本地 WebSocket / HTTP（状态推送）
┌──────────────┴──────────────────────────────┐
│  Node.js 后端（TypeScript）                   │
│  ├─ Client 层：连比赛服 ws://127.0.0.1:8181   │
│  │   建/入房、PLAY/TRIBUTE/PAYTRIBUTE 收发     │
│  ├─ State 层：消息 → GameState（本地局面重建） │
│  └─ AI 层（worker_threads，决策隔离）          │
│      ├─ Evaluator（牌力评估）    ── 成员 A    │
│      ├─ TributePolicy（贡还牌）  ── 成员 B    │
│      ├─ RulePolicy（组牌/牌理）   ── 成员 B    │
│      ├─ CardTracker（记牌/预测）  ── 成员 C    │
│      └─ EndgameSearch（采样+剪枝）── 成员 C    │
└─────────────────────────────────────────────┘
```

### 低耦合接口契约（Day 1 三人共同冻结）

```ts
// 唯一决策接口：输入局面 + 合法动作表，输出动作索引
interface Policy {
  chooseAction(state: GameState, actions: Action[]): number;
}

interface GameState {
  myPos: number;            // 我方座位 0-3
  handCards: string[];      // 我方手牌
  publicInfo: { rest: number }[]; // 各家剩余牌数
  selfRank: string; oppoRank: string; curRank: string;
  curPos: number; greaterPos: number;
  curAction: Action | null; greaterAction: Action | null;
  history: PlayRecord[];    // 本局全部出牌/PASS 历史（记牌器数据源）
  stage: 'play' | 'tribute' | 'back';
}

type Action = [string, string, string[]]; // [Pattern, Rank, CardList]
```

- 顶层 `RouterPolicy` 按阶段分发：进贡/还贡 → `TributePolicy`（B）；残局（如最大剩余牌数 ≤ N，N 可调）→ `EndgameSearch`（C）；其余 → `RulePolicy`（B）。`RulePolicy` 组牌选优与动作打分调用 `Evaluator`（A）；各策略均可只读访问 `CardTracker`（C）。
- 三人各自面向接口开发算法模块，互不依赖对方实现；公共数据结构（`GameState`、`Arrangement`、`Evaluator` 签名）在 D1 冻结。

---

## 4. 三人分工

分工原则：**每人都负责"一块完整算法 + 与之衔接的工程"**，三人的算法模块均面向同一 `Policy` 接口开发、可独立测试。成员 A 因承担公共工程底座，算法模块体量相对较小但边界完整。

### 成员 A —— 工程底座 + 手牌分析与牌力评估

**工程部分**

| 职责 | 交付物 |
|---|---|
| WebSocket 客户端：协议收发、重连、多实例（4 个 AI 同房间） | `client/` 模块 |
| 游戏状态机：把服务端消息流重建为 `GameState`，维护出牌历史 | `state/` 模块 |
| UI：牌桌渲染（手牌/各家剩牌/当前出牌/级牌）、开始自动跑、速度调节、日志 | Web 前端页面 |
| 线程隔离：AI 决策与批量对战跑在 `worker_threads`，UI 不阻塞 | worker 框架 |
| 批量 PK 脚本：N 局自动对战，统计胜率/升级数/双下率，导出数据 | `bench/` 脚本 + 数据 |
| 集成联调、与已有 AI / 其他队伍 PK、汇总报告素材 | 报告数据章节 |

**算法部分**

| 职责 | 交付物 |
|---|---|
| 手牌分析与牌力评估：实现 `Evaluator`，从手数/单牌/炸弹/控制力四个维度给任意一种组法打分，供 B 的组牌选优与牌理打分调用 | `policy/evaluate.ts` |
| 评估权重调优：用批量对战数据回归调整四个维度的权重 | 调参记录 |

### 成员 B —— 组牌算法 / 出牌牌理（前中期策略）/ 贡还牌决策

| 职责 | 交付物 |
|---|---|
| 牌型识别：从手牌枚举所有合法牌型（含逢人配展开），定义公共 `Arrangement` 数据结构 | `policy/patterns.ts` |
| 组牌算法：枚举/DP 拆牌生成多种候选组法，调用 A 的 `Evaluator` 比选，目标最小手数、单牌 ≤3，输出映射到 actionList | `policy/arrange.ts` |
| 出牌牌理：首发策略、跟牌/垫牌策略、队友配合（送牌/接风/挡下家）、炸弹使用时机 | `policy/rule.ts`（实现 `RulePolicy`） |
| 贡还牌决策：实现 `TributePolicy`——进贡选牌（规则允许内损失最小）、还贡（≤10 过滤、不拆整牌、优先废单张）、抗贡识别 | `policy/tribute.ts` |
| 单元测试 + 与随机 bot 的胜率验证 | 测试与基线数据 |

### 成员 C —— 记牌器 / 手牌预测 / 末局剪枝搜索

| 职责 | 交付物 |
|---|---|
| 记牌器：108 张牌全量跟踪，剩余牌表、各点数剩余统计 | `search/tracker.ts`（实现 `CardTracker`） |
| 手牌预测：结合 PASS 历史做排除法，估计对手/队友持有炸弹与关键牌的概率 | `search/predict.ts` |
| 未知手牌采样器：按剩余牌分布生成合法对手手牌假设 | `search/sample.ts` |
| 末局搜索：采样 + minimax + alpha-beta 剪枝（带深度/时间限制），多次采样投票 | `search/endgame.ts`（实现 `EndgameSearch`） |
| 残局触发阈值调参、搜索性能测试（单次决策耗时上限） | 参数与耗时报告 |

### 依赖关系

```
A 的 GameState 与全部接口（含 Evaluator 签名）D1 冻结 ──► 三人并行开发
A 的 Evaluator ──► 供 B 的组牌选优与牌理打分调用（先交付简单版，权重逐步迭代）
C 的 CardTracker ──► 供 A 评估、B 牌理只读访问（D1 约定字段）
A/B/C 各自的 Policy ──► A 在 D5-6 统一集成进客户端与批量对战
```
