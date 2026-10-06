// Dots and Boxes — authoritative real-time server. Zero dependencies (Node >= 18).
// Push: Server-Sent Events. Actions: JSON POST. State lives in memory.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const SIZES = [5, 10, 15, 20, 25];        // allowed dots per side; boxes per side = dots - 1
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;   // drop rooms idle for 6h
const MAX_ROOMS = 5000;
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function newCode() {
  for (;;) {
    let c = ""; for (let i = 0; i < 4; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n) => Array.from(String(n || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim()).slice(0, 12).join("").trim();
function newRoom(token, name, n) {
  return { n, seats: [token, null], names: [name || "Player 1", null], e: {}, own: {}, sc: [0, 0], turn: 0, round: 0, mv: 0, clients: new Set(), last: Date.now() };
}
const validEdge = (k, N) => {
  const m = /^([hv])(\d+),(\d+)$/.exec(k); if (!m) return false;
  const r = +m[2], c = +m[3];
  return m[1] === "h" ? r <= N && c < N : r < N && c <= N;
};
const sides = (r, c) => ["h" + r + "," + c, "h" + (r + 1) + "," + c, "v" + r + "," + c, "v" + r + "," + (c + 1)];

function seatOf(room, token) { return token ? room.seats.indexOf(token) : -1; }
function view(code, room, token) {
  const online = [0, 1].map((i) => [...room.clients].some((cl) => room.seats[i] && cl.token === room.seats[i]));
  return { code, n: room.n, e: room.e, own: room.own, sc: room.sc, turn: room.turn, round: room.round, mv: room.mv,
    joined: [!!room.seats[0], !!room.seats[1]], names: [room.names[0] || "Player 1", room.names[1] || "Player 2"], online, you: seatOf(room, token), over: room.sc[0] + room.sc[1] === room.n * room.n };
}
function broadcast(code, room) {
  for (const cl of room.clients) cl.res.write("data: " + JSON.stringify(view(code, room, cl.token)) + "\n\n");
}

function applyMove(room, seat, k) {
  const N = room.n;
  room.e[k] = seat; room.mv++;
  const t = k[0], [r, c] = k.slice(1).split(",").map(Number);
  const cand = t === "h" ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]];
  let got = 0;
  for (const [a, b] of cand) {
    if (a < 0 || b < 0 || a >= N || b >= N || room.own[a + "," + b] != null) continue;
    if (sides(a, b).every((s) => room.e[s] != null)) { room.own[a + "," + b] = seat; got++; }
  }
  room.sc[seat] += got;
  if (!got) room.turn = 1 - seat;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ""; req.on("data", (d) => { body += d; if (body.length > 4096) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
const validToken = (t) => typeof t === "string" && t.length >= 16 && t.length <= 64;
const getRoom = (c) => (typeof c === "string" ? rooms.get(c.toUpperCase()) : undefined);

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/events") {
    const code = (url.searchParams.get("code") || "").toUpperCase(), token = url.searchParams.get("token");
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: "no such room" });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const cl = { res, token }; room.clients.add(cl); room.last = Date.now();
    res.write("retry: 2000\n\n");
    broadcast(code, room); // everyone sees updated presence
    req.on("close", () => { room.clients.delete(cl); room.last = Date.now(); broadcast(code, room); });
    return;
  }
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  let b; try { b = await readJson(req); } catch { return send(res, 400, { error: "bad json" }); }
  if (!validToken(b.token)) return send(res, 400, { error: "bad token" });

  if (url.pathname === "/api/create") {
    if (rooms.size >= MAX_ROOMS) return send(res, 503, { error: "server full" });
    const dots = SIZES.includes(b.size) ? b.size : 5;
    const code = newCode(); rooms.set(code, newRoom(b.token, cleanName(b.name), dots - 1));
    return send(res, 200, { code });
  }
  const room = getRoom(b.code); const code = String(b.code || "").toUpperCase();
  if (!room) return send(res, 404, { error: "no such room" });
  room.last = Date.now();

  if (url.pathname === "/api/join") {
    const nm = cleanName(b.name);
    if (seatOf(room, b.token) < 0 && !room.seats[1]) { room.seats[1] = b.token; room.names[1] = nm || "Player 2"; broadcast(code, room); }
    else if (nm && seatOf(room, b.token) >= 0) { room.names[seatOf(room, b.token)] = nm; broadcast(code, room); }
    return send(res, 200, { seat: seatOf(room, b.token) });
  }
  const seat = seatOf(room, b.token);
  if (seat < 0) return send(res, 403, { error: "spectators can't act" });

  if (url.pathname === "/api/move") {
    if (!room.seats[1]) return send(res, 409, { error: "waiting for opponent" });
    if (room.sc[0] + room.sc[1] === room.n * room.n) return send(res, 409, { error: "game over" });
    if (room.turn !== seat) return send(res, 409, { error: "not your turn" });
    if (!validEdge(b.edge, room.n) || room.e[b.edge] != null) return send(res, 400, { error: "illegal move" });
    applyMove(room, seat, b.edge); broadcast(code, room);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/rematch") {
    if (room.sc[0] + room.sc[1] !== room.n * room.n) return send(res, 409, { error: "game not over" });
    room.e = {}; room.own = {}; room.sc = [0, 0]; room.round++; room.turn = room.round % 2; room.mv++;
    broadcast(code, room);
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "unknown endpoint" });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname); if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") return send(res, 200, { ok: true, rooms: rooms.size });
  if (url.pathname.startsWith("/api/")) return api(req, res, url).catch(() => send(res, 500, { error: "server error" }));
  serveStatic(req, res, url);
});

setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && Date.now() - room.last > ROOM_TTL_MS) rooms.delete(code);
    else for (const cl of room.clients) cl.res.write(": ping\n\n"); // keep proxies from closing idle streams
  }
}, 25000).unref();

if (require.main === module) server.listen(PORT, () => console.log("Dots and Boxes on :" + PORT));
module.exports = server;
