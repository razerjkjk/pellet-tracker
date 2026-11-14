// Pellet Tracker — standalone HTTP server (Bun).
//
// Serves the built client from `dist/client` and dispatches plain HTTP
// POSTs to `./actions` (`{action, args}`) to the handlers in
// `./actions.ts`. There are no accounts, no sessions, and no uploads in
// this app: every visitor shares the one tracker database, exactly like
// the original single-user Muse app.
//
// Configuration (environment variables):
//   PORT           — HTTP port to listen on (default 3000; hosts like
//                    Railway/Render set this themselves).
//   DATABASE_PATH  — SQLite file, created if missing (default ./data/app.db).
//                    Put this on a persistent volume on your host, or the
//                    stoves, purchases, and burn logs disappear when the
//                    container is replaced.
//   CLIENT_DIR     — built client directory (default dist/client).
//   MIGRATIONS_DIR — drizzle migrations directory (default drizzle/).
//
// Run with:  bun run start        (after `bun run build`)
// Or build a bundle first: bun run build:server, then `bun dist/server.js`.

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Actions, type ActionContext } from "./actions";
import { createDb, runMigrations } from "./db";

const PORT = Number(process.env.PORT ?? 3000);

function resolveDir(rel: string, fallback: string): string {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(import.meta.dir, "..", "..", rel), // running from server/src/
    path.join(import.meta.dir, "..", rel), // running from dist/ (bundled)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return fallback;
}

const DATABASE_PATH = path.resolve(
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db"),
);
const CLIENT_DIR = process.env.CLIENT_DIR
  ? path.resolve(process.env.CLIENT_DIR)
  : resolveDir("dist/client", path.join(process.cwd(), "dist", "client"));
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : resolveDir("drizzle", path.join(process.cwd(), "drizzle"));

mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = createDb(DATABASE_PATH);
runMigrations(db, MIGRATIONS_DIR);

type AnyAction = {
  request: { safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  response: { safeParse: (input: unknown) => { success: boolean; data?: unknown } };
  handler: (ctx: ActionContext, args: never) => Promise<unknown>;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleActions(req: Request, ctx: ActionContext): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Expected a JSON body." }, 400);
  }
  const action = (body as { action?: unknown } | null)?.action;
  const args = (body as { args?: unknown } | null)?.args;
  if (typeof action !== "string" || !(action in Actions)) {
    return json({ error: `Unknown action: ${String(action)}` }, 404);
  }
  const def = Actions[action as keyof typeof Actions] as unknown as AnyAction;
  const parsed = def.request.safeParse(args ?? {});
  if (!parsed.success) {
    return json({ ok: false, error: "That request was not valid." }, 400);
  }
  try {
    const result = await def.handler(ctx, parsed.data as never);
    const checked = def.response.safeParse(result);
    if (!checked.success) {
      console.error(`[actions] bad response for ${action}`);
      return json({ error: "The server returned an unexpected result." }, 500);
    }
    return json(checked.data, 200);
  } catch (err) {
    console.error(`[actions] ${action} failed:`, err);
    return json(
      { error: err instanceof Error ? err.message : "The server could not do that." },
      500,
    );
  }
}

/** Serves a file from `base`, refusing anything that escapes it. */
function serveFile(base: string, rel: string): Response | null {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    return null;
  }
  if (!existsSync(resolved)) return null;
  const file = Bun.file(resolved);
  return new Response(file);
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/actions") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for actions." }, 405);
      }
      const ctx: ActionContext = { db };
      return handleActions(req, ctx);
    }

    if (req.method === "GET") {
      if (!existsSync(CLIENT_DIR)) {
        return new Response(
          "Pellet Tracker: the client has not been built yet. Run `bun run build` first.",
          { status: 503, headers: { "content-type": "text/plain" } },
        );
      }
      const rel =
        url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const file = serveFile(CLIENT_DIR, rel);
      if (file) return file;
      // Single-page fallback: unknown paths show the app shell.
      const index = serveFile(CLIENT_DIR, "index.html");
      if (index) return index;
      return json({ error: "Not found." }, 404);
    }

    return json({ error: "Not found." }, 404);
  },
});

console.log(`Pellet Tracker listening on http://localhost:${server.port}`);
console.log(`  database: ${DATABASE_PATH}`);
console.log(`  client:   ${CLIENT_DIR}`);
