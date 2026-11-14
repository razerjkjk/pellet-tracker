# Pellet Tracker — host-ready public edition

Track wood-pellet heating supply: log purchases, log bags burned per
stove, see bags on hand, burn rate, days left, and what you still need
to buy — plus per-stove maintenance reminders with manual links and
factory troubleshooting guides. Full 1970s disco look (mirror ball,
light beams, flashing dance floor, 70s slang). The theme song is the
real Bee Gees "Stayin' Alive" official video, with YouTube, Spotify,
and Apple Music links.

This is a standalone, host-ready copy of the app. It runs on any host
that can run [Bun](https://bun.sh) with a SQLite file — no Muse/Hatch
runtime, no proprietary SDK.

**One shared tracker, no accounts.** There is no sign-in here: everyone
who opens the link sees and edits the same stoves, purchases, and burn
logs. That matches the original single-user app. If strangers will use
it together and each need their own supply, accounts would have to be
added first — see "What still needs doing".

## What starts in the database

The app starts with the two stove models and their factory content
already loaded, and no supply of its own:

- **PelPro TSC90** (cast iron, 90-lb hopper) and **Master Force H140XL**
  (140-lb hopper, heats about 2,500 sq ft), each with its manual link,
  factory contact, maintenance schedule, and factory troubleshooting
  guide (error codes + symptom fixes from the factory guides).
- **No purchases, no burn logs, no adjustments** — bags on hand starts
  at 0 until the owner logs a purchase. Johnny's own purchases, burn
  logs, and bag count from the original Muse app are **not** in here and
  were never copied.

A stove can be renamed, edited, or deleted from the app, and new stoves
can be added with their own maintenance tasks.

## What changed from the Muse version

The original app ran on the Muse hosted runtime and imported the
proprietary `@hatch/space-sdk`. Every SDK use has been replaced with
plain equivalents:

| Before (Muse SDK) | Now (standalone) |
| --- | --- |
| `defineAction` + `ctx` | Plain handler functions in `server/src/actions.ts`, dispatched by `server/src/server.ts` |
| `ctx.db` | Direct Drizzle SQLite connection (`server/src/db.ts`, `bun:sqlite`) |
| `ctx.invalidateQueries()` | Normal TanStack Query refetching (the client already did this) |
| `createActionClient` | Plain `fetch` POSTs of `{action, args}` to `./actions` (`client/src/api.ts`) |
| `spaceQueryClient` | The app's own `QueryClient` (`client/src/main.tsx`) |
| `SafeAreaTopScrim` | Removed (it was Muse-shell chrome; a plain host has no notch scrim) |
| `file:/opt/hatch/...` SDK dependency | Removed — `bun install` works anywhere |

Everything else is unchanged: the same supply math (burn rate, days
left, run-out date, cost per bag, bags needed), the same stove /
purchase / burn / maintenance forms, the same disco look with the same
pellet-stove photograph, and the same "Stayin' Alive" links.

## Run it locally

```sh
bun install     # installs dependencies (creates bun.lock)
bun run build   # builds the client into dist/client
bun run start   # serves the app on http://localhost:3000
```

On first start the server creates `./data/app.db` and applies the
migrations in `drizzle/` automatically. Open http://localhost:3000 and
log a test purchase.

Other scripts:

- `bun run typecheck` — type-checks client and server.
- `bun run build:server` — bundles the server to `dist/server.js`
  (`bun dist/server.js` runs it without the TypeScript source).

## Configuration (environment variables)

| Variable | Default | What it is |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. Railway and Render set this themselves. |
| `DATABASE_PATH` | `./data/app.db` | SQLite file. **Put it on a persistent volume** (see below) or stoves and logs disappear when the container is replaced. |
| `CLIENT_DIR` | `dist/client` | Built client directory. |
| `MIGRATIONS_DIR` | `drizzle/` | Drizzle migration files. |

Endpoints: `GET /` (the app), `GET /health` (returns `{"ok":true}` —
use it as the host health check), `POST /actions` (`{action, args}`).

## Deploy

### Option A — Railway (easiest, no Docker)

1. Put this folder in a GitHub repo and push it.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
   Railway auto-detects Bun from `bun.lock` and builds with Railpack.
   Do not put a file named `Dockerfile` in the repo root — Railway
   picks it up and its validator rejects this image; the Docker file
   lives at `Dockerfile.render` for Render and local Docker use.
3. Set the service commands explicitly if they are not picked up:
   **Build Command** `bun run build`, **Start Command** `bun run start`.
4. Add a **Volume**, mount path `/app/data`. (Volumes need a paid plan.)
5. Variables: `DATABASE_PATH=/app/data/app.db`. `PORT` is provided by
   Railway — do not set it yourself.
6. Deploy. Open the generated domain; `/health` should return `{"ok":true}`.

### Option B — Render (Docker)

1. Push this folder to a GitHub repo.
2. Render → **New → Web Service → Build and deploy from a Git repository** →
   pick the repo → **Runtime: Docker**, Dockerfile path `Dockerfile.render`.
   The included `Dockerfile.render` does the rest (`bun install`,
   `bun run build`, `bun run start`).
3. Add a **Persistent Disk**, mount path `/app/data`, 1 GB. (Disks need a
   paid instance type; on the free tier the database lives on ephemeral
   disk and is lost on redeploy.)
4. Environment variables: `DATABASE_PATH=/app/data/app.db`.
   `PORT` is provided by Render.
5. **Health Check Path:** `/health`.
6. Deploy and open the service URL.

### Option C — any Docker host / VPS

```sh
docker build -f Dockerfile.render -t pellet-tracker .
docker run -p 3000:3000 -v pellet-data:/app/data pellet-tracker
```

Or on a plain VPS with Bun installed: `bun install && bun run build &&
bun run start`, with `DATABASE_PATH` pointed at a directory that
survives restarts. A process manager (systemd, pm2) and a reverse
proxy (Caddy/Nginx) with HTTPS are the host's job — this app serves
plain HTTP on `PORT`.

## What still needs doing before strangers use it together

This pass made the app **host-ready** as far as the code goes. Three
things are still open:

1. **A hosting account + a persistent volume** (steps above). Without
   the volume, the SQLite file is wiped on every redeploy.
2. **Backups** — back up the SQLite file on a schedule (the volume is
   the only copy).
3. **Accounts, if each visitor needs their own supply.** Right now
   everyone with the link shares one tracker. Adding email + password
   accounts (like the Help Pay Bills public edition) would be a
   separate build before announcing widely.

## Notes and caveats

- **No user data is included.** The original Muse app's purchases,
  burn logs, adjustments, and bag count are not in here and were never
  copied. Only the two stove models with their factory maintenance
  schedules and troubleshooting guides ship with the code, because
  those come from the factory manuals, not from Johnny's records.
- Monoton and Oswald load from Google Fonts at runtime
  (`client/src/theme.css`); they fall back to system fonts offline.
  The YouTube / Spotify / Apple Music theme-song links are the only
  other runtime network dependencies; everything else is self-contained.
- `recharts` is a dependency of the original app and is still listed
  in `package.json` — the burn chart renders from it.
- This code was smoke-tested end to end on Bun 1.4.4 with a fresh
  empty database (see the check list in the repo history): supply math,
  stove / purchase / burn / maintenance CRUD, validation rejects, and
  restart persistence. It was **not** checked in a real browser;
  confirm the look on a phone after the first deploy.

## Project layout

```
client/                 React 19 + TanStack Query front end
  src/App.tsx           the whole UI (unchanged except the removed SDK scrim)
  src/api.ts            plain fetch action client (was the SDK client)
  src/main.tsx          app entry, owns its own QueryClient
  src/theme.css         disco theme (Tailwind v4)
  src/assets/           pellet-stove photograph
server/
  src/actions.ts        all action handlers (plain functions, no SDK)
  src/db.ts             SQLite connection + migration runner
  src/server.ts         HTTP server: static client + /actions + /health
  src/schema.ts         Drizzle schema
drizzle/                SQL migrations (0001–0008) + journal
Dockerfile.render       Docker image for Render / local Docker
```
