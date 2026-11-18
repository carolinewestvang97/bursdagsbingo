// Bursdagsbingo – liten server uten avhengigheter (Node 18+).
// Serverer siden og holder styr på spillerne i hver runde, med live-oppdatering (SSE).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, "public", "index.html");
const MAX_ROOMS = 300, MAX_PLAYERS = 300, ROOM_TTL = 12 * 3600 * 1000;

const rooms = new Map(); // code -> { players: Map(pid -> data), subs: Set(res), touched }

function getRoom(code, create) {
  let r = rooms.get(code);
  if (!r && create) {
    if (rooms.size >= MAX_ROOMS) return null;
    r = { players: new Map(), subs: new Set(), touched: Date.now() };
    rooms.set(code, r);
  }
  return r || null;
}
function snapshot(r) {
  const now = Date.now();
  return JSON.stringify([...r.players.values()].map(p => ({ pid: p.pid, name: p.name, filled: p.filled, lines: p.lines, size: p.size, age: now - p.ts })));
}
function push(r) {
  const msg = "data: " + snapshot(r) + "\n\n";
  for (const res of r.subs) { try { res.write(msg); } catch (e) {} }
}
const validCode = c => /^[A-Z0-9]{3,6}$/.test(c);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); return res.end("Mangler public/index.html"); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(buf);
    });
    return;
  }
  if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }

  // Spiller sender status
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "p" && validCode(parts[2] || "")) {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on("end", () => {
      let d; try { d = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
      if (!d || typeof d.pid !== "string" || !/^[a-z0-9]{4,20}$/.test(d.pid)) { res.writeHead(400); return res.end(); }
      const r = getRoom(parts[2], true);
      if (!r) { res.writeHead(503); return res.end(); }
      if (!r.players.has(d.pid) && r.players.size >= MAX_PLAYERS) { res.writeHead(503); return res.end(); }
      const size = Math.max(1, Math.min(100, Number(d.size) || 16));
      const next = {
        pid: d.pid,
        name: String(d.name || "Gjest").replace(/\s+/g, " ").trim().slice(0, 30) || "Gjest",
        filled: Math.max(0, Math.min(size, Math.floor(Number(d.filled) || 0))),
        lines: Math.max(0, Math.min(20, Math.floor(Number(d.lines) || 0))),
        size, ts: Date.now()
      };
      const prev = r.players.get(d.pid);
      const changed = !prev || prev.name !== next.name || prev.filled !== next.filled || prev.lines !== next.lines || (Date.now() - prev.ts) > 25000;
      r.players.set(d.pid, next); r.touched = Date.now();
      res.writeHead(204); res.end();
      if (changed) push(r);
    });
    return;
  }

  // Storskjerm lytter
  if (req.method === "GET" && parts[0] === "api" && parts[1] === "s" && validCode(parts[2] || "")) {
    const r = getRoom(parts[2], true);
    if (!r) { res.writeHead(503); return res.end(); }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 2000\n\n");
    r.subs.add(res);
    res.write("data: " + snapshot(r) + "\n\n");
    req.on("close", () => r.subs.delete(res));
    return;
  }

  res.writeHead(404); res.end("Fant ikke siden");
});

// Oppdater «frakoblet»-status og hold forbindelsene våkne
setInterval(() => {
  for (const [code, r] of rooms) {
    if (r.subs.size) { for (const res of r.subs) { try { res.write(": ping\n\n"); } catch (e) {} } push(r); }
    else if (Date.now() - r.touched > ROOM_TTL) rooms.delete(code);
  }
}, 5000);

server.listen(PORT, () => console.log("Bursdagsbingo kjører på port " + PORT));
