/**
 * 批量对战（成员 A）：N 场自动 PK，统计两队胜率。
 * 用法：tsx src/bench/bench.ts [--url ws://127.0.0.1:8181] [--matches 5]
 *       [--rounds 1] [--p02 rule] [--p13 random]
 * 按队伍配置算法（rule / rule-ns / random，同队两座位相同）；座位 0&2 为 Team0，1&3 为 Team1。
 */
import { runBot } from "../client/bot.js";
import { makePolicy } from "../ai/policies.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const url = arg("url", "ws://127.0.0.1:8181");
  const matches = Number(arg("matches", "5"));
  const rounds = Number(arg("rounds", "1"));
  const p02 = arg("p02", "rule");
  const p13 = arg("p13", "random");
  const seats = [p02, p13, p02, p13];

  let win0 = 0, win1 = 0, draws = 0, totalEpisodes = 0, epWin0 = 0, epWin1 = 0;

  for (let m = 0; m < matches; m++) {
    // 先建房的拿 roomId，其余三人加入
    let resolveRoom!: (id: number) => void;
    const roomReady = new Promise<number>((res) => { resolveRoom = res; });
    const first = runBot({
      url, userId: `t0_${m}`, policy: makePolicy(seats[0]), round: rounds, seatNum: 0,
      onRoomCreated: (id) => resolveRoom(id),
    });
    const roomId = await roomReady;
    const bots = [first];
    for (let seat = 1; seat < 4; seat++) {
      bots.push(runBot({
        url, userId: `t${seat}_${m}`, policy: makePolicy(seats[seat]),
        roomId, seatNum: seat,
      }));
    }
    const results = await Promise.all(bots);
    const v = results[0].victory;
    if (v === 0) win0++; else if (v === 1) win1++; else draws++;
    totalEpisodes += results[0].episodes || rounds;
    epWin0 += results[0].epWins ?? 0;
    epWin1 += results[1].epWins ?? 0;
    console.log(`[match ${m + 1}/${matches}] victory=${v} episodes=${results[0].episodes}`);
  }

  console.log("\n===== 统计 =====");
  console.log(`Team0(${p02}) 胜 ${win0} 场，Team1(${p13}) 胜 ${win1} 场，平 ${draws}`);
  console.log(`总对局 ${totalEpisodes}，Team0 局胜率 ${(epWin0 / Math.max(1, totalEpisodes) * 100).toFixed(1)}%`
    + `（场胜率 ${(win0 / Math.max(1, matches) * 100).toFixed(1)}%，局胜 ${epWin0}:${epWin1}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
