/**
 * UI 服务（成员 A）：仅提供 WebSocket 推送牌局事件，AI 对战在 worker 线程中运行。
 * 前端页面由 Vite dev server 提供（http://127.0.0.1:5173，/ws 已代理到本服务），
 * 本服务不再托管静态文件；直接访问本端口会 302 到 Vite。
 * 用法：npm run server（本服务）+ npm run dev:web（前端）
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const WEB_DEV_URL = process.env.WEB_DEV_URL ?? "http://127.0.0.1:5173";

const server = createServer((req, res) => {
  // 非 WS 的 HTTP 请求一律转到前端 dev server
  res.writeHead(302, { location: WEB_DEV_URL + (req.url ?? "/") });
  res.end();
});

const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set<WebSocket>();
let worker: Worker | null = null;

function broadcast(m: Record<string, unknown>) {
  const s = JSON.stringify(m);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(s);
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "start") {
      worker?.terminate();
      // worker 加载编译后的 JS（tsx 在 worker 线程中无法解析 .ts 入口）：
      // 兼容从 src/（tsx 开发态）与 dist/（编译产物）两种启动位置
      const candidates = [
        join(__dirname, "../../dist/ui/aiWorker.js"),
        join(__dirname, "./aiWorker.js"),
      ];
      const entry = candidates.find((p) => existsSync(p));
      if (!entry) {
        broadcast({ kind: "error", text: "未找到 dist/ui/aiWorker.js，请先运行 npm run build" });
        return;
      }
      worker = new Worker(entry, {
        workerData: {
          url: msg.gameUrl ?? "ws://127.0.0.1:8181",
          rounds: Number(msg.rounds ?? 1),
          p02: msg.p02 ?? "rule",
          p13: msg.p13 ?? "random",
        },
      });
      worker.on("message", broadcast);
      worker.on("error", (e) => broadcast({ kind: "error", text: String(e) }));
      broadcast({ kind: "log", text: "对战已启动（worker 线程）" });
    } else if (msg.type === "stop") {
      worker?.terminate();
      worker = null;
      broadcast({ kind: "log", text: "对战已停止" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`WS 服务已启动: ws://127.0.0.1:${PORT}/ws`);
  console.log(`前端页面: ${WEB_DEV_URL}（npm run dev:web 启动；访问 :${PORT} 会自动跳转）`);
  console.log(`（需先启动 OpenGuanDan 服务端 ws://127.0.0.1:8181）`);
});
