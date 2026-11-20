// Quiz-modul: lag svarer på spørsmål som vises på storskjermen. Brukes fra server.js.
// Lag → server: vanlige POST-kall. Server → lag/storskjerm: SSE (live-oppdatering).
const fs = require("fs");
const path = require("path");

let Q = [];
function loadQuestions() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
  Q = (raw.questions || []).filter(q => !q.todo);
  return Q.length;
}
loadQuestions();

const MAX_ROOMS = 100, MAX_TEAMS = 60, ROOM_TTL = 12 * 3600 * 1000;
const rooms = new Map();

const validCode = c => /^[A-Z0-9]{3,6}$/.test(c);
const validTid = t => typeof t === "string" && /^[a-z0-9]{4,20}$/.test(t);
const validKey = k => typeof k === "string" && /^[A-Za-z0-9]{16,64}$/.test(k);
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

function getRoom(code, create) {
  let r = rooms.get(code);
  if (!r && create) {
    if (rooms.size >= MAX_ROOMS) return null;
    r = { teams: new Map(), state: "lobby", qi: -1, answers: new Map(), hostKey: null, hosts: new Set(), subs: new Set(), touched: Date.now() };
    rooms.set(code, r);
  }
  return r || null;
}

// ---------- Svar-sjekk ----------
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9æøå]+/g, " ").trim().replace(/\s+/g, " ");
}
const dropArticle = s => s.replace(/^(en|et|ei|a|an|the)\s+/, "");
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
function textMatch(q, ans) {
  const n = dropArticle(norm(ans.text));
  if (!n) return false;
  for (const acc of q.accept || []) {
    const na = dropArticle(norm(acc));
    if (n === na) return true;
    const allow = na.length >= 8 ? 2 : na.length >= 5 ? 1 : 0;
    if (allow && lev(n, na) <= allow) return true;
  }
  if (q.regex) { try { if (new RegExp(q.regex, "i").test(norm(ans.text))) return true; } catch (e) {} }
  return false;
}
// Regler for flervalg: +perCorrect per riktig, +perWrong (negativt) per feil, aldri under min og aldri over maks
function sc(q) { return Object.assign({ perCorrect: 1, perWrong: -1, min: -1 }, q.scoring || {}); }
function maxPts(q) {
  if (q.type === "choice" && q.multi) return (q.correct || []).length * sc(q).perCorrect;
  return Number(q.points) || 1;
}
function minPts(q) { return q.type === "choice" && q.multi ? sc(q).min : 0; }
// Poeng for et svar (0 hvis ikke svart)
function judge(q, ans) {
  if (!ans) return 0;
  if (q.type === "choice") {
    if (q.multi) {
      const idxs = Array.isArray(ans.idxs) ? ans.idxs : [];
      if (!idxs.length) return 0;
      const c = idxs.filter(i => q.correct.includes(i)).length, w = idxs.length - c, k = sc(q);
      return Math.max(k.min, Math.min(maxPts(q), c * k.perCorrect + w * k.perWrong));
    }
    return Array.isArray(q.correct) && q.correct.includes(ans.idx) ? maxPts(q) : 0;
  }
  return textMatch(q, ans) ? maxPts(q) : 0;
}
// Verdier verten kan veksle mellom ved overstyring
function allowed(q) {
  if (q.type === "choice" && q.multi) { const out = []; for (let v = maxPts(q); v >= minPts(q); v--) out.push(v); return out; }
  return [maxPts(q), 0];
}

