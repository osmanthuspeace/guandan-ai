# 掼蛋 AI

基于 [OpenGuanDan](https://github.com/GameAI-NJUPT/OpenGuanDan) 平台的掼蛋游戏 AI（TypeScript）。
方案详见 `plan.md`（计划与分工）与 `instruction.md`（算法原理通俗说明）。

## 架构

```
src/
├── types.ts            # 公共契约：GameState / Action / Policy / Arrangement / Evaluator
├── policy/             # 算法层
│   ├── patterns.ts     #   手牌工具 groupByRank                  —— 成员 B
│   ├── arrange.ts      #   组牌（5 套贪心候选 + 评估比选 + 缓存）  —— 成员 B
│   ├── rule.ts         #   出牌牌理 RulePolicy                    —— 成员 B
│   ├── evaluate.ts     #   牌力评估 Evaluator                     —— 成员 A
│   └── tribute.ts      #   贡还牌 TributePolicy                   —— 成员 B
├── search/             # 算法层
│   ├── tracker.ts      #   记牌器 CardTracker                     —— 成员 C
│   ├── predict.ts      #   手牌预测（排除法）                      —— 成员 C
│   └── endgame.ts      #   末局采样 + minimax + alpha-beta        —— 成员 C
├── ai/
│   ├── router.ts       # 顶层路由：贡还牌 / 末局搜索 / 牌理 分发
│   ├── policies.ts     # 策略注册表（rule / rule-ns / random）
│   └── random.ts       # 随机基线
├── client/bot.ts       # WebSocket bot 运行器（1 座位 = 1 连接）   —— 成员 A
├── bot.ts              # 单座位客户端入口（npm run bot）
├── state/gameState.ts  # 消息流 → GameState 状态机                —— 成员 A
├── bench/
│   ├── bench.ts        # 批量对战与胜率统计                        —— 成员 A
│   └── match.ts        # 跨机约战主机（队伍 A 本地，队伍 B 外部接入）
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
# 监听所有网卡的 8181 端口（Windows 用户也可直接运行 guandan.exe）
```

### 2. 批量对战（胜率评估）

```bash
npm run bench -- --matches 5 --rounds 1 --p02 rule --p13 random
# Team0 = 座位 0&2，Team1 = 座位 1&3；p02/p13 可选 rule | rule-ns | random
```

### 3. 跨机联机对战（和其他同学对打）

服务端本身是多人服务器：每个玩家一条 WebSocket 连接占一个座位，满 4 人自动开局。

```bash
# 主机（你）：建房，队伍 A（座位 0&2）用本方算法，开放座位 1&3
npm run match -- --policy rule
# 会打印 roomId 与局域网地址，例如：roomId=392，ws://192.168.3.61:8181
```

同学（队伍 B，座位 1&3）二选一接入：

```bash
# 方式一：用本仓库脚本（可在 src/ai/policies.ts 注册自己的策略后由 --policy 引用）
npm run bot -- --url ws://192.168.3.61:8181 --user zhangsan --room 392 --seat 1 --policy rule-ns

# 方式二：自写客户端（Python / Java 等任意语言，不依赖本仓库）
# 按 OpenGuanDan/README.md 第 3~5 节协议：连 ws://<主机IP>:8181 →
# JOIN_ROOM { userId, roomId, seatNum } → 收到 act 后从 actionList
# 选动作回 PLAY / TRIBUTE / PAYTRIBUTE
```

注意：`userId` 全服唯一；队友坐 0&2 或 1&3；macOS 首次有外部连入时需在弹窗中
允许 java 接受传入连接；`--rounds N` 可打多场定胜负；断线不重连，重开一局即可。

### 4. 牌桌 UI（本地观战）

```bash
npm run server    # WS 服务 ws://127.0.0.1:8080/ws（会顺带 tsc 构建 worker）
npm run dev:web   # 前端页面 http://127.0.0.1:5173（/ws 由 Vite 代理到 8080）
```

页面中选择双方策略与局数后点"开始自动跑"。AI 对战在 worker 线程中运行，不卡界面；
游戏逻辑与渲染完全分离（worker 通过事件推送驱动页面）。
该模式自建房间自对战，与联机约战互不相干。

### 5. 离线冒烟测试（无需服务端）

```bash
npm run smoke
```

## 策略说明

注册表（`src/ai/policies.ts`）：

| 名称 | 构成 |
|------|------|
| `rule` | RouterPolicy 全量：贡还牌 + 牌理 + 末局搜索 |
| `rule-ns` | 同上但无末局搜索（快，适合大批量 bench） |
| `random` | 随机合法动作基线 |

- **RouterPolicy**：进贡/还贡 → `TributePolicy`；残局（有人剩牌 ≤ 阈值，默认 10）→ `EndgameSearch`；其余 → `RulePolicy`。
- **EndgameSearch**：按记牌器分布采样对手手牌 K 次，每种假设下用 alpha-beta 剪枝推算到底，平均收益最高的动作胜出（默认 16 采样 / 0.8s 上限，可调）。
- 简化假设：搜索模拟器只生成 单/对/三张/三带二/炸弹/四王，不生成顺子类长牌型；接风规则简化。
