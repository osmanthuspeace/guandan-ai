/**
 * AI 对战 worker（成员 A）：在独立线程里跑 AI 对战，
 * 通过 postMessage 把牌局事件推给 UI 进程——自动跑绝不阻塞界面。
 * mode=local：本机四 AI 自对战；mode=match：联机约战（我方 AI 占 0&2，座位 1&3 等外部玩家）。
 * 一次 start = 一个 worker = 一场对决：服务端按 round 参数在同房间连打若干场
 * （每场从 2 打到过 A，场内含若干小局），全部场次打完 worker 退出。
 */
import { parentPort, workerData } from "node:worker_threads";
import { networkInterfaces } from "node:os";
import { runBot } from "../client/bot.js";
import { makePolicy } from "../ai/policies.js";
import {
  fmtAntiTribute, fmtEpisodeOver, fmtEpisodeStart, fmtFinish,
  fmtGameOver, fmtPlay, fmtResult, fmtTribute,
} from "./logFormat.js";
import { RANKS } from "../types.js";

/** 等级序号（2→A 递增），比较回退用；未知等级返回 -1 */
const rIdx = (r: string) => (RANKS as readonly string[]).indexOf(r);

interface WorkerConfig {
  url: string;
  rounds: number;
  /** local=本机四 AI 自对战；match=联机约战（我方 AI 占 0&2，座位 1&3 等外部玩家） */
  mode?: "local" | "match";
  p02: string; // rule / rule-ns / random
  p13: string;
}

const cfg = workerData as WorkerConfig;
const post = (m: Record<string, unknown>) => parentPort!.postMessage(m);

/** 本机局域网 IPv4（约战模式下展示给外部玩家填 --url 用） */
function lanIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const it of list ?? []) {
      if (it.family === "IPv4" && !it.internal) out.push(it.address);
    }
  }
  return out;
}

