# Dots and Boxes — Online

Real-time two-player Dots and Boxes. No dependencies, no database, no build step.

- **Server:** `server.js` (Node 18+). The server is authoritative: it validates turns and moves and computes scores.
- **Realtime:** Server-Sent Events for pushes, JSON POSTs for actions. Works behind normal HTTPS proxies.
- **Client:** `public/index.html` (one file).
- **Identity:** each browser gets a random token in localStorage that holds its seat, so refreshing or reconnecting keeps your place.
- **Names:** each player types a name (max 12 chars); its first letter appears in every box they win.

## Run locally
    node server.js        # http://localhost:3000

Open the page in two browsers: create a game in one, join with the code (or link) in the other.

## Deploy
Needs a host that runs a long-lived Node process (state is in memory).

- **Render / Railway / Fly.io / any VPS:** start command `node server.js`; the `PORT` env var is respected.
- **Docker:** `docker build -t dab . && docker run -p 3000:3000 dab`
- Put it behind HTTPS (these platforms do this for you).
- Health check: `GET /healthz`

## Limits to know about
- Run a **single instance**: rooms live in that process's memory. A restart ends active games.
- Not suited to serverless (Vercel/Netlify functions) because SSE and in-memory rooms need a persistent process.
- To scale beyond one instance, move room state to Redis and fan out with pub/sub.
