/**
 * AI 对战 worker（成员 A）：独立线程跑对战，事件经 postMessage 推给 UI。
 * mode=local 本机四 AI 自对战；mode=match 联机约战（我方 AI 占 0&2，1&3 等外部玩家）。
 * 一次 start 打 rounds 场（每场从 2 打到过 A），全部打完退出。
 */
import { parentPort, workerData } from "node:worker_threads";
import { networkInterfaces } from "node:os";
import { runBot } from "../client/bot.js";
import { makePolicy } from "../ai/policies.js";
import {
  fmtAntiTribute, fmtEpisodeOver, fmtEpisodeStart, fmtFinish,
  fmtGameOver, fmtPlay, fmtResult, fmtTribute,
} from "./logFormat.js";
interface WorkerConfig {
  url: string;
  rounds: number;
  mode?: "local" | "match";
  p02: string; // rule / rule-ns / random
  p13: string;
  /** 开局即手动步进，座 0 每手等「下一步」，避免开局后再切换的竞态 */
  manual?: boolean;
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
  let selfRank = "2", oppoRank = "2"; // 自己和对方当前打几
  let lastScore: [number, number] = [0, 0]; // 最近结束那一场的局比分快照（score 清零前保存，"末场胜局"用）
  // 服务端只在全部场次末尾广播一次 gameResult，中间场结束无消息，
  // 所以本地复刻服务端记分规则（含打A三次不过的退级惩罚）逐场入账
  let simScores: [number, number] = [0, 0]; // 两队等级分 0..12（0="2"…12="A"）
  let simPlayA: [number, number] = [0, 0];  // 两队打A失败次数
  let simPrevHead: number | null = null;    // 上一局头游座位
  let lastGameWinner: number | null = null; // 最近一场的胜方，gameResult 对账用
  let newGamePending = false;               // 下一局是新场第 1 局
  // beginning 不带等级，新等级要等本局首个 act 才知道，
  // 开局标题推迟到那一刻打印，期间的日志先进缓冲区
  let pendingStart = false;
  let pendingHands: Record<number, string[]> = {};
  let episodeBuf: string[] = [];
  const logLine = (text: string) => post({ kind: "log", text });
  const emit = (text: string) => { if (pendingStart) episodeBuf.push(text); else logLine(text); };

  // 手动步进：开启后，座 0 每次行动（出牌/进贡/还贡）前先等 UI 点「下一步」
  let manual = !!cfg.manual;
  let stepResolve: (() => void) | null = null;
  parentPort!.on("message", (m: { type?: string; on?: boolean }) => {
    if (m?.type === "step") {
      const r = stepResolve;
      stepResolve = null;
      r?.();
    } else if (m?.type === "setManual") {
      manual = !!m.on;
      // 等待中切回自动：立即放行，避免卡死
      if (!manual && stepResolve) { stepResolve(); stepResolve = null; }
    }
  });
  const seat0Gate = async (_act: unknown, chosen: [string, string, string[]]) => {
    if (!manual) return;
    // 把 AI 选好的动作一并推给页面：用户点「下一步」前能看到准备打的牌
    post({ kind: "awaiting", text: fmtPlay(0, chosen) });
    await new Promise<void>((res) => { stepResolve = res; });
  };

  /** 复刻服务端局末记分：升级、过A判场、打A惩罚。过A返回胜方(0=A队 1=B队)，否则 null */
  const simEpisode = (order: number[]): number | null => {
    if (order.length === 0) return null;
    const head = order[0];
    const wt = head & 1; // 头游队
    const partner = (head + 2) & 3;
    const up = order[1] === partner ? 3 : order[2] === partner ? 2 : 1;
    const prevTeam = simPrevHead === null ? -1 : simPrevHead & 1;
    if (prevTeam === wt && simScores[wt] === 12 && up > 1) {
      // 过A，场结束，记分状态清零
      simScores = [0, 0]; simPlayA = [0, 0]; simPrevHead = null;
      return wt;
    }
    if (prevTeam === wt && simScores[wt] === 12) {
      // 头游+末游：打A失败一次，满3次清零（随后还会+1）
      if (++simPlayA[wt] >= 3) { simScores[wt] = 0; simPlayA[wt] = 0; }
    } else if (prevTeam >= 0 && simScores[prevTeam] === 12) {
      // 头游易主：打A队记一次失败，满3次清零
      if (++simPlayA[prevTeam] >= 3) { simScores[prevTeam] = 0; simPlayA[prevTeam] = 0; }
    }
    simScores[wt] = Math.min(12, simScores[wt] + up);
    simPrevHead = head;
    return null;
  };

