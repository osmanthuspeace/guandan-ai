# 掼蛋 AI

基于 [OpenGuanDan](https://github.com/GameAI-NJUPT/OpenGuanDan) 平台的掼蛋游戏 AI（TypeScript）。
方案详见 `doc/plan.md`（计划与分工）与 `doc/instruction.md`（算法原理通俗说明）。

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
│   ├── constraints.ts  #   PASS 历史 → 持牌上限约束               —— 成员 C
│   ├── predict.ts      #   手牌预测（排除法）                      —— 成员 C
│   └── endgame.ts      #   末局约束采样 + 拟人推演（rollout）       —— 成员 C
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


同学（队伍 B，座位 1&3）二选一接入：

```bash
npm run bot -- --url ws://192.168.3.61:8181 --user zhangsan --room 392 --seat 1 --policy rule-ns
```

注意：`userId` 全服唯一；队友坐 0&2 或 1&3；macOS 首次有外部连入时需在弹窗中
允许 java 接受传入连接；`--rounds N` 可打多场定胜负；断线不重连，重开一局即可。

### 4. 牌桌 UI（本地观战）

```bash
npm run server    # WS 服务 ws://127.0.0.1:8080/ws
npm run dev:web   # 前端页面 http://127.0.0.1:5173
```

页面顶栏有两种模式：

- **本机自对战**：自建房间，4 个座位全是本地 AI（A/B 队策略可选），即原来的本地观战；
- **联机约战**：我方 AI 只占座位 0&2，页面横幅显示房间号与加入命令，
  外部玩家（同学）占 1&3，满 4 人服务端自动开局，牌局实时在页面上展示。

牌桌中央记分板分两行：**大局**（跨场累计的胜场数，↺ 按钮清零）与**本场**（当前场的胜局数），
下方显示 第 N 局 · A队打X · B队打Y（整场先过 A 者胜）。局数可选 1/2/4/10。

计分实现：服务端 `gameOver` 通知只在整场末尾到达一次且无胜方字段，UI 改为按"任一队等级回退到 2"
探测场边界——每打完一场即更新大局、清零本场、局号从 1 重计。全部对局日志持久化到 `logs/games.log`。

AI 对战在 worker 线程中运行，不卡界面；游戏逻辑与渲染完全分离（worker 通过事件推送驱动页面）。

### 5. 离线冒烟测试（无需服务端）

```bash
npm run smoke
```

## 策略说明

注册表（`src/ai/policies.ts`）：

| 名称 | 构成 |
|------|------|
| `rule` | RouterPolicy 全量：贡还牌 + 牌理 + 末局搜索 |
| `rule-ns` | 同上但无末局搜索（快，适合大批量 bench 与对照实验） |
| `random` | 随机合法动作基线 |

- **RouterPolicy**：进贡/还贡 → `TributePolicy`；残局（有人剩牌 ≤ 阈值，默认 10）→ `EndgameSearch`；其余 → `RulePolicy`。
- **EndgameSearch**：先从历史 PASS 推断各家持牌上限做**约束采样**（对对手单/对/三 PASS → 无更大同类天然牌型；对炸 PASS → 无更大天然炸；队友让牌无信息；憋牌则推断自洽作废），猜牌 K 次；每种假设下做**拟人推演**（各家从自视角用牌理同款评分器选招，替代 minimax 的透视最坏情况假设），平均收益最高的动作胜出；候选由牌理评分预筛前 6，搜索均值超过牌理首选 25 分才允许覆盖，有效样本 <4 回退牌理（`rule` 实例为 16 采样 / 0.8s 上限，可调）。
- 简化假设：搜索模拟器只生成 单/对/三张/三带二/炸弹/四王，不生成顺子类长牌型；逢人配按原点数参与；接风规则简化。
- **实测结论**（换边对照，明细见 `doc/bench/`）：初版搜索对纯牌理 0:25 全败；修复"记牌器从不跨局重置"并上线约束采样后翻正（32 场：局 51.0% / 场 19:13），**搜索自此为 `rule` 默认**；此后推算引擎重写为拟人 rollout（32 场：局 48.3% / 场 17:15，与翻正版统计上不可区分，因更快、模型更干净而保留）；`rule` / `rule-ns` vs `random` 各 40:0。完整迭代记录见 `doc/plan.md` §5.2。
