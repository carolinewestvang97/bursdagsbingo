// Bursdagsbingo – liten server uten avhengigheter (Node 18+).
// Serverer siden, holder styr på spillerne og selve spillet (bingo-krav, godkjenning, vinnere).
// Live-oppdatering skjer med SSE (server -> nettleser) og vanlige POST-kall (nettleser -> server).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, "public", "index.html");
const MAX_ROOMS = 300, MAX_PLAYERS = 300, MAX_QUEUE = 30, ROOM_TTL = 12 * 3600 * 1000;
const CELLS = 16;

const rooms = new Map();

function getRoom(code, create) {
  let r = rooms.get(code);
  if (!r && create) {
    if (rooms.size >= MAX_ROOMS) return null;
    r = {
      players: new Map(),            // pid -> { pid, name, filled, lines, size, ts }
      hosts: new Set(),              // åpne SSE-forbindelser fra storskjermen
      pubs: new Set(),               // åpne SSE-forbindelser fra spillere: { res, pid }
      hostKey: null,                 // hemmelig nøkkel som storskjermen bruker
      round: 0,
      winners: { line: null, full: null },   // { pid, name }
      queue: [],                     // ventende bingo-krav
      rejected: new Map(),           // pid -> { line, full }
      nextId: 1,
      touched: Date.now()
    };
    rooms.set(code, r);
  }
  return r || null;
}

const validCode = c => /^[A-Z0-9]{3,6}$/.test(c);
const validPid = p => typeof p === "string" && /^[a-z0-9]{4,20}$/.test(p);
const validKey = k => typeof k === "string" && /^[A-Za-z0-9]{16,64}$/.test(k);
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

function isDone(r) { return !!(r.winners.line && r.winners.full); }

function gameFor(r, pid) {
  const pend = r.queue[0];
  const done = isDone(r);
  const rej = r.rejected.get(pid) || {};
  const pq = { line: false, full: false };
  for (const c of r.queue) if (c.pid === pid) pq[c.kind] = true;
  return {
    round: r.round,
    done,
    frozen: done || r.queue.length > 0,
    pending: pend ? { pid: pend.pid, name: pend.name, kind: pend.kind } : null,
    winners: { line: r.winners.line, full: r.winners.full },
    you: { pending: pq, rejected: { line: !!rej.line, full: !!rej.full } }
  };
}
function hostSnap(r) {
  const now = Date.now();
  return {
    players: [...r.players.values()].map(p => ({ pid: p.pid, name: p.name, filled: p.filled, lines: p.lines, size: p.size, age: now - p.ts })),
    game: {
      round: r.round, done: isDone(r), winners: r.winners,
      queue: r.queue.map(c => ({ id: c.id, pid: c.pid, name: c.name, kind: c.kind, answers: c.answers }))
    }
  };
}
function send(res, obj) { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch (e) {} }
function pushHost(r) { if (!r.hosts.size) return; const s = hostSnap(r); for (const res of r.hosts) send(res, s); }
function pushPlayers(r) { for (const p of r.pubs) send(p.res, gameFor(r, p.pid)); }
function pushAll(r) { pushHost(r); pushPlayers(r); }

