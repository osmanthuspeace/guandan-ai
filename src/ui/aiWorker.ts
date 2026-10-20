/**
 * AI 对战 worker（成员 A）：在独立线程里跑 4 个 bot 的完整对战，
 * 通过 postMessage 把牌局事件推给 UI 进程——自动跑绝不阻塞界面。
 */
import { parentPort, workerData } from "node:worker_threads";
import { runBot } from "../client/bot.js";
import { makePolicy } from "../ai/policies.js";
import {
  fmtAntiTribute, fmtEpisodeOver, fmtEpisodeStart, fmtFinish,
  fmtPlay, fmtResult, fmtTribute,
} from "./logFormat.js";

interface WorkerConfig {
  url: string;
  rounds: number;
  p02: string; // Team0（座位0&2）策略名：rule / rule-ns / random
  p13: string; // Team1（座位1&3）策略名
}

const cfg = workerData as WorkerConfig;
const post = (m: Record<string, unknown>) => parentPort!.postMessage(m);

async function main() {
  let hands: Record<number, string[]> = {};
  let dealt = new Set<number>(); // 本局已上报手牌的座位
  let rests = [27, 27, 27, 27];
  let finished: number[] = [];
  let episode = 0;
  let selfRank = "2", oppoRank = "2";// 自己和对方当前打几
  const logLine = (text: string) => post({ kind: "log", text });

  const onEvent = (seat: number) => (msg: Record<string, unknown>) => {
    // act 请求里带权威的 selfRank/oppoRank（beginning 通知里没有），在座0连接上同步
    if (msg.type === "act") {
      if (seat === 0) {
        if (msg.selfRank) selfRank = msg.selfRank as string;
        if (msg.oppoRank) oppoRank = msg.oppoRank as string;
      }
      return;
    }
    if (msg.type !== "notify") return;
    const stage = msg.stage as string;
    if (stage === "beginning") {
      // 服务端向四条连接广播同一事件流：单连接内严格有序，跨连接到达无序。
      // 局号/等级/局头只以座0连接为权威推进（否则跨连接竞态会导致局头重复、
      // 局号漂移、等级显示过时）；手牌每家只发自己的，仍需四连接拼齐仅供展示。
      hands[seat] = msg.handCards as string[];
      dealt.add(seat);
      if (seat === 0) {
        episode++;
        finished = [];
        rests = [27, 27, 27, 27];
        logLine(fmtEpisodeStart(episode, selfRank, oppoRank));
      }
      if (dealt.size === 4) {
        post({ kind: "start", hands: { ...hands }, episode, selfRank, oppoRank });
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
      logLine(fmtPlay(curPos, curAction));
      if (curAction[0] !== "PASS") {
        rests[curPos] = Math.max(0, rests[curPos] - curAction[2].length);
        if (rests[curPos] === 0 && !finished.includes(curPos)) {
          logLine(fmtFinish(curPos, finished.length));
          finished.push(curPos);
        }
      }
    } else if ((stage === "tribute" || stage === "back") && seat === 0) {
      const result = (msg.result as [number, number, string][]) ?? [];
      post({ kind: stage, result });
      for (const line of fmtTribute(stage, result)) logLine(line);
    } else if (stage === "anti-tribute" && seat === 0) {
      logLine(fmtAntiTribute(msg.antiPos));
    } else if (stage === "episodeOver" && seat === 0) {
      const order = (msg.order as number[]) ?? [];
      post({ kind: "episodeOver", order, curRank: msg.curRank });
      logLine(fmtEpisodeOver(order, (msg.curRank as string) ?? ""));
    }
  };

  let resolveRoom!: (id: number) => void;
  const roomReady = new Promise<number>((res) => { resolveRoom = res; });
  const seats = [cfg.p02 ?? "rule", cfg.p13 ?? "random", cfg.p02 ?? "rule", cfg.p13 ?? "random"];
  const first = runBot({
    url: cfg.url, userId: "ui_0", policy: makePolicy(seats[0]),
    round: cfg.rounds, seatNum: 0,
    onRoomCreated: (id) => resolveRoom(id), onEvent: onEvent(0),
  });
  const roomId = await roomReady;
  const bots = [first];
  for (let seat = 1; seat < 4; seat++) {
    bots.push(runBot({
      url: cfg.url, userId: `ui_${seat}`, policy: makePolicy(seats[seat]),
      roomId, seatNum: seat, onEvent: onEvent(seat),
    }));
  }
  const results = await Promise.all(bots);
  post({ kind: "result", victory: results[0].victory, episodes: results[0].episodes });
  logLine(fmtResult(results[0].victory, results[0].episodes));
}

main().catch((e) => post({ kind: "error", text: String(e) }));
