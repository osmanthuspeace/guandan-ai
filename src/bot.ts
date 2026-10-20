/**
 * 单座位客户端：连接游戏服务端，占一个座位，用指定策略自动对战。
 *
 * 用法：
 *   建房: npm run bot -- --user alice --policy rule [--seat 0] [--rounds 1]
 *   入房: npm run bot -- --user bob --policy rule-ns --room <roomId> --seat <0-3>
 *   跨机: 加 --url ws://<主机IP>:8181
 *
 * 说明：
 *   - userId 全服唯一，每人取不同值；座位 0&2 一队（Team0），1&3 一队（Team1）。
 *   - 其他同学可直接用本脚本换 --policy，或按 OpenGuanDan/README.md 第 3 节协议
 *     （CREATE_ROOM / JOIN_ROOM / PLAY / TRIBUTE / PAYTRIBUTE）用任意语言自写客户端接入。
 */
import { runBot } from "./client/bot.js";
import { makePolicy } from "./ai/policies.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const url = arg("url", "ws://127.0.0.1:8181")!;
  const user = arg("user", `bot_${Date.now() % 100000}`)!;
  const policyName = arg("policy", "rule")!;
  const room = arg("room");
  const seat = arg("seat");
  const rounds = Number(arg("rounds", "1"));

  console.log(`[${user}] 连接 ${url}，策略=${policyName}，` +
    (room === undefined ? "创建房间" : `加入房间 ${room}`));

  const res = await runBot({
    url, userId: user, policy: makePolicy(policyName),
    roomId: room === undefined ? undefined : Number(room),
    round: rounds,
    seatNum: seat === undefined ? undefined : Number(seat),
    onRoomCreated: (id) => console.log(room === undefined
      ? `房间已创建 roomId=${id}，把 roomId 发给其他玩家加入（--room ${id}）`
      : `已加入房间 roomId=${id}，等待满 4 人自动开局`),
  });

  if (res.victory === undefined) {
    console.log("连接关闭，对局未完成");
  } else {
    const mine = res.myPos % 2 === res.victory;
    console.log(`对局结束：座位 ${res.myPos}，Team${res.victory} 获胜（${mine ? "本方胜" : "对方胜"}）`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