function readJson(req, res, limit, cb) {
  let body = "";
  req.on("data", c => { body += c; if (body.length > limit) { res.writeHead(413); res.end(); req.destroy(); } });
  req.on("end", () => {
    let d; try { d = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
    if (!d || typeof d !== "object") { res.writeHead(400); return res.end(); }
    cb(d);
  });
}
// Første storskjerm som melder seg på en runde eier den. Andre med feil nøkkel nektes.
function hostAuth(r, key) {
  if (!validKey(key)) return false;
  if (!r.hostKey) r.hostKey = key;
  return r.hostKey === key;
}
function dropObsoleteClaims(r) {
  r.queue = r.queue.filter(c => !r.winners[c.kind]);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  const code = parts[2] || "";

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); return res.end("Mangler public/index.html"); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(buf);
    });
    return;
  }
  if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (parts[0] !== "api" || !validCode(code)) { res.writeHead(404); return res.end("Fant ikke siden"); }

  // Spiller sender status (navn og antall ruter)
  if (req.method === "POST" && parts[1] === "p") {
    return readJson(req, res, 2000, d => {
      if (!validPid(d.pid)) { res.writeHead(400); return res.end(); }
      const r = getRoom(code, true);
      if (!r) { res.writeHead(503); return res.end(); }
      if (!r.players.has(d.pid) && r.players.size >= MAX_PLAYERS) { res.writeHead(503); return res.end(); }
      const size = Math.max(1, Math.min(100, Number(d.size) || CELLS));
      const next = {
        pid: d.pid, name: clean(d.name, 30) || "Gjest",
        filled: Math.max(0, Math.min(size, Math.floor(Number(d.filled) || 0))),
        lines: Math.max(0, Math.min(20, Math.floor(Number(d.lines) || 0))),
        size, ts: Date.now()
      };
      const prev = r.players.get(d.pid);
      const changed = !prev || prev.name !== next.name || prev.filled !== next.filled || prev.lines !== next.lines || (Date.now() - prev.ts) > 25000;
      r.players.set(d.pid, next); r.touched = Date.now();
      res.writeHead(204); res.end();
      if (changed) pushHost(r);
    });
  }

  // Spiller roper bingo
  if (req.method === "POST" && parts[1] === "c") {
    return readJson(req, res, 8000, d => {
      if (!validPid(d.pid) || (d.kind !== "line" && d.kind !== "full")) { res.writeHead(400); return res.end(); }
      const r = getRoom(code, true);
      if (!r) { res.writeHead(503); return res.end(); }
      const answers = Array.isArray(d.answers) ? d.answers.slice(0, CELLS).map(a => ({ s: clean(a && a.s, 80), n: clean(a && a.n, 30) })) : [];
      if (answers.length !== CELLS) { res.writeHead(400); return res.end(); }
      if (isDone(r) || r.winners[d.kind] || r.queue.length >= MAX_QUEUE) { res.writeHead(409); return res.end(); }
      r.queue = r.queue.filter(c => !(c.pid === d.pid && c.kind === d.kind));
      const name = clean(d.name, 30) || (r.players.get(d.pid) || {}).name || "Gjest";
      r.queue.push({ id: r.nextId++, pid: d.pid, name, kind: d.kind, answers, ts: Date.now() });
      const rej = r.rejected.get(d.pid); if (rej) rej[d.kind] = false;
      r.touched = Date.now();
      res.writeHead(204); res.end();
      pushAll(r);
    });
  }

  // Spiller lytter på spillstatus (frys, vinnere, avslag …)
  if (req.method === "GET" && parts[1] === "g") {
    const pid = url.searchParams.get("pid");
    if (!validPid(pid)) { res.writeHead(400); return res.end(); }
    const r = getRoom(code, true);
    if (!r) { res.writeHead(503); return res.end(); }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 2000\n\n");
    const entry = { res, pid };
    r.pubs.add(entry);
    send(res, gameFor(r, pid));
    req.on("close", () => r.pubs.delete(entry));
    return;
  }

  // Storskjerm: meld på / sjekk nøkkel
  if (req.method === "POST" && parts[1] === "h" && parts[3] === "auth") {
    return readJson(req, res, 500, d => {
      const r = getRoom(code, true);
      if (!r) { res.writeHead(503); return res.end(); }
      res.writeHead(hostAuth(r, d.key) ? 204 : 403); res.end();
    });
  }
  // Storskjerm: godkjenn / avslå
  if (req.method === "POST" && parts[1] === "h" && parts[3] === "decide") {
    return readJson(req, res, 1000, d => {
      const r = getRoom(code, false);
      if (!r || !hostAuth(r, d.key)) { res.writeHead(403); return res.end(); }
      const i = r.queue.findIndex(c => c.id === d.id);
      if (i === -1) { res.writeHead(409); return res.end(); }
      const [c] = r.queue.splice(i, 1);
      if (d.accept === true) {
        if (!r.winners[c.kind]) {
          r.winners[c.kind] = { pid: c.pid, name: c.name };
          // Et fullt brett inneholder alltid fire på rad
          if (c.kind === "full" && !r.winners.line) r.winners.line = { pid: c.pid, name: c.name };
        }
        dropObsoleteClaims(r);
      } else {
        const rej = r.rejected.get(c.pid) || { line: false, full: false };
        rej[c.kind] = true; r.rejected.set(c.pid, rej);
      }
      r.touched = Date.now();
      res.writeHead(204); res.end();
      pushAll(r);
    });
  }
  // Storskjerm: ny runde
  if (req.method === "POST" && parts[1] === "h" && parts[3] === "reset") {
    return readJson(req, res, 1000, d => {
      const r = getRoom(code, false);
      if (!r || !hostAuth(r, d.key)) { res.writeHead(403); return res.end(); }
      r.round++; r.winners = { line: null, full: null }; r.queue = []; r.rejected = new Map();
      r.players.clear(); r.touched = Date.now();
      res.writeHead(204); res.end();
      pushAll(r);
    });
  }

  // Storskjerm lytter (krever nøkkel)
  if (req.method === "GET" && parts[1] === "s") {
    const r = getRoom(code, true);
    if (!r) { res.writeHead(503); return res.end(); }
    if (!hostAuth(r, url.searchParams.get("key"))) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 2000\n\n");
    r.hosts.add(res);
    send(res, hostSnap(r));
    req.on("close", () => r.hosts.delete(res));
    return;
  }

  res.writeHead(404); res.end("Fant ikke siden");
});

// Hold forbindelsene våkne, oppdater «frakoblet»-status og rydd bort gamle runder
setInterval(() => {
  for (const [code, r] of rooms) {
    for (const res of r.hosts) { try { res.write(": ping\n\n"); } catch (e) {} }
    for (const p of r.pubs) { try { p.res.write(": ping\n\n"); } catch (e) {} }
    if (r.hosts.size) pushHost(r);
    else if (!r.pubs.size && Date.now() - r.touched > ROOM_TTL) rooms.delete(code);
  }
}, 5000);

server.listen(PORT, () => console.log("Bursdagsbingo kjører på port " + PORT));