  const onEvent = (seat: number) => (msg: Record<string, unknown>) => {
    if (msg.type === "act") {
      // act 的 self/oppo 是行动座位视角：偶数座 self=A队级，奇数座 self=B队级
      if (seat === 0) {
        if (msg.selfRank) selfRank = msg.selfRank as string;
        if (msg.oppoRank) oppoRank = msg.oppoRank as string;
      }
      if (pendingStart) {
        // 用首个行动的 act 刷新等级，奇偶座位归一化到 A/B 视角
        const s = msg.selfRank as string | undefined;
        const o = msg.oppoRank as string | undefined;
        if (seat % 2 === 0) { if (s) selfRank = s; if (o) oppoRank = o; }
        else { if (s) oppoRank = s; if (o) selfRank = o; }
        pendingStart = false;
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
        episode = newGamePending ? 1 : episode + 1; // 新一场从第 1 局重排
        newGamePending = false;
        finished = [];
        rests = [27, 27, 27, 27];
      }
      if (dealt.size === localSeatCount) {
        // 手牌收齐先暂存，等首个 act 拿到新等级再展示
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
      post({ kind: "episodeOver", order, curRank: msg.curRank, score: [...score] });
      logLine(fmtEpisodeOver(order, [...score]));
      // 过A则场结束：入账大局，本场比分清零
      const gw = simEpisode(order);
      if (gw !== null) {
        gameWins[gw]++;
        gameCount++;
        lastGameWinner = gw;
        lastScore = [...score];
        score = [0, 0];
        newGamePending = true;
        post({ kind: "gameOver", victory: gw, games: [...gameWins], game: gameCount });
        logLine(fmtGameOver(gameCount, gw, [...gameWins]));
      }
    } else if (stage === "gameResult" && seat === 0) {
      // 服务端权威终局，只在全部场次末尾广播一次
      // 与本地入账对账：漏记则补，记错则以服务端为准
      const v = msg.victory;
      if (v === 0 || v === 1) {
        if (gameCount < cfg.rounds) {
          gameWins[v]++;
          gameCount++;
          lastGameWinner = v;
          lastScore = [...score];
          score = [0, 0];
          post({ kind: "gameOver", victory: v, games: [...gameWins], game: gameCount });
          logLine(fmtGameOver(gameCount, v, [...gameWins]));
        } else if (lastGameWinner !== null && lastGameWinner !== v) {
          gameWins[lastGameWinner]--;
          gameWins[v]++;
          lastGameWinner = v;
          post({ kind: "gameOver", victory: v, games: [...gameWins], game: gameCount });
          logLine(`对账修正：服务端判定末场胜方为${v === 0 ? "A" : "B"}队，大局已按服务端纠正`);
        }
      }
    }
    // gameOver 紧随 gameResult 广播，bot 收到 gameResult 即断连，这里收不到
  };

  let resolveRoom!: (id: number) => void;
  const roomReady = new Promise<number>((res) => { resolveRoom = res; });
  const tag = Date.now() % 100000; // userId 全服唯一，带时间戳避免重启撞号
  const seats = [cfg.p02 ?? "rule", cfg.p13 ?? "random", cfg.p02 ?? "rule", cfg.p13 ?? "random"];
  const first = runBot({
    url: cfg.url, userId: `ui_${tag}_0`, policy: makePolicy(seats[0]),
    round: cfg.rounds, seatNum: 0,
    onRoomCreated: (id) => resolveRoom(id), onEvent: onEvent(0),
    beforeAct: seat0Gate, // 仅座 0 挂手动闸门，其他座位全自动
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
  // 兜底：异常终止没打满场数时按服务端 victory 补记一场
  const finalV = results[0].victory;
  if ((finalV === 0 || finalV === 1) && gameCount < cfg.rounds) {
    gameWins[finalV]++;
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