async function main() {
  const isMatch = cfg.mode === "match";
  const localSeatCount = isMatch ? 2 : 4; // 约战模式只有 0&2 两条本地连接
  let hands: Record<number, string[]> = {};
  let dealt = new Set<number>(); // 本局已上报手牌的本地座位
  let rests = [27, 27, 27, 27];
  let finished: number[] = [];
  let episode = 0;
  let score: [number, number] = [0, 0]; // 本场局比分 [A队胜局数, B队胜局数]
  let gameWins: [number, number] = [0, 0]; // 大局比分 [A队胜场数, B队胜场数]
  let gameCount = 0; // 已打完的场数
  let lastOrder: number[] = []; // 最近一局的名次（gameOver 缺 victory 时推导胜方用）
  let selfRank = "2", oppoRank = "2"; // 自己和对方当前打几
  let lastScore: [number, number] = [0, 0]; // 最近结束那一场的局比分快照（score 清零前保存，"末场胜局"用）
  // 场边界探测：实测本服务端 gameOver 只在全部场次末尾到达一次（OpenGuanDan README 4.1.7 亦无 victory 字段），
  // 不能靠它逐场入账。一场之内双方等级只升不降，任一队等级回退 ⇒ 上一场结束、新一场从 2 开始。
  let prevSelf: string | null = null, prevOppo: string | null = null;
  let resetSync = false; // 两队等级交错重置时屏蔽重复探测，直到双方都显示为 2
  // 服务端 beginning 不带等级（探针实测：仅 myPos/levelCard/handCards），
  // 新等级最早出现在本局"任意座位"的首个 act 里 → 开局标题推迟到那一刻打印；
  // 期间产生的本局日志（进贡/抗贡/领出）先缓冲，标题打出后再冲刷，保证标题在最前
  let pendingStart = false;
  let pendingHands: Record<number, string[]> = {};
  let episodeBuf: string[] = [];
  const logLine = (text: string) => post({ kind: "log", text });
  const emit = (text: string) => { if (pendingStart) episodeBuf.push(text); else logLine(text); };

  const onEvent = (seat: number) => (msg: Record<string, unknown>) => {
    if (msg.type === "act") {
      // act 的 self/oppo 是行动座位视角：偶数座 self=A队级，奇数座 self=B队级
      if (seat === 0) {
        if (msg.selfRank) selfRank = msg.selfRank as string;
        if (msg.oppoRank) oppoRank = msg.oppoRank as string;
      }
      if (pendingStart) {
        // 谁第一个行动就用谁的 act 刷新等级（奇偶座位归一化到 A/B 视角）
        const s = msg.selfRank as string | undefined;
        const o = msg.oppoRank as string | undefined;
        if (seat % 2 === 0) { if (s) selfRank = s; if (o) oppoRank = o; }
        else { if (s) oppoRank = s; if (o) selfRank = o; }
        pendingStart = false;
        // 场边界探测：任一队等级较上一局回退 ⇒ 上一场结束，逐场入账大局、清零本场
        if (prevSelf !== null && prevOppo !== null) {
          if (resetSync) {
            if (selfRank === "2" && oppoRank === "2") resetSync = false; // 双方显示已同步，解除屏蔽
          } else if (rIdx(selfRank) >= 0 && rIdx(oppoRank) >= 0 &&
                     (rIdx(selfRank) < rIdx(prevSelf) || rIdx(oppoRank) < rIdx(prevOppo))) {
            const w = lastOrder.length > 0 ? lastOrder[0] % 2 : null; // 胜方 = 末局头游队（过A必为末局头游队）
            if (w === 0 || w === 1) gameWins[w]++;
            gameCount++;
            lastScore = [...score];
            score = [0, 0];
            episode = 1; // 新一场的第 1 局
            post({ kind: "gameOver", victory: w, games: [...gameWins], game: gameCount });
            logLine(fmtGameOver(gameCount, w, [...gameWins]));
            resetSync = !(selfRank === "2" && oppoRank === "2"); // 双方同时回 2 则无需屏蔽
          }
        }
        prevSelf = selfRank; prevOppo = oppoRank;
        post({ kind: "start", hands: { ...pendingHands }, episode, selfRank, oppoRank });
        logLine(fmtEpisodeStart(episode, selfRank, oppoRank));
        for (const t of episodeBuf) logLine(t);
        episodeBuf = [];
      }
      return;
    }
    if (msg.type !== "notify") return;
    const stage = msg.stage as string;
    if (stage === "beginning") {
      hands[seat] = msg.handCards as string[];
      dealt.add(seat);
      if (seat === 0) {
        episode++;
        finished = [];
        rests = [27, 27, 27, 27];
      }
      if (dealt.size === localSeatCount) {
        // 手牌收齐，但等级要等本局首个 act 才是新值 → 先暂存，延后展示
        pendingHands = { ...hands };
        pendingStart = true;
        dealt = new Set();
      }
    } else if (stage === "play" && seat === 0) {
      // 出牌通知四家都会收到，只取 0 号连接的去重
      const curPos = msg.curPos as number;
      const curAction = msg.curAction as [string, string, string[]];
      post({
        kind: "play", curPos, curAction,
        greaterPos: msg.greaterPos, greaterAction: msg.greaterAction,
      });
      emit(fmtPlay(curPos, curAction));
      if (curAction[0] !== "PASS") {
        rests[curPos] = Math.max(0, rests[curPos] - curAction[2].length);
        if (rests[curPos] === 0 && !finished.includes(curPos)) {
          emit(fmtFinish(curPos, finished.length));
          finished.push(curPos);
        }
      }
    } else if ((stage === "tribute" || stage === "back") && seat === 0) {
      const result = (msg.result as [number, number, string][]) ?? [];
      post({ kind: stage, result });
      for (const line of fmtTribute(stage, result)) emit(line);
    } else if (stage === "anti-tribute" && seat === 0) {
      emit(fmtAntiTribute(msg.antiPos));
    } else if (stage === "episodeOver" && seat === 0) {
      const order = (msg.order as number[]) ?? [];
      if (order.length > 0) score[order[0] % 2]++; // 头游所在队赢下该局（0/2=A, 1/3=B）
      lastOrder = order;
      post({ kind: "episodeOver", order, curRank: msg.curRank, score: [...score] });
      logLine(fmtEpisodeOver(order, [...score]));
    } else if (stage === "gameOver" && seat === 0) {
      // 本服务端实测：gameOver 只在全部场次末尾到达一次（且无 victory 字段）。
      // 逐场入账由等级回退探测完成，这里只补记最后一场（已达场数上限则跳过，防重复）
      const rawV = msg.victory;
      const v = typeof rawV === "number" ? rawV % 2
        : lastOrder.length > 0 ? lastOrder[0] % 2 : null;
      if (gameCount < cfg.rounds) {
        if (v === 0 || v === 1) gameWins[v]++;
        gameCount++;
      }
      lastScore = [...score]; // 先快照"末场胜局"，再清零
      score = [0, 0];
      episode = 0;
      post({ kind: "gameOver", victory: v, games: [...gameWins], game: gameCount });
      logLine(fmtGameOver(gameCount, v, [...gameWins]));
    }
  };

  let resolveRoom!: (id: number) => void;
  const roomReady = new Promise<number>((res) => { resolveRoom = res; });
  const tag = Date.now() % 100000; // userId 全服唯一，带时间戳避免重启撞号
  const seats = [cfg.p02 ?? "rule", cfg.p13 ?? "random", cfg.p02 ?? "rule", cfg.p13 ?? "random"];
  const first = runBot({
    url: cfg.url, userId: `ui_${tag}_0`, policy: makePolicy(seats[0]),
    round: cfg.rounds, seatNum: 0,
    onRoomCreated: (id) => resolveRoom(id), onEvent: onEvent(0),
  });
  const roomId = await roomReady;
  const bots = [first];
  if (isMatch) {
    // 联机约战：座位 2 由我方 AI 占，1&3 留给外部玩家，满 4 人服务端自动开局
    const urls = (lanIps().length > 0 ? lanIps() : ["127.0.0.1"]).map((ip) => `ws://${ip}:8181`);
    post({ kind: "match", roomId, urls });
    logLine(`房间 roomId=${roomId} 已创建，等待外部玩家加入座位 1、3（满 4 人自动开局）`);
    bots.push(runBot({
      url: cfg.url, userId: `ui_${tag}_2`, policy: makePolicy(seats[2]),
      roomId, seatNum: 2, onEvent: onEvent(2),
    }));
  } else {
    for (let seat = 1; seat < 4; seat++) {
      bots.push(runBot({
        url: cfg.url, userId: `ui_${tag}_${seat}`, policy: makePolicy(seats[seat]),
        roomId, seatNum: seat, onEvent: onEvent(seat),
      }));
    }
  }
  const results = await Promise.all(bots);
  // 兜底：gameOver 完全没收到时按最终场胜方补记一场；否则最后一场已在 gameOver 分支入账（防重复）
  const finalV = results[0].victory;
  if ((finalV === 0 || finalV === 1) && gameCount < cfg.rounds) {
    gameWins[finalV % 2]++;
    gameCount++;
    lastScore = [...score];
  }
  post({
    kind: "result", victory: results[0].victory ?? null, episodes: results[0].episodes,
    score: [...lastScore], games: [...gameWins],
  });
  logLine(fmtResult(results[0].victory, results[0].episodes, [...lastScore], [...gameWins]));
}

main().catch((e) => post({ kind: "error", text: String(e) }));
