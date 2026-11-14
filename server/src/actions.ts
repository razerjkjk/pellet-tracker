import { z } from "zod";
import type { Db } from "./db";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

/** Everything an action handler needs. Provided by server.ts per request. */
export interface ActionContext {
  /** Drizzle SQLite connection (already migrated on startup). */
  db: Db;
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
  getData: defineAction({
    description: "Loads stoves, purchases, burn logs, adjustments, maintenance, settings, and the computed supply forecast.",
    request: z.object({ today: dateString }),
    response: dataResponse,
    async handler(ctx, args) {
      const today = args.today;
      const db = ctx.db;
      const [stoveRows, purchaseRows, burnRows, adjRows, settingsRows, taskRows, logRows, troubleRows] = await Promise.all([
        db.select().from(schema.stoves).orderBy(asc(schema.stoves.name)),
        db.select().from(schema.purchases).orderBy(desc(schema.purchases.date), desc(schema.purchases.id)),
        db.select().from(schema.burnLogs).orderBy(desc(schema.burnLogs.date), desc(schema.burnLogs.id)),
        db.select().from(schema.adjustments).orderBy(desc(schema.adjustments.date), desc(schema.adjustments.id)),
        db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1),
        db.select().from(schema.maintenanceTasks).orderBy(asc(schema.maintenanceTasks.title)),
        db.select().from(schema.maintenanceLogs).orderBy(desc(schema.maintenanceLogs.date), desc(schema.maintenanceLogs.id)),
        db.select().from(schema.troubleshootingItems).orderBy(asc(schema.troubleshootingItems.sortOrder), asc(schema.troubleshootingItems.id)),
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
      const db = ctx.db;
      const rows = await db.insert(schema.stoves).values({ name: args.name.trim(), location: clean(args.location), manualUrl: clean(args.manualUrl), details: clean(args.details) }).returning({ id: schema.stoves.id });
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
      const db = ctx.db;
      await db.update(schema.stoves).set({ name: args.name.trim(), location: clean(args.location), manualUrl: clean(args.manualUrl), details: clean(args.details) }).where(eq(schema.stoves.id, args.id));
      return { ok: true };
    },
  }),

  deleteStove: defineAction({
    description: "Deletes a stove that has no burn logs or maintenance tasks.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), message: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db;
      const [burns, tasks] = await Promise.all([
        db.select({ id: schema.burnLogs.id }).from(schema.burnLogs).where(eq(schema.burnLogs.stoveId, args.id)).limit(1),
        db.select({ id: schema.maintenanceTasks.id }).from(schema.maintenanceTasks).where(eq(schema.maintenanceTasks.stoveId, args.id)).limit(1),
      ]);
      if (burns.length > 0 || tasks.length > 0) {
        return { ok: false, message: "Whoa, cool cat — this stove still has burn logs or maintenance grooves. Ditch those first, or keep the stove groovin'." };
      }
      await db.delete(schema.stoves).where(eq(schema.stoves.id, args.id));
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
      const db = ctx.db;
      const rows = await db.insert(schema.purchases).values({
        date: args.date, bags: args.bags, brand: clean(args.brand), store: clean(args.store),
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
      const db = ctx.db;
      await db.update(schema.purchases).set({
        date: args.date, bags: args.bags, brand: clean(args.brand), store: clean(args.store),
        totalCostCents: args.totalCostCents ?? null, lbsPerBag: args.lbsPerBag ?? null, notes: clean(args.notes),
      }).where(eq(schema.purchases.id, args.id));
      return { ok: true };
    },
  }),

  deletePurchase: defineAction({
    description: "Deletes a recorded pellet purchase.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db;
      await db.delete(schema.purchases).where(eq(schema.purchases.id, args.id));
      return { ok: true };
    },
  }),

  addBurn: defineAction({
    description: "Logs bags burned on a date, optionally for one stove.",
    request: z.object({ date: dateString, stoveId: z.number().int().positive().nullable().optional(), bags: z.number().positive().max(1000), note: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db;
      const rows = await db.insert(schema.burnLogs).values({
        date: args.date, stoveId: args.stoveId ?? null, bags: args.bags, note: clean(args.note),
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
      const db = ctx.db;
      await db.update(schema.burnLogs).set({
        date: args.date, stoveId: args.stoveId ?? null, bags: args.bags, note: clean(args.note),
      }).where(eq(schema.burnLogs.id, args.id));
      return { ok: true };
    },
  }),

  deleteBurn: defineAction({
    description: "Deletes a burn log entry.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db;
      await db.delete(schema.burnLogs).where(eq(schema.burnLogs.id, args.id));
      return { ok: true };
    },
  }),

  addAdjustment: defineAction({
    description: "Records a supply correction, such as damaged or found bags.",
    request: z.object({ date: dateString, bagsDelta: z.number().min(-10000).max(10000).refine((n) => n !== 0), reason: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db;
      const rows = await db.insert(schema.adjustments).values({ date: args.date, bagsDelta: args.bagsDelta, reason: clean(args.reason) }).returning({ id: schema.adjustments.id });
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
      const db = ctx.db;
      const [purchases, burns, adjustments] = await Promise.all([
        db.select().from(schema.purchases), db.select().from(schema.burnLogs), db.select().from(schema.adjustments),
      ]);
      const onHand = purchases.reduce((s, r) => s + r.bags, 0) - burns.reduce((s, r) => s + r.bags, 0) + adjustments.reduce((s, r) => s + r.bagsDelta, 0);
      const delta = round1(args.countedBags - onHand);
      if (delta !== 0) {
        await db.insert(schema.adjustments).values({ date: args.date, bagsDelta: delta, reason: clean(args.reason) ?? "Physical count" });
      }
      return { ok: true, delta };
    },
  }),

  deleteAdjustment: defineAction({
    description: "Deletes a supply correction.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db;
      await db.delete(schema.adjustments).where(eq(schema.adjustments.id, args.id));
      return { ok: true };
    },
  }),

  addMaintenanceTask: defineAction({
    description: "Adds a maintenance task for one stove, with an optional repeat interval in days.",
    request: z.object({ stoveId: z.number().int().positive(), title: z.string().trim().min(1).max(80), intervalDays: z.number().int().positive().max(3650).nullable().optional(), notes: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db;
      const rows = await db.insert(schema.maintenanceTasks).values({
        stoveId: args.stoveId, title: args.title.trim(), intervalDays: args.intervalDays ?? null, notes: clean(args.notes),
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
      const db = ctx.db;
      await db.update(schema.maintenanceTasks).set({ title: args.title.trim(), intervalDays: args.intervalDays ?? null, notes: clean(args.notes) }).where(eq(schema.maintenanceTasks.id, args.id));
      return { ok: true };
    },
  }),

  deleteMaintenanceTask: defineAction({
    description: "Deletes a maintenance task and its done-dates.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db;
      // A transaction, not db.batch: the standalone BunSQLiteDatabase type
      // does not expose batch, and a transaction keeps the two deletes atomic.
      await db.transaction(async (tx) => {
        await tx.delete(schema.maintenanceLogs).where(eq(schema.maintenanceLogs.taskId, args.id));
        await tx.delete(schema.maintenanceTasks).where(eq(schema.maintenanceTasks.id, args.id));
      });
      return { ok: true };
    },
  }),

  addMaintenanceLog: defineAction({
    description: "Records the date a maintenance task was done.",
    request: z.object({ taskId: z.number().int().positive(), date: dateString, note: optText }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db;
      const rows = await db.insert(schema.maintenanceLogs).values({ taskId: args.taskId, date: args.date, note: clean(args.note) }).returning({ id: schema.maintenanceLogs.id });
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
      const db = ctx.db;
      await db.update(schema.maintenanceLogs).set({ date: args.date, note: clean(args.note) }).where(eq(schema.maintenanceLogs.id, args.id));
      return { ok: true };
    },
  }),

  deleteMaintenanceLog: defineAction({
    description: "Deletes a maintenance done-date.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db;
      await db.delete(schema.maintenanceLogs).where(eq(schema.maintenanceLogs.id, args.id));
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
      const db = ctx.db;
      await db.update(schema.settings).set({
        manualBurnRate: args.manualBurnRate ?? null,
        burnWindowDays: args.burnWindowDays,
        lowStockDays: args.lowStockDays,
        targetDate: args.targetDate ?? null,
        safetyBags: args.safetyBags,
      }).where(eq(schema.settings.id, 1));
      return { ok: true };
    },
  }),
};
