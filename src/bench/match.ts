/**
 * 跨机约战主机：创建房间，队伍 A（座位 0&2）用本方算法自动出战，
 * 座位 1&3 开放给外部玩家（其他同学）连入，满 4 人自动开局。
 *
 * 用法：npm run match -- [--policy rule] [--rounds 1] [--url ws://127.0.0.1:8181]
 *
 * 外部玩家加入方式（二选一）：
 *   1. 用本仓库脚本：
 *      npm run bot -- --url ws://<主机IP>:8181 --user <唯一ID> --room <roomId> --seat <1|3> --policy <策略>
 *   2. 自写客户端（任意语言）：按 OpenGuanDan/README.md 第 3 节协议，
 *      连 ws://<主机IP>:8181 后发 JOIN_ROOM { userId, roomId, seatNum }，
 *      收到 act 消息从 actionList 选动作回 PLAY / TRIBUTE / PAYTRIBUTE。
 */
import { networkInterfaces } from "node:os";
import { runBot } from "../client/bot.js";
import { makePolicy } from "../ai/policies.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

/** 本机局域网 IPv4 地址（给同学填 --url 用） */
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
  const url = arg("url", "ws://127.0.0.1:8181");
  const policyName = arg("policy", "rule");
  const rounds = Number(arg("rounds", "1"));
  const tag = Date.now() % 100000;

  // 队伍 A 座位 0 建房
  let resolveRoom!: (id: number) => void;
  const roomReady = new Promise<number>((res) => { resolveRoom = res; });
  const seat0 = runBot({
    url, userId: `A0_${tag}`, policy: makePolicy(policyName),
    round: rounds, seatNum: 0,
    onRoomCreated: (id) => resolveRoom(id),
  });
  const roomId = await roomReady;
  // 队伍 A 座位 2 入房
  const seat2 = runBot({
    url, userId: `A2_${tag}`, policy: makePolicy(policyName),
    roomId, seatNum: 2,
  });

  console.log(`房间 roomId=${roomId} 已创建，队伍 A（座位 0&2）= ${policyName}，局数=${rounds}`);
  console.log("等待队伍 B 两位玩家加入座位 1、3（满 4 人自动开局，可随时 Ctrl+C 取消）");
  console.log("同学加入命令：");
  const ips = lanIps();
  const hosts = ips.length > 0 ? ips : ["<主机IP>"];
  for (const ip of hosts) {
    console.log(`  npm run bot -- --url ws://${ip}:8181 --user <唯一ID> --room ${roomId} --seat <1|3> --policy <策略>`);
  }
  console.log(`或自写客户端按 OpenGuanDan/README.md 协议 JOIN_ROOM roomId=${roomId}`);

  const [r0] = await Promise.all([seat0, seat2]);
  if (r0.victory === undefined) {
    console.log("对局结束（连接关闭，未分出胜负）");
  } else {
    console.log(`对局结束：Team${r0.victory} 获胜（${r0.victory === 0 ? "队伍 A 胜" : "队伍 B 胜"}），共 ${r0.episodes} 局`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
