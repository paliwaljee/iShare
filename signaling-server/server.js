const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const peers = new Map();       // id -> websocket
const codes = new Map();       // code -> id

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true, service: "intrasend-style-p2p" }));

function code() {
  let c;
  do c = String(crypto.randomInt(100000, 1000000));
  while (codes.has(c));
  return c;
}
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function relay(targetId, data) {
  const ws = peers.get(targetId);
  if (ws) send(ws, data);
}

wss.on("connection", ws => {
  const id = crypto.randomUUID();
  const pairingCode = code();
  peers.set(id, ws);
  codes.set(pairingCode, id);

  send(ws, { type: "hello", id, pairingCode });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "pair") {
      const targetId = codes.get(String(msg.code || ""));
      if (!targetId || targetId === id) {
        send(ws, { type: "pair-error", message: "Invalid pairing code." });
        return;
      }
      send(ws, { type: "paired", peerId: targetId });
      relay(targetId, { type: "paired", peerId: id });
      return;
    }

    if (msg.type === "signal" && msg.to && msg.data) {
      relay(msg.to, { type: "signal", from: id, data: msg.data });
    }
  });

  ws.on("close", () => {
    peers.delete(id);
    codes.delete(pairingCode);
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => console.log(`IntraSend-style P2P: http://localhost:${PORT}`));
