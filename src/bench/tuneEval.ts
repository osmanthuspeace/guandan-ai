/**
 * 评估权重调参（成员 A）：坐标上升 + bench 对战。
 * 每个权重维尝试 ×0.5 / ×2（其余保持现任值），候选与现任直接对打 N 场
 * （无末局搜索加速采样），候选胜场更多则采纳。结果写 bench/tuned-weights.json。
 *
 * 用法：
 *   tsx src/bench/tuneEval.ts [--url ws://127.0.0.1:8181] [--matches 4] [--sweeps 1] [--parallel 2]
 *   tsx src/bench/tuneEval.ts --verify [--matches 20]   # tuned-weights.json 挑战当前默认权重
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runBot } from "../client/bot.js";
import { RouterPolicy } from "../ai/router.js";
import { RulePolicy } from "../policy/rule.js";
import { HandEvaluator } from "../policy/evaluate.js";
import {
  ActionWeights, DEFAULT_ACTION_WEIGHTS, DEFAULT_EVAL_WEIGHTS,
  EvalWeights, Policy,
} from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "tuned-weights.json");

interface AllWeights { ev: EvalWeights; aw: ActionWeights; }

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function clone(w: AllWeights): AllWeights {
  return { ev: { ...w.ev }, aw: { ...w.aw } };
}

/** 无末局搜索的完整策略（调参采样速度优先；权重只影响中前期决策） */
function makeTeamPolicy(w: AllWeights): Policy {
  return new RouterPolicy({
    useEndgame: false,
    rule: new RulePolicy(new HandEvaluator({ ...w.ev }), { ...w.aw }),
  });
}

let botSeq = 0;
const MATCH_TIMEOUT_MS = Number(arg("matchTimeout", "150000"));

/** 打一场：挑战者坐 0&2（Team0），现任坐 1&3（Team1）。返回胜方 0/1/2(平)；超时按平计 */
async function playMatch(url: string, rounds: number, chal: AllWeights, champ: AllWeights): Promise<number> {
  const seq = botSeq++;
  let resolveRoom!: (id: number) => void;
  const roomReady = new Promise<number>((res) => { resolveRoom = res; });
  const mk = [makeTeamPolicy(chal), makeTeamPolicy(champ), makeTeamPolicy(chal), makeTeamPolicy(champ)];
  const first = runBot({
    url, userId: `tune_${seq}_0`, policy: mk[0], round: rounds, seatNum: 0,
    onRoomCreated: (id) => resolveRoom(id),
  });
  const roomId = await roomReady;
  const bots = [first];
  for (let seat = 1; seat < 4; seat++) {
    bots.push(runBot({ url, userId: `tune_${seq}_${seat}`, policy: mk[seat], roomId, seatNum: seat }));
  }
  const done = Promise.all(bots).then((r) => r[0].victory ?? 2).catch(() => 2);
  const timeout = new Promise<number>((res) => setTimeout(() => res(2), MATCH_TIMEOUT_MS));
  const v = await Promise.race([done, timeout]);
  if (v === 2) console.log(`  (match ${seq} 超时/异常，按平计)`);
  return v;
}

/** 简单并发池 */
async function pool<T>(n: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const ret: T[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < tasks.length) ret.push(await tasks[i++]());
  }));
  return ret;
}

/** 对打 N 场，返回 { chal, champ, draw } 胜场数 */
async function duel(
  url: string, matches: number, rounds: number, parallel: number,
  chal: AllWeights, champ: AllWeights,
): Promise<{ chal: number; champ: number; draw: number }> {
  const tasks = Array.from({ length: matches }, () => () => playMatch(url, rounds, chal, champ));
  const vs = await pool(parallel, tasks);
  return {
    chal: vs.filter((v) => v === 0).length,
    champ: vs.filter((v) => v === 1).length,
    draw: vs.filter((v) => v === 2).length,
  };
}

const DIMS: { group: "ev" | "aw"; key: string }[] = [
  { group: "ev", key: "perHand" },
  { group: "ev", key: "perSingle" },
  { group: "ev", key: "smallSingle" },
  { group: "ev", key: "perBomb" },
  { group: "ev", key: "perControl" },
  { group: "aw", key: "finish" },
  { group: "aw", key: "beatPartner" },
  { group: "aw", key: "intercept" },
  { group: "aw", key: "passPartner" },
  { group: "aw", key: "passDanger" },
];

async function main() {
  const url = arg("url", "ws://127.0.0.1:8181");
  const matches = Number(arg("matches", "4"));
  const rounds = Number(arg("rounds", "1"));
  const parallel = Number(arg("parallel", "2"));
  const sweeps = Number(arg("sweeps", "1"));
  const verify = process.argv.includes("--verify");

  const defaults: AllWeights = {
    ev: { ...DEFAULT_EVAL_WEIGHTS }, aw: { ...DEFAULT_ACTION_WEIGHTS },
  };

  if (verify) {
    if (!existsSync(OUT_FILE)) throw new Error("未找到 tuned-weights.json，先跑调参");
    const tuned = JSON.parse(readFileSync(OUT_FILE, "utf-8")) as AllWeights;
    console.log(`验证：tuned(Team0) vs 当前默认(Team1)，${matches} 场`);
    const r = await duel(url, matches, rounds, parallel, tuned, defaults);
    console.log(`tuned 胜 ${r.chal}，默认 胜 ${r.champ}，平 ${r.draw}`);
    process.exit(0);
  }

  const startFile = arg("start", "");
  let champ: AllWeights = startFile
    ? JSON.parse(readFileSync(startFile, "utf-8"))
    : clone(defaults);
  console.log(`起点权重: ${JSON.stringify(champ)}`);
  for (let s = 0; s < sweeps; s++) {
    console.log(`\n===== sweep ${s + 1}/${sweeps} =====`);
    for (const d of DIMS) {
      const cur = (champ[d.group] as unknown as Record<string, number>)[d.key];
      for (const mult of [0.5, 2]) {
        const trial = Math.round(cur * mult);
        if (trial === cur) continue;
        const cand = clone(champ);
        (cand[d.group] as unknown as Record<string, number>)[d.key] = trial;
        const r = await duel(url, matches, rounds, parallel, cand, champ);
        const tag = `${d.group}.${d.key}: ${cur} -> ${trial}`;
        if (r.chal > r.champ) {
          champ = cand;
          console.log(`[采纳] ${tag}  (${r.chal}:${r.champ}:${r.draw})`);
        } else {
          console.log(`[保留] ${tag}  (${r.chal}:${r.champ}:${r.draw})`);
        }
      }
    }
  }
  writeFileSync(OUT_FILE, JSON.stringify(champ, null, 2));
  console.log(`\n最终权重: ${JSON.stringify(champ)}`);
  console.log(`已写入 ${OUT_FILE}，可用 --verify 与默认权重对打验证`);
  process.exit(0); // 超时场次遗留的连接不阻塞退出
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
