import { z } from "zod";
import type { Db } from "./db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import {
  createSession,
  clearSessionCookie,
  deleteSession,
  hashPassword,
  isValidEmail,
  sessionCookie,
  verifyPassword,
  type SessionStore,
  type SessionUser,
} from "./auth";
import { allow, reset as resetLimit } from "./ratelimit";

/** Everything an action handler needs. Provided by server.ts per request. */
export interface ActionContext {
  /** Drizzle SQLite connection (already migrated on startup). */
  db: Db;
  /** The signed-in user, resolved from the session cookie, or null. */
  user: SessionUser | null;
  /** Raw session token from the cookie (needed to sign out), or null. */
  sessionToken: string | null;
  /** Client IP, for rate limiting. */
  ip: string;
  /** Set-Cookie values to send back with the response. */
  cookies: string[];
}

/**
 * Local replacement for the SDK's `defineAction`. It only carries the
 * request/response schemas and the handler — the HTTP dispatch lives in
 * `server.ts`, and the client refetches with TanStack Query instead of the
 * SDK's `ctx.invalidateQueries()`.
 */
function defineAction<R extends z.ZodType, S extends z.ZodType>(def: {
  description: string;
  request: R;
  response: S;
  handler: (ctx: ActionContext, args: z.infer<R>) => Promise<z.infer<S>>;
}) {
  return def;
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optText = z.string().trim().max(200).nullable().optional();
const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}
function addDays(date: string, days: number): string {
  return new Date(dayMs(date) + days * 86400000).toISOString().slice(0, 10);
}
function diffDays(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / 86400000);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Every data action needs a signed-in account. */
function requireUser(ctx: ActionContext): SessionUser {
  if (!ctx.user) throw new Error("Please sign in to see your tracker, cool cat.");
  return ctx.user;
}

