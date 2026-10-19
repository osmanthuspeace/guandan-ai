# 掼蛋 AI

基于 [OpenGuanDan](https://github.com/GameAI-NJUPT/OpenGuanDan) 平台的掼蛋游戏 AI（TypeScript）。
方案详见 `plan.md`（计划与分工）与 `instruction.md`（算法原理通俗说明）。

## 架构

```
src/
├── types.ts            # 公共契约：GameState / Action / Policy / Arrangement / Evaluator
├── policy/             # 算法层
│   ├── patterns.ts     #   牌型识别（含逢人配）        —— 成员 B
│   ├── arrange.ts      #   组牌算法（先整后零贪心+评估比选）—— 成员 B
│   ├── rule.ts         #   出牌牌理 RulePolicy          —— 成员 B
│   ├── evaluate.ts     #   牌力评估 Evaluator           —— 成员 A
│   └── tribute.ts      #   贡还牌 TributePolicy         —— 成员 B
├── search/             # 算法层
│   ├── tracker.ts      #   记牌器 CardTracker           —— 成员 C
│   ├── predict.ts      #   手牌预测（排除法）            —— 成员 C
│   └── endgame.ts      #   末局采样+minimax+alpha-beta  —— 成员 C
├── ai/
│   ├── router.ts       # 顶层路由：贡还牌/末局搜索/牌理 分发
│   └── random.ts       # 随机基线
├── client/bot.ts       # WebSocket bot 运行器            —— 成员 A
├── state/gameState.ts  # 消息流 → GameState 状态机        —— 成员 A
├── bench/bench.ts      # 批量对战与胜率统计               —— 成员 A
└── ui/                 # 牌桌 UI（server.ts + aiWorker.ts 线程隔离）—— 成员 A
```

## 运行

前置：Node.js ≥ 18，`npm install`。

### 1. 启动游戏服务端（OpenGuanDan）

```bash
cd OpenGuanDan
# 首次需要解析依赖（jar 为瘦包）：
mkdir -p .server-run && cd .server-run
unzip -o -j ../guandan-java-1.0.0.jar META-INF/maven/com.guandan/guandan-java-pure/pom.xml -d .
mvn -q dependency:copy-dependencies -DoutputDirectory=deps
cd ..
java -cp "guandan-java-1.0.0.jar:.server-run/deps/*" com.guandan.GuandanServer
# 监听 ws://127.0.0.1:8181（Windows 用户也可直接运行 guandan.exe）
```

### 2. 批量对战（规则 AI vs 随机基线）

```bash
npm run bench -- --matches 5 --rounds 1 --p02 rule --p13 random
# Team0 = 座位 0&2，Team1 = 座位 1&3；p02/p13 可选 rule | random
```

### 3. 牌桌 UI

```bash
npm run server    # WS 服务 ws://127.0.0.1:8080/ws（会顺带 tsc 构建 worker）
npm run dev:web   # 前端页面 http://127.0.0.1:5173（/ws 由 Vite 代理到 8080）
```

页面中选择双方策略与局数后点"开始自动跑"。AI 对战在 worker 线程中运行，不卡界面；
游戏逻辑与渲染完全分离（worker 通过事件推送驱动页面）。

### 4. 离线冒烟测试（无需服务端）

```bash
npx tsx src/smoke.ts
```

## 策略说明

- **RouterPolicy**：进贡/还贡 → `TributePolicy`；残局（有人剩牌 ≤ 阈值，默认 10）→ `EndgameSearch`；其余 → `RulePolicy`。
- **EndgameSearch**：按记牌器分布采样对手手牌 K 次，每种假设下用 alpha-beta 剪枝推算到底，平均收益最高的动作胜出（默认 24 采样 / 1.5s 上限，可调）。
- 简化假设：搜索模拟器只生成 单/对/三张/三带二/炸弹/四王，不生成顺子类长牌型；接风规则简化。