// ---------- Visning ----------
function scoreOf(t) { let s = 0; for (const v of Object.values(t.pts)) s += v; return s; }
function board(r) {
  const arr = [...r.teams.values()].map(t => ({ tid: t.tid, name: t.name, score: scoreOf(t), answered: r.answers.has(t.tid) }));
  arr.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "no"));
  let rank = 0, prev = null;
  arr.forEach((t, i) => { if (t.score !== prev) { rank = i + 1; prev = t.score; } t.rank = rank; });
  return arr;
}
function qPublic(i) {
  const q = Q[i]; if (!q) return null;
  const image = q.image ? (/^https?:\/\//.test(q.image) ? q.image : "/img/" + q.image) : null;
  return { i, n: Q.length, cat: q.cat || "", q: q.q, type: q.type, options: q.type === "choice" ? q.options : null, multi: !!q.multi, rule: q.rule || "", points: maxPts(q), image };
}
function answerInfo(i) {
  const q = Q[i];
  const correct = q.type === "choice" ? (q.correct || []) : null;
  return { answer: q.answerText || (q.accept || [])[0] || "", explain: q.explain || "", correct, allowed: allowed(q) };
}
function teamView(r, tid) {
  const t = r.teams.get(tid); if (!t) return null;
  const b = board(r), me = b.find(x => x.tid === tid) || {};
  const v = { state: r.state, n: Q.length, you: { tid, name: t.name, score: me.score || 0, rank: me.rank || 0 }, teams: b.length };
  if (r.state === "lobby") v.board = b.map(x => ({ name: x.name, score: x.score, rank: x.rank, tid: x.tid }));
  if (r.state === "question" || r.state === "reveal") {
    v.q = qPublic(r.qi);
    const a = r.answers.get(tid);
    v.answered = !!a; v.myAnswer = a ? (a.text || "") : null; v.myIdx = a && a.idx != null ? a.idx : null; v.myIdxs = a && a.idxs ? a.idxs : null;
  }
  if (r.state === "reveal") {
    Object.assign(v, { reveal: Object.assign(answerInfo(r.qi), { gained: t.pts[r.qi] || 0 }) });
    v.board = b.map(x => ({ name: x.name, score: x.score, rank: x.rank, tid: x.tid }));
  }
  if (r.state === "done") v.board = b.map(x => ({ name: x.name, score: x.score, rank: x.rank, tid: x.tid }));
  return v;
}
function hostView(r) {
  const b = board(r);
  const v = { state: r.state, n: Q.length, board: b, teams: b.length, answeredCount: b.filter(x => x.answered).length };
  if (r.state === "question" || r.state === "reveal") v.q = qPublic(r.qi);
  if (r.state === "reveal") {
    v.reveal = answerInfo(r.qi);
    v.results = [...r.teams.values()].map(t => {
      const a = r.answers.get(t.tid);
      return { tid: t.tid, name: t.name, text: a ? (a.text || "") : null, points: t.pts[r.qi] || 0 };
    }).sort((x, y) => (y.points - x.points) || x.name.localeCompare(y.name, "no"));
  }
  return v;
}
function send(res, obj) { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch (e) {} }
function pushHost(r) { const v = hostView(r); for (const res of r.hosts) send(res, v); }
function pushTeams(r) { for (const s of r.subs) { const v = teamView(r, s.tid); if (v) send(s.res, v); } }
function pushAll(r) { pushHost(r); pushTeams(r); }

// ---------- Hjelpere ----------
function readJson(req, res, limit, cb) {
  let body = "";
  req.on("data", c => { body += c; if (body.length > limit) { res.writeHead(413); res.end(); req.destroy(); } });
  req.on("end", () => {
    let d; try { d = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
    if (!d || typeof d !== "object") { res.writeHead(400); return res.end(); }
    cb(d);
  });
}
function hostAuth(r, key) {
  if (!validKey(key)) return false;
  if (!r.hostKey) r.hostKey = key;
  return r.hostKey === key;
}
const sseHeaders = { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" };
const ok204 = res => { res.writeHead(204); res.end(); };

function act(r, d) {
  switch (d.action) {
    case "start":
      if (r.state !== "lobby" || !r.teams.size || !Q.length) return false;
      for (const t of r.teams.values()) t.pts = {};
      r.qi = 0; r.answers.clear(); r.state = "question"; return true;
    case "reveal":
      if (r.state !== "question") return false;
      for (const t of r.teams.values()) t.pts[r.qi] = judge(Q[r.qi], r.answers.get(t.tid));
      r.state = "reveal"; return true;
    case "toggle": {
      if (r.state !== "reveal") return false;
      const t = r.teams.get(d.tid); if (!t) return false;
      const al = allowed(Q[r.qi]), cur = t.pts[r.qi] || 0, i = al.indexOf(cur);
      t.pts[r.qi] = al[(i + 1) % al.length]; return true;
    }
    case "next":
      if (r.state !== "reveal") return false;
      if (r.qi + 1 >= Q.length) { r.state = "done"; } else { r.qi++; r.answers.clear(); r.state = "question"; }
      return true;
    case "reset":
      r.state = "lobby"; r.qi = -1; r.answers.clear(); for (const t of r.teams.values()) t.pts = {}; return true;
    case "kick":
      if (!r.teams.has(d.tid)) return false; r.teams.delete(d.tid); r.answers.delete(d.tid); return true;
  }
  return false;
}

// ---------- Ruter ----------
function handle(req, res, url, parts) {
  // /api/quiz/:code/...
  if (parts[0] !== "api" || parts[1] !== "quiz") return false;
  const code = parts[2] || "";
  if (!validCode(code)) { res.writeHead(404); res.end(); return true; }
  const sub = parts[3], sub2 = parts[4];

  if (req.method === "POST" && sub === "join") {
    readJson(req, res, 600, d => {
      if (!validTid(d.tid)) { res.writeHead(400); return res.end(); }
      const name = clean(d.name, 24);
      if (!name) { res.writeHead(400); return res.end(); }
      const r = getRoom(code, true);
      if (!r || (!r.teams.has(d.tid) && r.teams.size >= MAX_TEAMS)) { res.writeHead(503); return res.end(); }
      for (const t of r.teams.values()) if (t.tid !== d.tid && t.name.toLowerCase() === name.toLowerCase()) { res.writeHead(409); return res.end(); }
      const t = r.teams.get(d.tid);
      if (t) t.name = name; else r.teams.set(d.tid, { tid: d.tid, name, pts: {} });
      r.touched = Date.now(); ok204(res); pushAll(r);
    });
    return true;
  }
  if (req.method === "GET" && sub === "stream") {
    const tid = url.searchParams.get("tid");
    const r = getRoom(code, false);
    if (!validTid(tid) || !r || !r.teams.has(tid)) { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, sseHeaders); res.write("retry: 2000\n\n");
    const entry = { res, tid }; r.subs.add(entry);
    send(res, teamView(r, tid));
    req.on("close", () => r.subs.delete(entry));
    return true;
  }
  if (req.method === "POST" && sub === "answer") {
    readJson(req, res, 1000, d => {
      const r = getRoom(code, false);
      if (!r || !validTid(d.tid) || !r.teams.has(d.tid)) { res.writeHead(404); return res.end(); }
      if (r.state !== "question") { res.writeHead(409); return res.end(); }
      const q = Q[r.qi];
      if (q.type === "choice" && q.multi) {
        const idxs = Array.isArray(d.idxs) ? [...new Set(d.idxs.map(Number))].sort((a, b) => a - b) : null;
        if (!idxs || idxs.some(i => !Number.isInteger(i) || i < 0 || i >= q.options.length)) { res.writeHead(400); return res.end(); }
        if (!idxs.length) r.answers.delete(d.tid);
        else r.answers.set(d.tid, { idxs, text: idxs.map(i => q.options[i]).join(", "), ts: Date.now() });
      } else if (q.type === "choice") {
        const idx = Number(d.idx);
        if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) { res.writeHead(400); return res.end(); }
        r.answers.set(d.tid, { idx, text: q.options[idx], ts: Date.now() });
      } else {
        const text = clean(d.text, 200);
        if (!text) { res.writeHead(400); return res.end(); }
        r.answers.set(d.tid, { text, ts: Date.now() });
      }
      r.touched = Date.now(); ok204(res); pushAll(r);
    });
    return true;
  }
  if (sub === "host") {
    if (req.method === "POST" && sub2 === "auth") {
      readJson(req, res, 500, d => { const r = getRoom(code, true); if (!r) { res.writeHead(503); return res.end(); } res.writeHead(hostAuth(r, d.key) ? 204 : 403); res.end(); });
      return true;
    }
    if (req.method === "POST" && sub2 === "act") {
      readJson(req, res, 600, d => {
        const r = getRoom(code, false);
        if (!r || !hostAuth(r, d.key)) { res.writeHead(403); return res.end(); }
        if (!act(r, d)) { res.writeHead(409); return res.end(); }
        r.touched = Date.now(); ok204(res); pushAll(r);
      });
      return true;
    }
    if (req.method === "GET" && sub2 === "stream") {
      const r = getRoom(code, true);
      if (!r || !hostAuth(r, url.searchParams.get("key"))) { res.writeHead(403); res.end(); return true; }
      res.writeHead(200, sseHeaders); res.write("retry: 2000\n\n");
      r.hosts.add(res); send(res, hostView(r));
      req.on("close", () => r.hosts.delete(res));
      return true;
    }
  }
  res.writeHead(404); res.end();
  return true;
}

setInterval(() => {
  for (const [code, r] of rooms) {
    for (const res of r.hosts) { try { res.write(": ping\n\n"); } catch (e) {} }
    for (const s of r.subs) { try { s.res.write(": ping\n\n"); } catch (e) {} }
    if (!r.hosts.size && !r.subs.size && Date.now() - r.touched > ROOM_TTL) rooms.delete(code);
  }
}, 15000);

module.exports = { handle, count: () => Q.length };