/** True when this stove belongs to this account. */
async function ownStove(db: Db, userId: number, stoveId: number): Promise<boolean> {
  const rows = await db
    .select({ id: schema.stoves.id })
    .from(schema.stoves)
    .where(and(eq(schema.stoves.id, stoveId), eq(schema.stoves.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** True when this maintenance task belongs to this account. */
async function ownTask(db: Db, userId: number, taskId: number): Promise<boolean> {
  const rows = await db
    .select({ id: schema.maintenanceTasks.id })
    .from(schema.maintenanceTasks)
    .where(and(eq(schema.maintenanceTasks.id, taskId), eq(schema.maintenanceTasks.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Gives a brand-new account its starting catalog: a copy of the seeded
 * factory rows (user_id NULL templates from the migrations) — the 2 stove
 * models with their maintenance tasks and factory troubleshooting items —
 * plus a settings row with the defaults. Purchases, burn logs, and
 * adjustments start empty, so bags on hand start at 0. Runs inside the
 * signup transaction so an account never lands half-seeded.
 */
async function seedCatalogForUser(
  store: Pick<Db, "insert" | "select">,
  userId: number,
): Promise<void> {
  await store.insert(schema.settings).values({
    userId,
    burnWindowDays: 30,
    lowStockDays: 7,
    safetyBags: 0,
  });
  const templates = await store
    .select()
    .from(schema.stoves)
    .where(isNull(schema.stoves.userId));
  const stoveMap = new Map<number, number>();
  for (const t of templates) {
    const rows = await store
      .insert(schema.stoves)
      .values({
        userId,
        name: t.name,
        location: t.location,
        manualUrl: t.manualUrl,
        details: t.details,
        factoryName: t.factoryName,
        factoryPhone: t.factoryPhone,
        factoryEmail: t.factoryEmail,
        troubleshootingUrl: t.troubleshootingUrl,
      })
      .returning({ id: schema.stoves.id });
    const row = rows[0];
    if (row) stoveMap.set(t.id, row.id);
  }
  const tasks = await store
    .select()
    .from(schema.maintenanceTasks)
    .where(isNull(schema.maintenanceTasks.userId));
  for (const t of tasks) {
    const newStoveId = stoveMap.get(t.stoveId);
    if (newStoveId == null) continue;
    await store.insert(schema.maintenanceTasks).values({
      userId,
      stoveId: newStoveId,
      title: t.title,
      intervalDays: t.intervalDays,
      notes: t.notes,
    });
  }
  const items = await store
    .select()
    .from(schema.troubleshootingItems)
    .where(isNull(schema.troubleshootingItems.userId));
  for (const it of items) {
    const newStoveId = stoveMap.get(it.stoveId);
    if (newStoveId == null) continue;
    await store.insert(schema.troubleshootingItems).values({
      userId,
      stoveId: newStoveId,
      category: it.category,
      codeLabel: it.codeLabel,
      title: it.title,
      cause: it.cause,
      fix: it.fix,
      sortOrder: it.sortOrder,
    });
  }
}

const authResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  id: z.number().optional(),
  user: z
    .object({ id: z.number(), email: z.string(), name: z.string() })
    .optional(),
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const SIGNUPS_PER_IP_PER_HOUR = 10;
const SIGNIN_PER_IP_PER_15_MIN = 30;
const SIGNIN_FAILURES_PER_EMAIL_PER_15_MIN = 10;

const stoveOut = z.object({ id: z.number(), name: z.string(), location: z.string().nullable(), manualUrl: z.string().nullable(), details: z.string().nullable(), factoryName: z.string().nullable(), factoryPhone: z.string().nullable(), factoryEmail: z.string().nullable(), troubleshootingUrl: z.string().nullable() });
const troubleshootingOut = z.object({
  id: z.number(), stoveId: z.number(), category: z.enum(["error_code", "symptom"]),
  codeLabel: z.string().nullable(), title: z.string(), cause: z.string().nullable(), fix: z.string(), sortOrder: z.number(),
});
const purchaseOut = z.object({
  id: z.number(), date: z.string(), brand: z.string().nullable(), store: z.string().nullable(),
  bags: z.number(), totalCostCents: z.number().nullable(), lbsPerBag: z.number().nullable(), notes: z.string().nullable(),
});
const burnOut = z.object({ id: z.number(), stoveId: z.number().nullable(), date: z.string(), bags: z.number(), note: z.string().nullable(), stoveName: z.string().nullable() });
const adjustmentOut = z.object({ id: z.number(), date: z.string(), bagsDelta: z.number(), reason: z.string().nullable() });
const settingsOut = z.object({
  manualBurnRate: z.number().nullable(), burnWindowDays: z.number(), lowStockDays: z.number(),
  targetDate: z.string().nullable(), safetyBags: z.number(),
});
const maintenanceTaskOut = z.object({
  id: z.number(), stoveId: z.number(), title: z.string(), intervalDays: z.number().nullable(),
  notes: z.string().nullable(), lastDone: z.string().nullable(), nextDue: z.string().nullable(),
  daysUntilDue: z.number().nullable(),
  status: z.enum(["never", "no_due", "ok", "due_soon", "due", "overdue"]),
});
const maintenanceLogOut = z.object({ id: z.number(), taskId: z.number(), date: z.string(), note: z.string().nullable(), taskTitle: z.string() });

const summaryOut = z.object({
  onHand: z.number(), totalPurchased: z.number(), totalBurned: z.number(), totalAdjustments: z.number(),
  burnRate: z.number().nullable(), burnRateSource: z.enum(["manual", "logged", "none"]),
  daysLeft: z.number().nullable(), runOutDate: z.string().nullable(),
  costPerBagCents: z.number().nullable(), lastCostPerBagCents: z.number().nullable(),
  neededBags: z.number().nullable(), neededCostCents: z.number().nullable(),
  daily: z.array(z.object({ date: z.string(), label: z.string(), bags: z.number() })),
  perStove: z.array(z.object({ stoveId: z.number().nullable(), name: z.string(), bags: z.number() })),
});

const dataResponse = z.object({
  stoves: z.array(stoveOut), purchases: z.array(purchaseOut), burnLogs: z.array(burnOut),
  adjustments: z.array(adjustmentOut), settings: settingsOut,
  maintenanceTasks: z.array(maintenanceTaskOut), maintenanceLogs: z.array(maintenanceLogOut),
  troubleshootingItems: z.array(troubleshootingOut),
  summary: summaryOut,
});

export const Actions = {
  // ---- Accounts -------------------------------------------------------

  getMe: defineAction({
    description: "Returns the signed-in account, or null when signed out.",
    request: z.object({}),
    response: z.object({
      user: z
        .object({ id: z.number(), email: z.string(), name: z.string() })
        .nullable(),
    }),
    async handler(ctx) {
      return {
        user: ctx.user
          ? { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name }
          : null,
      };
    },
  }),

  signUp: defineAction({
    description: "Creates an account with an email and password and signs in. The new account starts with the seeded factory catalog (2 stove models, their maintenance tasks, and the factory troubleshooting items) and zero purchases, burn logs, or bags.",
    request: z.object({
      email: z.string().trim().max(120),
      name: z.string().trim().min(1).max(40),
      password: z.string().min(8).max(128),
    }),
    response: authResultSchema,
    async handler(ctx, args): Promise<z.infer<typeof authResultSchema>> {
      if (!allow(`signup:ip:${ctx.ip}`, SIGNUPS_PER_IP_PER_HOUR, HOUR)) {
        return { ok: false, error: "Too many accounts created from here. Try again later." };
      }
      const email = args.email.toLowerCase();
      if (!isValidEmail(email)) {
        return { ok: false, error: "Enter a valid email address." };
      }
      const existing = await ctx.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing.length > 0) {
        return { ok: false, error: "An account with that email already exists. Sign in instead." };
      }
      const passwordHash = await hashPassword(args.password);
      const name = args.name.trim();
      // Account + seeded catalog + session in one transaction, so a new
      // account never lands without its starting stoves and tasks.
      const created = await ctx.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.users)
          .values({ email, name, passwordHash })
          .returning({ id: schema.users.id });
        const row = inserted[0];
        if (!row) throw new Error("The account could not be created. Try again.");
        await seedCatalogForUser(tx as unknown as Pick<Db, "insert" | "select">, row.id);
        const token = await createSession(tx as unknown as SessionStore, row.id);
        return { id: row.id, token };
      });
      ctx.cookies.push(sessionCookie(created.token));
      return {
        ok: true,
        id: created.id,
        user: { id: created.id, email, name },
      };
    },
  }),

  signIn: defineAction({
    description: "Signs in with an email and password.",
    request: z.object({
      email: z.string().trim().max(120),
      password: z.string().min(1).max(128),
    }),
    response: authResultSchema,
    async handler(ctx, args): Promise<z.infer<typeof authResultSchema>> {
      const email = args.email.toLowerCase();
      if (!allow(`signin:ip:${ctx.ip}`, SIGNIN_PER_IP_PER_15_MIN, 15 * MINUTE)) {
        return { ok: false, error: "Too many sign-in attempts from here. Try again in a little while." };
      }
      if (!allow(`signin:email:${email}`, SIGNIN_FAILURES_PER_EMAIL_PER_15_MIN, 15 * MINUTE)) {
        return { ok: false, error: "Too many sign-in attempts for this email. Try again in a little while." };
      }
      const wrong = { ok: false, error: "That email or password is not correct." } as const;
      const rows = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user) return wrong;
      if (!(await verifyPassword(args.password, user.passwordHash))) return wrong;
      resetLimit(`signin:email:${email}`);
      const token = await createSession(ctx.db, user.id);
      ctx.cookies.push(sessionCookie(token));
      return {
        ok: true,
        id: user.id,
        user: { id: user.id, email: user.email, name: user.name },
      };
    },
  }),

  signOut: defineAction({
    description: "Signs out, ending the current session.",
    request: z.object({}),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx) {
      if (ctx.sessionToken) {
        await deleteSession(ctx.db, ctx.sessionToken);
      }
      ctx.cookies.push(clearSessionCookie());
      return { ok: true };
    },
  }),

  getData: defineAction({
    description: "Loads the signed-in account's stoves, purchases, burn logs, adjustments, maintenance, settings, and the computed supply forecast.",
    request: z.object({ today: dateString }),
    response: dataResponse,
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const today = args.today;
      const db = ctx.db;
      const uid = user.id;
      const [stoveRows, purchaseRows, burnRows, adjRows, settingsRows, taskRows, logRows, troubleRows] = await Promise.all([
        db.select().from(schema.stoves).where(eq(schema.stoves.userId, uid)).orderBy(asc(schema.stoves.name)),
        db.select().from(schema.purchases).where(eq(schema.purchases.userId, uid)).orderBy(desc(schema.purchases.date), desc(schema.purchases.id)),
        db.select().from(schema.burnLogs).where(eq(schema.burnLogs.userId, uid)).orderBy(desc(schema.burnLogs.date), desc(schema.burnLogs.id)),
        db.select().from(schema.adjustments).where(eq(schema.adjustments.userId, uid)).orderBy(desc(schema.adjustments.date), desc(schema.adjustments.id)),
        db.select().from(schema.settings).where(eq(schema.settings.userId, uid)).limit(1),
        db.select().from(schema.maintenanceTasks).where(eq(schema.maintenanceTasks.userId, uid)).orderBy(asc(schema.maintenanceTasks.title)),
        db.select().from(schema.maintenanceLogs).where(eq(schema.maintenanceLogs.userId, uid)).orderBy(desc(schema.maintenanceLogs.date), desc(schema.maintenanceLogs.id)),
        db.select().from(schema.troubleshootingItems).where(eq(schema.troubleshootingItems.userId, uid)).orderBy(asc(schema.troubleshootingItems.sortOrder), asc(schema.troubleshootingItems.id)),
      ]);
      const settingsRow = settingsRows[0];
      const settings = {
        manualBurnRate: settingsRow?.manualBurnRate ?? null,
        burnWindowDays: settingsRow?.burnWindowDays ?? 30,
        lowStockDays: settingsRow?.lowStockDays ?? 7,
        targetDate: settingsRow?.targetDate ?? null,
        safetyBags: settingsRow?.safetyBags ?? 0,
      };
      const stoveById = new Map(stoveRows.map((s) => [s.id, s]));

      const totalPurchased = purchaseRows.reduce((s, r) => s + r.bags, 0);
      const totalBurned = burnRows.reduce((s, r) => s + r.bags, 0);
      const totalAdjustments = adjRows.reduce((s, r) => s + r.bagsDelta, 0);
      const onHand = round1(totalPurchased - totalBurned + totalAdjustments);

      // Burn rate: manual override wins; otherwise use logged burns over the
      // span actually covered by logs inside the chosen window.
      let burnRate: number | null = null;
      let burnRateSource: "manual" | "logged" | "none" = "none";
      if (settings.manualBurnRate != null && settings.manualBurnRate > 0) {
        burnRate = settings.manualBurnRate;
        burnRateSource = "manual";
      } else {
        const windowDays = settings.burnWindowDays;
        const windowStart = windowDays > 0 ? addDays(today, -(windowDays - 1)) : null;
        const inWindow = burnRows.filter((r) => r.date <= today && (windowStart == null || r.date >= windowStart));
        if (inWindow.length > 0) {
          const earliest = inWindow.map((r) => r.date).sort()[0] ?? today;
          const span = Math.max(1, diffDays(earliest, today) + 1);
          const total = inWindow.reduce((s, r) => s + r.bags, 0);
          burnRate = round1(total / span);
          burnRateSource = "logged";
        }
      }

      const daysLeft = burnRate != null && burnRate > 0 && onHand > 0 ? round1(onHand / burnRate) : null;
      const runOutDate = daysLeft != null ? addDays(today, Math.floor(daysLeft)) : null;

      let costPerBagCents: number | null = null;
      const costed = purchaseRows.filter((r) => r.totalCostCents != null && r.bags > 0);
      const costedBags = costed.reduce((s, r) => s + r.bags, 0);
      const costedTotal = costed.reduce((s, r) => s + (r.totalCostCents ?? 0), 0);
      if (costedBags > 0) costPerBagCents = Math.round(costedTotal / costedBags);
      const lastCosted = costed[0];
      const lastCostPerBagCents = lastCosted && lastCosted.totalCostCents != null && lastCosted.bags > 0
        ? Math.round(lastCosted.totalCostCents / lastCosted.bags) : null;

      let neededBags: number | null = null;
      let neededCostCents: number | null = null;
      if (burnRate != null && burnRate > 0) {
        const horizon = settings.targetDate ? Math.max(0, diffDays(today, settings.targetDate)) : settings.lowStockDays;
        const raw = burnRate * horizon + settings.safetyBags - onHand;
        neededBags = Math.max(0, Math.ceil(raw - 1e-9));
        if (costPerBagCents != null) neededCostCents = neededBags * costPerBagCents;
      }

      const daily: { date: string; label: string; bags: number }[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = addDays(today, -i);
        const total = burnRows.filter((r) => r.date === d).reduce((s, r) => s + r.bags, 0);
        daily.push({ date: d, label: new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }), bags: round1(total) });
      }

      const perStoveMap = new Map<string, { stoveId: number | null; name: string; bags: number }>();
      for (const r of burnRows) {
        const key = r.stoveId == null ? "none" : String(r.stoveId);
        const name = r.stoveId == null ? "No stove picked — free bird" : (stoveById.get(r.stoveId)?.name ?? "Stove gone, baby");
        const cur = perStoveMap.get(key) ?? { stoveId: r.stoveId, name, bags: 0 };
        cur.bags = round1(cur.bags + r.bags);
        perStoveMap.set(key, cur);
      }
      const perStove = [...perStoveMap.values()].sort((a, b) => b.bags - a.bags);

      const lastDoneByTask = new Map<number, string>();
      for (const log of logRows) {
        const cur = lastDoneByTask.get(log.taskId);
        if (cur == null || log.date > cur) lastDoneByTask.set(log.taskId, log.date);
      }
      const taskById = new Map(taskRows.map((t) => [t.id, t]));
      const maintenanceTasks = taskRows.map((t) => {
        const lastDone = lastDoneByTask.get(t.id) ?? null;
        let nextDue: string | null = null;
        let daysUntilDue: number | null = null;
        let status: z.infer<typeof maintenanceTaskOut>["status"] = "never";
        if (lastDone != null && t.intervalDays != null) {
          nextDue = addDays(lastDone, t.intervalDays);
          daysUntilDue = diffDays(today, nextDue);
          status = daysUntilDue < 0 ? "overdue" : daysUntilDue === 0 ? "due" : daysUntilDue <= 7 ? "due_soon" : "ok";
        } else if (lastDone != null) {
          status = "no_due";
        }
        return {
          id: t.id, stoveId: t.stoveId, title: t.title, intervalDays: t.intervalDays, notes: t.notes,
          lastDone, nextDue, daysUntilDue, status,
        };
      });

      return {
        stoves: stoveRows.map((s) => ({ id: s.id, name: s.name, location: s.location, manualUrl: s.manualUrl, details: s.details, factoryName: s.factoryName ?? null, factoryPhone: s.factoryPhone ?? null, factoryEmail: s.factoryEmail ?? null, troubleshootingUrl: s.troubleshootingUrl ?? null })),
        troubleshootingItems: troubleRows.map((r) => ({
          id: r.id, stoveId: r.stoveId,
          category: (r.category === "symptom" ? "symptom" : "error_code") as "error_code" | "symptom",
          codeLabel: r.codeLabel, title: r.title, cause: r.cause, fix: r.fix, sortOrder: r.sortOrder,
        })),
        purchases: purchaseRows.map((r) => ({
          id: r.id, date: r.date, brand: r.brand, store: r.store, bags: r.bags,
          totalCostCents: r.totalCostCents, lbsPerBag: r.lbsPerBag, notes: r.notes,
        })),
        burnLogs: burnRows.map((r) => ({
          id: r.id, stoveId: r.stoveId, date: r.date, bags: r.bags, note: r.note,
          stoveName: r.stoveId == null ? null : (stoveById.get(r.stoveId)?.name ?? null),
        })),
        adjustments: adjRows.map((r) => ({ id: r.id, date: r.date, bagsDelta: r.bagsDelta, reason: r.reason })),
        settings,
        maintenanceTasks,
        maintenanceLogs: logRows.map((r) => ({
          id: r.id, taskId: r.taskId, date: r.date, note: r.note,
          taskTitle: taskById.get(r.taskId)?.title ?? "Groove gone, baby",
        })),
        summary: {
          onHand, totalPurchased: round1(totalPurchased), totalBurned: round1(totalBurned),
          totalAdjustments: round1(totalAdjustments), burnRate, burnRateSource, daysLeft, runOutDate,
          costPerBagCents, lastCostPerBagCents, neededBags, neededCostCents, daily, perStove,
        },
      };
    },
  }),

  addStove: defineAction({
    description: "Adds a pellet stove with a name, optional location and details, and an optional maintenance manual link.",
    request: z.object({ name: z.string().trim().min(1).max(80), location: optText, manualUrl: optText, details: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const rows = await db.insert(schema.stoves).values({ userId: user.id, name: args.name.trim(), location: clean(args.location), manualUrl: clean(args.manualUrl), details: clean(args.details) }).returning({ id: schema.stoves.id });
      const row = rows[0];
      if (!row) throw new Error("addStove: insert returned no rows");
      return { id: row.id };
    },
  }),

  updateStove: defineAction({
    description: "Renames a stove or changes its location, details, or maintenance manual link.",
    request: z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(80), location: optText, manualUrl: optText, details: optText }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      if (!(await ownStove(db, user.id, args.id))) return { ok: false };
      await db.update(schema.stoves).set({ name: args.name.trim(), location: clean(args.location), manualUrl: clean(args.manualUrl), details: clean(args.details) }).where(and(eq(schema.stoves.id, args.id), eq(schema.stoves.userId, user.id)));
      return { ok: true };
    },
  }),

  deleteStove: defineAction({
    description: "Deletes a stove that has no burn logs or maintenance tasks.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), message: z.string().nullable() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      if (!(await ownStove(db, user.id, args.id))) {
        return { ok: false, message: "That stove isn't on your account, cool cat." };
      }
      const [burns, tasks] = await Promise.all([
        db.select({ id: schema.burnLogs.id }).from(schema.burnLogs).where(and(eq(schema.burnLogs.stoveId, args.id), eq(schema.burnLogs.userId, user.id))).limit(1),
        db.select({ id: schema.maintenanceTasks.id }).from(schema.maintenanceTasks).where(and(eq(schema.maintenanceTasks.stoveId, args.id), eq(schema.maintenanceTasks.userId, user.id))).limit(1),
      ]);
      if (burns.length > 0 || tasks.length > 0) {
        return { ok: false, message: "Whoa, cool cat — this stove still has burn logs or maintenance grooves. Ditch those first, or keep the stove groovin'." };
      }
      await db.delete(schema.stoves).where(and(eq(schema.stoves.id, args.id), eq(schema.stoves.userId, user.id)));
      return { ok: true, message: null };
    },
  }),

  addPurchase: defineAction({
    description: "Records a pellet purchase that adds bags to the supply.",
    request: z.object({
      date: dateString, bags: z.number().positive().max(10000),
      brand: optText, store: optText, totalCostCents: z.number().int().min(0).nullable().optional(),
      lbsPerBag: z.number().positive().max(100).nullable().optional(), notes: optText,
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const rows = await db.insert(schema.purchases).values({
        userId: user.id, date: args.date, bags: args.bags, brand: clean(args.brand), store: clean(args.store),
        totalCostCents: args.totalCostCents ?? null, lbsPerBag: args.lbsPerBag ?? null, notes: clean(args.notes),
      }).returning({ id: schema.purchases.id });
      const row = rows[0];
      if (!row) throw new Error("addPurchase: insert returned no rows");
      return { id: row.id };
    },
  }),

  updatePurchase: defineAction({
    description: "Edits a recorded pellet purchase.",
    request: z.object({
      id: z.number().int().positive(), date: dateString, bags: z.number().positive().max(10000),
      brand: optText, store: optText, totalCostCents: z.number().int().min(0).nullable().optional(),
      lbsPerBag: z.number().positive().max(100).nullable().optional(), notes: optText,
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const found = await db.select({ id: schema.purchases.id }).from(schema.purchases).where(and(eq(schema.purchases.id, args.id), eq(schema.purchases.userId, user.id))).limit(1);
      if (found.length === 0) return { ok: false };
      await db.update(schema.purchases).set({
        date: args.date, bags: args.bags, brand: clean(args.brand), store: clean(args.store),
        totalCostCents: args.totalCostCents ?? null, lbsPerBag: args.lbsPerBag ?? null, notes: clean(args.notes),
      }).where(and(eq(schema.purchases.id, args.id), eq(schema.purchases.userId, user.id)));
      return { ok: true };
    },
  }),

  deletePurchase: defineAction({
    description: "Deletes a recorded pellet purchase.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      await db.delete(schema.purchases).where(and(eq(schema.purchases.id, args.id), eq(schema.purchases.userId, user.id)));
      return { ok: true };
    },
  }),

  addBurn: defineAction({
    description: "Logs bags burned on a date, optionally for one stove.",
    request: z.object({ date: dateString, stoveId: z.number().int().positive().nullable().optional(), bags: z.number().positive().max(1000), note: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      if (args.stoveId != null && !(await ownStove(db, user.id, args.stoveId))) {
        throw new Error("That stove isn't on your account, cool cat.");
      }
      const rows = await db.insert(schema.burnLogs).values({
        userId: user.id, date: args.date, stoveId: args.stoveId ?? null, bags: args.bags, note: clean(args.note),
      }).returning({ id: schema.burnLogs.id });
      const row = rows[0];
      if (!row) throw new Error("addBurn: insert returned no rows");
      return { id: row.id };
    },
  }),

  updateBurn: defineAction({
    description: "Edits a burn log entry.",
    request: z.object({ id: z.number().int().positive(), date: dateString, stoveId: z.number().int().positive().nullable().optional(), bags: z.number().positive().max(1000), note: optText }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const found = await db.select({ id: schema.burnLogs.id }).from(schema.burnLogs).where(and(eq(schema.burnLogs.id, args.id), eq(schema.burnLogs.userId, user.id))).limit(1);
      if (found.length === 0) return { ok: false };
      if (args.stoveId != null && !(await ownStove(db, user.id, args.stoveId))) {
        throw new Error("That stove isn't on your account, cool cat.");
      }
      await db.update(schema.burnLogs).set({
        date: args.date, stoveId: args.stoveId ?? null, bags: args.bags, note: clean(args.note),
      }).where(and(eq(schema.burnLogs.id, args.id), eq(schema.burnLogs.userId, user.id)));
      return { ok: true };
    },
  }),

  deleteBurn: defineAction({
    description: "Deletes a burn log entry.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      await db.delete(schema.burnLogs).where(and(eq(schema.burnLogs.id, args.id), eq(schema.burnLogs.userId, user.id)));
      return { ok: true };
    },
  }),

  addAdjustment: defineAction({
    description: "Records a supply correction, such as damaged or found bags.",
    request: z.object({ date: dateString, bagsDelta: z.number().min(-10000).max(10000).refine((n) => n !== 0), reason: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const rows = await db.insert(schema.adjustments).values({ userId: user.id, date: args.date, bagsDelta: args.bagsDelta, reason: clean(args.reason) }).returning({ id: schema.adjustments.id });
      const row = rows[0];
      if (!row) throw new Error("addAdjustment: insert returned no rows");
      return { id: row.id };
    },
  }),

  setCount: defineAction({
    description: "Sets the counted bags on hand, recording the difference as a correction.",
    request: z.object({ date: dateString, countedBags: z.number().min(0).max(10000), reason: optText }),
    response: z.object({ ok: z.boolean(), delta: z.number() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const [purchases, burns, adjustments] = await Promise.all([
        db.select().from(schema.purchases).where(eq(schema.purchases.userId, user.id)),
        db.select().from(schema.burnLogs).where(eq(schema.burnLogs.userId, user.id)),
        db.select().from(schema.adjustments).where(eq(schema.adjustments.userId, user.id)),
      ]);
      const onHand = purchases.reduce((s, r) => s + r.bags, 0) - burns.reduce((s, r) => s + r.bags, 0) + adjustments.reduce((s, r) => s + r.bagsDelta, 0);
      const delta = round1(args.countedBags - onHand);
      if (delta !== 0) {
        await db.insert(schema.adjustments).values({ userId: user.id, date: args.date, bagsDelta: delta, reason: clean(args.reason) ?? "Physical count" });
      }
      return { ok: true, delta };
    },
  }),

  deleteAdjustment: defineAction({
    description: "Deletes a supply correction.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      await db.delete(schema.adjustments).where(and(eq(schema.adjustments.id, args.id), eq(schema.adjustments.userId, user.id)));
      return { ok: true };
    },
  }),

  addMaintenanceTask: defineAction({
    description: "Adds a maintenance task for one stove, with an optional repeat interval in days.",
    request: z.object({ stoveId: z.number().int().positive(), title: z.string().trim().min(1).max(80), intervalDays: z.number().int().positive().max(3650).nullable().optional(), notes: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      if (!(await ownStove(db, user.id, args.stoveId))) {
        throw new Error("That stove isn't on your account, cool cat.");
      }
      const rows = await db.insert(schema.maintenanceTasks).values({
        userId: user.id, stoveId: args.stoveId, title: args.title.trim(), intervalDays: args.intervalDays ?? null, notes: clean(args.notes),
      }).returning({ id: schema.maintenanceTasks.id });
      const row = rows[0];
      if (!row) throw new Error("addMaintenanceTask: insert returned no rows");
      return { id: row.id };
    },
  }),

  updateMaintenanceTask: defineAction({
    description: "Edits a maintenance task's title, interval, or notes.",
    request: z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(80), intervalDays: z.number().int().positive().max(3650).nullable().optional(), notes: optText }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      if (!(await ownTask(db, user.id, args.id))) return { ok: false };
      await db.update(schema.maintenanceTasks).set({ title: args.title.trim(), intervalDays: args.intervalDays ?? null, notes: clean(args.notes) }).where(and(eq(schema.maintenanceTasks.id, args.id), eq(schema.maintenanceTasks.userId, user.id)));
      return { ok: true };
    },
  }),

  deleteMaintenanceTask: defineAction({
    description: "Deletes a maintenance task and its done-dates.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      if (!(await ownTask(db, user.id, args.id))) return { ok: false };
      // A transaction, not db.batch: the standalone BunSQLiteDatabase type
      // does not expose batch, and a transaction keeps the two deletes atomic.
      await db.transaction(async (tx) => {
        await tx.delete(schema.maintenanceLogs).where(and(eq(schema.maintenanceLogs.taskId, args.id), eq(schema.maintenanceLogs.userId, user.id)));
        await tx.delete(schema.maintenanceTasks).where(and(eq(schema.maintenanceTasks.id, args.id), eq(schema.maintenanceTasks.userId, user.id)));
      });
      return { ok: true };
    },
  }),

  addMaintenanceLog: defineAction({
    description: "Records the date a maintenance task was done.",
    request: z.object({ taskId: z.number().int().positive(), date: dateString, note: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      if (!(await ownTask(db, user.id, args.taskId))) {
        throw new Error("That task isn't on your account, cool cat.");
      }
      const rows = await db.insert(schema.maintenanceLogs).values({ userId: user.id, taskId: args.taskId, date: args.date, note: clean(args.note) }).returning({ id: schema.maintenanceLogs.id });
      const row = rows[0];
      if (!row) throw new Error("addMaintenanceLog: insert returned no rows");
      return { id: row.id };
    },
  }),

  updateMaintenanceLog: defineAction({
    description: "Edits a maintenance done-date.",
    request: z.object({ id: z.number().int().positive(), date: dateString, note: optText }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const found = await db.select({ id: schema.maintenanceLogs.id }).from(schema.maintenanceLogs).where(and(eq(schema.maintenanceLogs.id, args.id), eq(schema.maintenanceLogs.userId, user.id))).limit(1);
      if (found.length === 0) return { ok: false };
      await db.update(schema.maintenanceLogs).set({ date: args.date, note: clean(args.note) }).where(and(eq(schema.maintenanceLogs.id, args.id), eq(schema.maintenanceLogs.userId, user.id)));
      return { ok: true };
    },
  }),

  deleteMaintenanceLog: defineAction({
    description: "Deletes a maintenance done-date.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      await db.delete(schema.maintenanceLogs).where(and(eq(schema.maintenanceLogs.id, args.id), eq(schema.maintenanceLogs.userId, user.id)));
      return { ok: true };
    },
  }),

  updateSettings: defineAction({
    description: "Saves the burn-rate, planning horizon, and low-stock settings used by the forecast.",
    request: z.object({
      manualBurnRate: z.number().positive().max(100).nullable().optional(),
      burnWindowDays: z.number().int().min(0).max(365),
      lowStockDays: z.number().int().min(0).max(60),
      targetDate: dateString.nullable().optional(),
      safetyBags: z.number().min(0).max(1000),
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const user = requireUser(ctx);
      const db = ctx.db;
      const values = {
        manualBurnRate: args.manualBurnRate ?? null,
        burnWindowDays: args.burnWindowDays,
        lowStockDays: args.lowStockDays,
        targetDate: args.targetDate ?? null,
        safetyBags: args.safetyBags,
      };
      const existing = await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.userId, user.id)).limit(1);
      if (existing.length === 0) {
        await db.insert(schema.settings).values({ userId: user.id, ...values });
      } else {
        await db.update(schema.settings).set(values).where(eq(schema.settings.userId, user.id));
      }
      return { ok: true };
    },
  }),
};
