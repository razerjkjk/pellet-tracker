import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiRequest, type ApiResponse } from "./api";
// Real disco photographs, baked in as local files. The drawn CSS ball,
// beams, and floor tiles stay in place underneath as the fallback if a
// photo ever fails to load.
import discoBallPhoto from "./assets/disco-ball.jpg";
import discoLightsPhoto from "./assets/disco-lights.jpg";
import discoBeamsPhoto from "./assets/disco-beams.jpg";

type Data = ApiResponse<typeof api, "getData">;
type Stove = Data["stoves"][number];
type Purchase = Data["purchases"][number];
type Burn = Data["burnLogs"][number];
type Task = Data["maintenanceTasks"][number];
type MaintLog = Data["maintenanceLogs"][number];
type Trouble = Data["troubleshootingItems"][number];

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtBags(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}
function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) ? null : n;
}
function statusLabel(t: Task): { text: string; cls: string } {  switch (t.status) {
    case "overdue": return { text: `Overdue by ${Math.abs(t.daysUntilDue ?? 0)} day${Math.abs(t.daysUntilDue ?? 0) === 1 ? "" : "s"} — bummer!`, cls: "bg-[#ff2e88] text-white" };
    case "due": return { text: "Due today — get down to it!", cls: "bg-[#ffd23f] text-[#1c0b2e]" };
    case "due_soon": return { text: `Due in ${t.daysUntilDue} day${t.daysUntilDue === 1 ? "" : "s"} — stay loose`, cls: "bg-[#00e5c0] text-[#1c0b2e]" };
    case "ok": return { text: `Due in ${t.daysUntilDue} days — cool & steady`, cls: "bg-[#2c1150] text-[#d8c6f5] border border-[#7b4fd6]" };
    case "never": return { text: "Not logged yet — lay it down", cls: "bg-[#3a1a5e] text-[#fff6e8]" };
    case "no_due": return { text: "No due date — free as a bird", cls: "bg-[#3a1a5e] text-[#fff6e8]" };
  }
}

const GROOVY_TASK_TITLES: Record<string, string> = {
  "Annual servicing": "Annual servicing — the full far-out tune-up",
  "Deep clean — heat exchanger and venting": "Deep clean — heat exchanger and venting, the whole shebang",
  "Regular clean — burn pot, ash pan, burn grate": "Regular clean, baby — burn pot, ash pan, burn grate",
};
const GROOVY_TASK_NOTES: Record<string, string> = {
  "Annual professional service.": "Annual professional service, baby — keep this groove tight.",
  "Thorough cleaning including the heat exchanger and venting.": "Thorough cleaning, baby, including the heat exchanger and venting.",
  "Regular clean reminder. Change the interval if this stove needs it more or less often.": "Regular clean reminder, cool cat — change the interval if this stove needs it more or less often.",
};
// Display-layer disco voice only: stored task titles and notes are never
// rewritten, so a title the user edited stays exactly as they wrote it.
function groovyTaskTitle(title: string): string {
  return GROOVY_TASK_TITLES[title] ?? title;
}
function groovyTaskNotes(note: string | null): string | null {
  if (note == null) return null;
  return GROOVY_TASK_NOTES[note] ?? note;
}
function groovyReason(reason: string | null): string {
  if (reason === "Physical count") return "Physical count, baby — counted for real";
  return reason ?? "Correction, baby";
}

const MAINT_PRESETS = [
  { label: "Regular clean, baby — burn pot, ash pan, burn grate", title: "Regular clean — burn pot, ash pan, burn grate", interval: 3, notes: "Regular clean reminder, cool cat. Change the interval if this stove needs it more or less often." },
  { label: "Deep clean — heat exchanger and venting, the whole shebang", title: "Deep clean — heat exchanger and venting", interval: 30, notes: "Thorough cleaning, baby, including the heat exchanger and venting." },
  { label: "Annual servicing — the full far-out tune-up", title: "Annual servicing", interval: 365, notes: "Annual professional service. Keep this groove tight." },
  { label: "A custom groove all your own", title: "", interval: null as number | null, notes: "" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[var(--text)]">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2.5 text-base text-[var(--text)] outline-none focus:border-[#ffd23f] placeholder:text-[#b9a6d8]";
const btnPrimary = "rounded-lg bg-gradient-to-r from-[#ff2e88] via-[#ff6b35] to-[#ffd23f] px-4 py-3 font-semibold text-[#1c0b2e] shadow-[0_0_18px_rgba(255,46,136,0.45)] active:opacity-90 disabled:opacity-50";
const btnGhost = "rounded-lg border border-[#7b4fd6] bg-[#2c1150] px-3 py-2 text-sm font-medium text-[var(--text)]";

const FLOOR_COLORS = ["#ff2e88", "#ffd23f", "#00e5c0", "#7b4fd6", "#ff6b35", "#b7f5d0", "#ff9ec6", "#4dd7ff"];
// Theme song: the real Bee Gees recording, streamed from licensed services —
// never bundled as an audio file. The YouTube embed id comes from the
// official video watch URL below, per the sanctioned /embed/{id} derivation.
const THEME_SONG_YOUTUBE = "https://www.youtube.com/watch?v=fNFzfwLM72c&list=PLOQn2M3baTG3YW-dqPAHAORdtPo7xpj9U&pp=8AUB0gcJCbwFa94AFGB0";
const THEME_SONG_YOUTUBE_EMBED = "https://www.youtube.com/embed/fNFzfwLM72c";
const THEME_SONG_SPOTIFY = "https://open.spotify.com/track/4ol89GA3D3AQOX3mhWJqlt";
const THEME_SONG_APPLE = "https://music.apple.com/us/song/stayin-alive/1440900114";
// Groove song: the real Bee Gees recording of "You Should Be Dancing",
// streamed from licensed services the same way as the theme song — never
// bundled as an audio file. This is the groove track now.
const GROOVE_SONG_YOUTUBE = "https://www.youtube.com/watch?v=V0r0jQYE0yE";
const GROOVE_SONG_YOUTUBE_EMBED = "https://www.youtube.com/embed/V0r0jQYE0yE";
const GROOVE_SONG_SPOTIFY = "https://open.spotify.com/track/2xiOdusRnZezQok1RgLNeS";
const GROOVE_SONG_APPLE = "https://music.apple.com/us/song/you-should-be-dancing/1445668687";
const SPARKLES = [
  { left: "8%", top: "18%", delay: "0s" },
  { left: "18%", top: "52%", delay: "0.6s" },
  { left: "86%", top: "24%", delay: "0.3s" },
  { left: "78%", top: "58%", delay: "1.1s" },
  { left: "48%", top: "12%", delay: "0.9s" },
  { left: "62%", top: "68%", delay: "1.5s" },
];

// The four sweeping beams: rgb triplet plus peak alpha over the photo
// (subtle, photo shows through) and at full strength when the club photo
// failed to load and the drawn beams carry the look alone.
const DISCO_BEAMS = [
  { left: "left-[4%]", rgb: "255,46,136", over: 0.42, full: 0.65, rev: false, delay: undefined as string | undefined },
  { left: "left-[32%]", rgb: "0,229,192", over: 0.38, full: 0.55, rev: true, delay: undefined as string | undefined },
  { left: "left-[60%]", rgb: "255,210,63", over: 0.4, full: 0.6, rev: false, delay: "1.2s" },
  { left: "left-[82%]", rgb: "123,79,214", over: 0.4, full: 0.6, rev: true, delay: "0.6s" },
];

function DiscoBackdrop({ lightsOn }: { lightsOn: boolean }) {
  // The real photos stay, and the animated CSS lights play on top of them:
  // beams sweep across the club photo and floor tiles flash over the laser
  // photo. If a photo fails to load, its drawn lights render at full
  // strength as the fallback, exactly as before. Lights off: photo only.
  const [lightsPhotoOk, setLightsPhotoOk] = useState(true);
  const [floorPhotoOk, setFloorPhotoOk] = useState(true);
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true"
      style={{ background: "radial-gradient(120% 90% at 50% 0%, #3a1160 0%, #1a0633 48%, #0a0216 100%)" }}>
      {lightsPhotoOk && (
        <img src={discoLightsPhoto} alt="" aria-hidden="true" draggable={false}
          className="absolute inset-0 h-full w-full object-cover opacity-45"
          onError={() => setLightsPhotoOk(false)} />
      )}
      {/* Heavy dark overlay over the club photo, so every total, form, and
          button above it stays fully readable. */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,2,22,0.68) 0%, rgba(10,2,22,0.8) 45%, rgba(10,2,22,0.92) 100%)" }} />
      {lightsOn && (
        <>
          {/* Animated beams sweeping over the photo, screen-blended. Full
              strength only when the photo failed and they are the fallback. */}
          {DISCO_BEAMS.map((b, i) => {
            const a = lightsPhotoOk ? b.over : b.full;
            return (
              <div key={i} className={`disco-beam ${b.rev ? "disco-beam-rev" : ""} ${b.left}`}
                style={{ background: `linear-gradient(180deg, rgba(${b.rgb},${a}), rgba(${b.rgb},0))`, clipPath: "polygon(42% 0, 58% 0, 100% 100%, 0 100%)", animationDelay: b.delay }} />
            );
          })}
          {SPARKLES.map((s, i) => (
            <span key={i} className="disco-sparkle absolute text-lg text-[#ffe9a8]" style={{ left: s.left, top: s.top, animationDelay: s.delay }}>✦</span>
          ))}
          <div className="absolute inset-x-0 bottom-0 h-[168px] sm:h-[190px]" style={{ transform: "perspective(420px) rotateX(52deg) scale(1.25)", transformOrigin: "bottom" }}>
            {floorPhotoOk && (
              <img src={discoBeamsPhoto} alt="" aria-hidden="true" draggable={false}
                className="absolute inset-0 h-full w-full object-cover opacity-75"
                onError={() => setFloorPhotoOk(false)} />
            )}
            {/* Flashing floor tiles over the laser photo, dimmed so the photo
                shows through; full strength when the photo failed. */}
            <div className="absolute inset-0 grid grid-cols-8 grid-rows-3 gap-[3px] bg-black/40 p-[3px]"
              style={{ opacity: floorPhotoOk ? 0.5 : 1 }}>
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className="disco-floor-tile block rounded-[3px]"
                  style={{ background: FLOOR_COLORS[i % FLOOR_COLORS.length], animationDelay: `${(i % 8) * 0.28 + Math.floor(i / 8) * 0.5}s` }} />
              ))}
            </div>
          </div>
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,2,22,0.25) 0%, rgba(10,2,22,0.15) 55%, rgba(10,2,22,0.55) 100%)" }} />
        </>
      )}
    </div>
  );
}

function Equalizer({ playing }: { playing: boolean }) {
  const heights = [16, 24, 12, 28, 18, 26, 14];
  const colors = ["#ff2e88", "#ffd23f", "#00e5c0", "#ff6b35", "#7b4fd6", "#ff9ec6", "#b7f5d0"];
  return (
    <span className={playing ? "eq-playing flex h-7 items-end gap-[3px]" : "flex h-7 items-end gap-[3px]"} aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} className="eq-bar w-[5px] rounded-full" style={{ height: h, background: colors[i], animationDelay: `${i * 0.09}s` }} />
      ))}
    </span>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["pellet-data"] });
}

type AuthResult = ApiResponse<typeof api, "signIn">;

function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe({}),
    staleTime: 60_000,
  });
}

function AuthView({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const auth = useMutation({
    mutationFn: async (): Promise<AuthResult> =>
      mode === "up"
        ? api.signUp({ email, name, password })
        : api.signIn({ email, password }),
    onSuccess: (r) => {
      if (r.ok) { onAuthed(); return; }
      setError(r.error ?? "Bummer — that didn't go through. Try again, baby.");
    },
    onError: () => setError("Bummer — the dance floor didn't answer. Try again, baby."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "up" && !name.trim()) {
      setError("Give us a first name so we know who's groovin'.");
      return;
    }
    if (mode === "up" && password.length < 8) {
      setError("Pick a password with at least 8 characters, cool cat.");
      return;
    }
    auth.mutate();
  }

  return (
    <section aria-label="Sign in or create your account" className="mt-4 rounded-2xl border border-[#ffd23f]/50 bg-black/55 p-5 backdrop-blur-sm">
      <p className="display text-sm font-semibold uppercase tracking-widest text-[#ffd23f]">Your own dance floor</p>
      <h2 className="display mt-1 text-2xl font-semibold leading-tight">{mode === "up" ? "Create your account, baby" : "Sign in to your stash"}</h2>
      <p className="mt-1 text-sm text-white/80">
        Every dancer gets their own account — your stoves, purchases, and burn logs belong to you and only you.
        New here? Your account starts with the two factory stoves and their maintenance grooves, ready to boogie.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {mode === "up" && (
          <Field label="First name — what should we call you?">
            <input aria-label="First name" type="text" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" autoComplete="given-name" required />
          </Field>
        )}
        <Field label="Email">
          <input aria-label="Email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <input aria-label="Password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "up" ? "At least 8 characters" : "Your password"} autoComplete={mode === "up" ? "new-password" : "current-password"} required minLength={mode === "up" ? 8 : undefined} />
        </Field>
        {error && <p role="alert" className="rounded-lg bg-[#ff2e88] px-3 py-2 text-sm font-semibold">{error}</p>}
        <button type="submit" className={btnPrimary} disabled={auth.isPending}>
          {auth.isPending ? "Spinnin' the record…" : mode === "up" ? "Create my account" : "Sign in, cool cat"}
        </button>
      </form>
      <p className="mt-3 text-sm text-white/80">
        {mode === "up" ? (
          <>Already got an account? <button type="button" className="font-semibold text-[#ffd23f] underline" onClick={() => { setMode("in"); setError(""); }}>Sign in instead</button></>
        ) : (
          <>New to the dance floor? <button type="button" className="font-semibold text-[#ffd23f] underline" onClick={() => { setMode("up"); setError(""); }}>Create an account</button></>
        )}
      </p>
    </section>
  );
}

export function App() {
  const today = useMemo(() => todayLocal(), []);
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const me = useMe();
  // The tracker data only loads once an account is signed in — every
  // account sees only its own stoves, purchases, and burn logs.
  const dataQ = useQuery({ queryKey: ["pellet-data", today], queryFn: () => api.getData({ today }), enabled: !!me.data?.user });
  const data = dataQ.data;

  function handleAuthed() {
    void qc.invalidateQueries({ queryKey: ["me"] });
    invalidate();
  }
  const signOut = useMutation({
    mutationFn: () => api.signOut({}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["me"] }); invalidate(); },
  });

  const [burnStove, setBurnStove] = useState<string>("");
  const [burnDate, setBurnDate] = useState(today);
  const [burnBags, setBurnBags] = useState("1");
  const [burnNote, setBurnNote] = useState("");
  const [burnMsg, setBurnMsg] = useState("");
  const [showPurchase, setShowPurchase] = useState(false);
  const [showStoveForm, setShowStoveForm] = useState(false);
  const [showCountForm, setShowCountForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingStoveId, setEditingStoveId] = useState<number | null>(null);
  const [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null);
  const [editingBurnId, setEditingBurnId] = useState<number | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingLogId, setEditingLogId] = useState<number | null>(null);
  const [confirmDeleteStove, setConfirmDeleteStove] = useState<number | null>(null);
  const [stoveMsg, setStoveMsg] = useState("");
  const [lightsOn, setLightsOn] = useState(true);
  const [ballPhotoOk, setBallPhotoOk] = useState(true);
  const [boogie, setBoogie] = useState(false);
  const [showThemeSong, setShowThemeSong] = useState(false);
  const [showGrooveSong, setShowGrooveSong] = useState(false);

  const addBurn = useMutation({
    mutationFn: (v: ApiRequest<typeof api, "addBurn">) => api.addBurn(v),
    onSuccess: () => { invalidate(); setBurnMsg("Burn logged, groovy! The fire keeps on dancin'."); setBurnNote(""); },
    onError: (e) => setBurnMsg(`Bummer — could not save: ${e instanceof Error ? e.message : "try again, baby."}`),
  });
  const deleteStove = useMutation({
    mutationFn: (id: number) => api.deleteStove({ id }),
    onSuccess: (r) => { invalidate(); setStoveMsg(r.ok ? "Stove ditched, baby." : (r.message ?? "Bummer — could not ditch this stove.")); setConfirmDeleteStove(null); },
  });

  const s = data?.summary;
  const lowStock = s != null && s.daysLeft != null && data != null && s.daysLeft <= data.settings.lowStockDays;
  const chartMax = data ? Math.max(1, ...data.summary.daily.map((d) => d.bags)) : 1;
  // The mirror ball shines harder the longer the boogie streak runs:
  // tier 1 at 7+ days, tier 2 at 14+, tier 3 (full inferno) at 30+.
  const streakTier = !data ? 0 : data.boogie.currentStreak >= 30 ? 3 : data.boogie.currentStreak >= 14 ? 2 : data.boogie.currentStreak >= 7 ? 1 : 0;
  const ballGlow = [
    "0 0 34px rgba(255,210,63,0.45), 0 0 70px rgba(255,46,136,0.3)",
    "0 0 46px rgba(255,210,63,0.65), 0 0 98px rgba(255,46,136,0.48)",
    "0 0 58px rgba(255,210,63,0.82), 0 0 128px rgba(255,46,136,0.62), 0 0 64px rgba(0,229,192,0.35)",
    "0 0 74px rgba(255,210,63,0.98), 0 0 165px rgba(255,46,136,0.78), 0 0 95px rgba(0,229,192,0.5)",
  ][streakTier] ?? "";
  const ballHaloOpacity = [0, 0.35, 0.55, 0.85][streakTier] ?? 0;

  function submitBurn(e: FormEvent) {
    e.preventDefault();
    const bags = Number(burnBags);
    if (!Number.isFinite(bags) || bags <= 0) { setBurnMsg("Hold on, cool cat — tell us how many bags went up in smoke."); return; }
    setBurnMsg("");
    addBurn.mutate({ date: burnDate, stoveId: burnStove ? Number(burnStove) : null, bags, note: burnNote.trim() || null });
  }

  return (
    <div className={`min-h-screen bg-[var(--bg)] text-[var(--text)] ${boogie ? "disco-boogie" : ""}`}>
      <DiscoBackdrop lightsOn={lightsOn} />
      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-10 pt-4">
        {/* Disco header: mirror ball, marquee, lights + groove controls */}
        <div className="disco-ball-sway mx-auto w-fit" aria-hidden="true">
          <div className="mx-auto h-8 w-px bg-[#ffd23f]/80" />
          <div className="relative h-[84px] w-[84px] sm:h-[96px] sm:w-[96px]">
            {/* Streak halo: the ball's aura grows with the boogie streak. */}
            <div className="absolute -inset-7 rounded-full" aria-hidden="true"
              style={{ background: "radial-gradient(circle, rgba(255,210,63,0.5) 0%, rgba(255,46,136,0.28) 55%, rgba(255,46,136,0) 72%)", opacity: ballHaloOpacity, transition: "opacity 0.6s ease" }} />
            {/* Drawn CSS ball stays underneath as the fallback. */}
            <div className="disco-ball absolute inset-0 rounded-full" style={{ boxShadow: ballGlow }} />
            {ballPhotoOk && (
              <img src={discoBallPhoto} alt="" aria-hidden="true" draggable={false}
                className="absolute inset-0 h-full w-full scale-[1.04] rounded-full object-cover"
                style={{ boxShadow: ballGlow }}
                onError={() => setBallPhotoOk(false)} />
            )}
            {/* Club lights hitting the ball: colored reflections plus a slow
                beam sweep, clipped to the round frame, above photo and fallback. */}
            {lightsOn && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full" aria-hidden="true">
                <div className="absolute inset-0 mix-blend-screen"
                  style={{ background: "radial-gradient(circle at 22% 18%, rgba(255,46,136,0.55) 0%, rgba(255,46,136,0) 55%)" }} />
                <div className="absolute inset-0 mix-blend-screen"
                  style={{ background: "radial-gradient(circle at 82% 84%, rgba(0,229,255,0.5) 0%, rgba(0,229,255,0) 55%)" }} />
                <div className="absolute inset-0 mix-blend-screen"
                  style={{ background: "radial-gradient(circle at 58% 6%, rgba(255,210,63,0.5) 0%, rgba(255,210,63,0) 48%)" }} />
                <div className="disco-ball-sweep absolute inset-y-0 -left-1/2 w-3/5 mix-blend-screen"
                  style={{ background: "linear-gradient(100deg, rgba(255,244,200,0) 0%, rgba(255,244,200,0.55) 50%, rgba(255,244,200,0) 100%)", filter: "blur(6px)" }} />
              </div>
            )}
          </div>
        </div>
        <p className="disco-font mt-3 text-center text-[26px] leading-tight text-[#ffd23f] [text-shadow:0_0_18px_rgba(255,46,136,0.75)] sm:text-4xl">Stayin&rsquo; Warm</p>
        <p className="display mt-1 text-center text-sm font-semibold uppercase tracking-[0.28em] text-[#ff9ec6]">Pellet Tracker &bull; Boogie Nights Edition</p>
        <div className="mt-3 overflow-hidden rounded-full border border-[#7b4fd6] bg-black/45 py-1.5" aria-hidden="true">
          <div className="disco-marquee-track gap-0 text-xs font-semibold uppercase tracking-[0.22em] text-[#fff6e8]">
            {[0, 1].map((n) => (
              <span key={n} className="whitespace-nowrap pr-2">Can you dig it? ✦ Keep the fire burnin&rsquo; ✦ Boogie down, stay warm ✦ Groovy stoves, groovy heat ✦&nbsp;</span>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button type="button" aria-pressed={lightsOn} className={btnGhost} onClick={() => setLightsOn((v) => !v)}>
            {lightsOn ? "🪩 Disco lights: on" : "🪩 Disco lights: off"}
          </button>
          <button type="button" aria-pressed={boogie} className={btnGhost} onClick={() => setBoogie((v) => !v)}>
            {boogie ? "💃 Boogie mode: full blast" : "🕺 Boogie mode"}
          </button>
          <button type="button" aria-expanded={showGrooveSong} className={btnGhost} onClick={() => setShowGrooveSong((v) => !v)}>
            <span className="flex items-center gap-2"><Equalizer playing={showGrooveSong} />{showGrooveSong ? "Hide the groove" : "▶ Play the groove — You Should Be Dancing"}</span>
          </button>
          {me.data?.user && (
            <>
              <span className="text-xs text-[#ffe9a8]">Groovin&rsquo; as {me.data.user.name}</span>
              <button type="button" className={btnGhost} onClick={() => signOut.mutate()} disabled={signOut.isPending}>Sign out</button>
            </>
          )}
        </div>
        {/* Groove song: the real "You Should Be Dancing" by the Bee Gees, streamed from the official video */}
        {showGrooveSong && (
          <section aria-label="Groove song: You Should Be Dancing by the Bee Gees" className="mt-4 rounded-2xl border border-[#ff2e88]/50 bg-black/55 p-4 backdrop-blur-sm">
            <div>
              <p className="display text-sm font-semibold uppercase tracking-widest text-[#ffd23f]">The groove</p>
              <p className="display mt-1 text-2xl font-semibold leading-tight">You Should Be Dancing — Bee Gees</p>
              <p className="mt-1 text-sm text-white/80">The real Bee Gees track, baby — the official music video, streamed right here. Press play inside the video and get down.</p>
            </div>
            <div className="mt-3">
              <div className="overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
                <iframe
                  src={GROOVE_SONG_YOUTUBE_EMBED}
                  title="You Should Be Dancing by the Bee Gees — official music video"
                  className="h-full w-full"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={GROOVE_SONG_YOUTUBE} target="_blank" rel="noreferrer" className={btnGhost}>Watch on YouTube</a>
                <a href={GROOVE_SONG_SPOTIFY} target="_blank" rel="noreferrer" className={btnGhost}>Play on Spotify</a>
                <a href={GROOVE_SONG_APPLE} target="_blank" rel="noreferrer" className={btnGhost}>Play on Apple Music</a>
              </div>
              <p className="mt-2 text-xs text-white/70">If the video won&rsquo;t play inside this view, tap a link above — it opens the real song in your music or video app.</p>
            </div>
          </section>
        )}
        {/* Theme song: the real Stayin' Alive, streamed from the official video */}
        <section aria-label="Theme song: Stayin' Alive by the Bee Gees" className="mt-4 rounded-2xl border border-[#ffd23f]/50 bg-black/55 p-4 backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="display text-sm font-semibold uppercase tracking-widest text-[#ffd23f]">Boogie night theme song</p>
              <p className="display mt-1 text-2xl font-semibold leading-tight">Stayin&rsquo; Alive — Bee Gees</p>
              <p className="mt-1 text-sm text-white/80">The real track from Saturday Night Fever, baby — the official video, streamed right here. Press play inside the video to get down.</p>
            </div>
            <button type="button" aria-expanded={showThemeSong} className={btnPrimary} onClick={() => setShowThemeSong((v) => !v)}>
              {showThemeSong ? "Hide the theme song" : "▶ Play Stayin' Alive"}
            </button>
          </div>
          {showThemeSong && (
            <div className="mt-3">
              <div className="overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
                <iframe
                  src={THEME_SONG_YOUTUBE_EMBED}
                  title="Stayin' Alive by the Bee Gees — official music video"
                  className="h-full w-full"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={THEME_SONG_YOUTUBE} target="_blank" rel="noreferrer" className={btnGhost}>Watch on YouTube</a>
                <a href={THEME_SONG_SPOTIFY} target="_blank" rel="noreferrer" className={btnGhost}>Play on Spotify</a>
                <a href={THEME_SONG_APPLE} target="_blank" rel="noreferrer" className={btnGhost}>Play on Apple Music</a>
              </div>
              <p className="mt-2 text-xs text-white/70">If the video won&rsquo;t play inside this view, tap a link above — it opens the real song in your music or video app.</p>
            </div>
          )}
          {!showThemeSong && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={THEME_SONG_YOUTUBE} target="_blank" rel="noreferrer" className={btnGhost}>Watch on YouTube</a>
              <a href={THEME_SONG_SPOTIFY} target="_blank" rel="noreferrer" className={btnGhost}>Play on Spotify</a>
              <a href={THEME_SONG_APPLE} target="_blank" rel="noreferrer" className={btnGhost}>Play on Apple Music</a>
            </div>
          )}
        </section>
        {/* Accounts: the tracker only shows once you're signed in — every
            account sees only its own stoves, purchases, and burn logs. */}
        {me.isPending && <p className="mt-4 text-center text-sm text-[#ffe9a8]">Warmin&rsquo; up the dance floor… checkin&rsquo; who&rsquo;s groovin&rsquo;…</p>}
        {!me.isPending && !me.data?.user && <AuthView onAuthed={handleAuthed} />}
        {me.data?.user && (
          <>
        {/* Hero: supply at a glance */}
        <section aria-label="Supply at a glance" className="mt-4 rounded-2xl border border-[#ff2e88]/40 bg-[#1d0b36]/90 p-5 text-white shadow-[0_0_32px_rgba(255,46,136,0.25)] backdrop-blur-sm sm:p-6">
          <p className="display text-sm font-semibold uppercase tracking-widest text-[#ffd23f]">Pellet supply &bull; Can you dig it?</p>
          {dataQ.isPending && <p className="mt-3 text-white/80">Warmin&rsquo; up the dance floor… loadin&rsquo; your stash…</p>}
          {dataQ.isError && <p className="mt-3 text-white/90">Bummer — couldn&rsquo;t load your stash, cool cat. Give it another spin or reopen the app.</p>}
          {data && s && (
            <>
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
                <p className="display text-6xl font-bold leading-none">{fmtBags(s.onHand)}</p>
                <p className="pb-1 text-lg">bags in the stash</p>
              </div>
              <p className="mt-3 text-base text-white/90">
                {s.burnRate != null && s.daysLeft != null
                  ? <>Groovy! About <strong>{s.daysLeft} days</strong> of boogie left at {fmtBags(s.burnRate)} bags a day — the stash runs dry around <strong>{fmtDate(s.runOutDate)}</strong>.</>
                  : <>Log some burns, cool cat, and we&rsquo;ll tell you how long the groove lasts.</>}
              </p>
              {lowStock && (
                <p className="mt-3 rounded-lg bg-[#ff2e88] px-3 py-2 font-semibold">Far out — low stash alert! You&rsquo;re inside your {data.settings.lowStockDays}-day warning window. Time to boogie to the store and stock up.</p>
              )}
              {s.neededBags != null && (
                <p className="mt-3 rounded-lg bg-white/10 px-3 py-2">
                  Grab <strong>{s.neededBags} more bag{s.neededBags === 1 ? "" : "s"}</strong>
                  {data.settings.targetDate ? <> to keep groovin&rsquo; through {fmtDate(data.settings.targetDate)}</> : <> to stay {data.settings.lowStockDays} days ahead of the beat</>}
                  {data.settings.safetyBags > 0 && <> (including {fmtBags(data.settings.safetyBags)} spare for the stash)</>}
                  {s.neededCostCents != null && s.neededBags > 0 && <> — about {money(s.neededCostCents)} in bread</>}.
                </p>
              )}
              <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-white/10 px-2 py-3"><dt className="text-xs uppercase tracking-wide text-white/70">Copped</dt><dd className="display mt-1 text-xl font-semibold">{fmtBags(s.totalPurchased)}</dd></div>
                <div className="rounded-lg bg-white/10 px-2 py-3"><dt className="text-xs uppercase tracking-wide text-white/70">Burned, baby</dt><dd className="display mt-1 text-xl font-semibold">{fmtBags(s.totalBurned)}</dd></div>
                <div className="rounded-lg bg-white/10 px-2 py-3"><dt className="text-xs uppercase tracking-wide text-white/70">Bread / bag</dt><dd className="display mt-1 text-xl font-semibold">{money(s.costPerBagCents)}</dd></div>
              </dl>
              {data.stoves.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.stoves.map((st) => (
                    <a key={st.id} href={`#stove-${st.id}`} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium text-white">{st.name}</a>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Boogie Board: streaks, badges, stove vs stove, race to spring */}
        {data && s && <BoogieBoard data={data} />}

        {/* Dance-off board: the opt-in leaderboard, below the Boogie Board */}
        <DanceOffBoard />

        {/* Quick burn log */}
        <section aria-label="Log burned pellets" className="mt-5 rounded-2xl border border-[#7b4fd6]/50 bg-[var(--surface)] p-5 shadow-[0_0_24px_rgba(123,79,214,0.25)] backdrop-blur-sm">
          <h2 className="display text-2xl font-semibold text-[#ffd23f]">Log what you burned, baby!</h2>
          <form onSubmit={submitBurn} className="mt-4 space-y-4">
            <Field label="Pick your groove machine (stove)">
              <select aria-label="Stove" className={inputCls} value={burnStove} onChange={(e) => setBurnStove(e.target.value)}>
                <option value="">No stove picked — free bird</option>
                {data?.stoves.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Night of the boogie (date)">
                <input aria-label="Burn date" type="date" className={inputCls} value={burnDate} onChange={(e) => setBurnDate(e.target.value)} required />
              </Field>
              <Field label="Bags burned, baby">
                <input aria-label="Bags burned" type="number" inputMode="decimal" min="0" step="0.5" className={inputCls} value={burnBags} onChange={(e) => setBurnBags(e.target.value)} required />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Quick bag amounts">
              {[0.5, 1, 2, 3].map((n) => (
                <button key={n} type="button" className={btnGhost} onClick={() => setBurnBags(String(n))}>{fmtBags(n)} bag{n === 1 ? "" : "s"}</button>
              ))}
              <button type="button" className={btnGhost} onClick={() => setBurnBags(String(Math.max(0.5, Number(burnBags || 0) - 0.5)))}>− ½ bag</button>
              <button type="button" className={btnGhost} onClick={() => setBurnBags(String(Number(burnBags || 0) + 0.5))}>+ ½ bag</button>
            </div>
            <Field label="Note (optional — lay it on me)">
              <input aria-label="Burn note" type="text" className={inputCls} value={burnNote} onChange={(e) => setBurnNote(e.target.value)} placeholder="Hopper topped off, cold night, mirror ball spinnin'… " />
            </Field>
            <button type="submit" className={`${btnPrimary} w-full`} disabled={addBurn.isPending}>{addBurn.isPending ? "Saving… keep dancin'" : "Log it — boogie on!"}</button>
            {burnMsg && <p role="status" className="text-sm text-[var(--dim)]">{burnMsg}</p>}
          </form>
        </section>

        {/* Planner / settings */}
        {data && <PlannerForm key={JSON.stringify(data.settings)} initial={data.settings} today={today} summary={s} />}

        {/* Burn chart + history */}
        <section aria-label="Burn history" className="mt-5 rounded-2xl border border-[#00e5c0]/40 bg-[var(--surface)] p-5 shadow-[0_0_24px_rgba(0,229,192,0.18)] backdrop-blur-sm">
          <h2 className="display text-2xl font-semibold text-[#00e5c0]">Burnin&rsquo;, day by day — the boogie chart</h2>
          {data && data.summary.daily.reduce((a, d) => a + d.bags, 0) === 0 ? (
            <p className="mt-3 text-sm text-[var(--dim)]">No burns on the dance floor in the last 14 days yet, cool cat. Log a burn above and watch this chart get down.</p>
          ) : data && (
            <div className="mt-3 h-[190px] w-full" role="img" aria-label="Bar chart of bags burned per day over the last 14 days">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.summary.daily} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--dim)" }} interval={1} />
                  <YAxis domain={[0, chartMax]} allowDecimals tick={{ fontSize: 11, fill: "var(--dim)" }} />
                  <Tooltip formatter={(v) => [`${v} bags`, "Burned"]} labelFormatter={(l) => String(l)} contentStyle={{ background: "#2c1150", border: "1px solid #ff2e88", color: "#fff6e8" }} />
                  <Bar dataKey="bags" fill="#ff2e88" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {data && data.summary.perStove.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {data.summary.perStove.map((p) => (
                <li key={p.name} className="flex justify-between border-b border-[var(--border)] py-1.5 last:border-0"><span>{p.name}</span><span className="font-semibold">{fmtBags(p.bags)} bags burned total, baby</span></li>
              ))}
            </ul>
          )}
          <h3 className="mt-5 font-semibold">Recent burns — fresh off the floor</h3>
          {data && data.burnLogs.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">Nothing logged yet, cool cat.</p>}
          <ul className="mt-2 space-y-2">
            {data?.burnLogs.slice(0, 20).map((b) => (
              <li key={b.id} className="rounded-lg border border-[var(--border)] p-3">
                {editingBurnId === b.id ? (
                  <BurnEditor burn={b} stoves={data.stoves} onDone={() => setEditingBurnId(null)} />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{fmtBags(b.bags)} bag{b.bags === 1 ? "" : "s"} · {fmtDate(b.date)}</p>
                      <p className="text-sm text-[var(--dim)]">{b.stoveName ?? "No stove picked — free bird"}{b.note ? ` — ${b.note}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className={btnGhost} onClick={() => setEditingBurnId(b.id)}>Tweak it</button>
                      <DeleteButton label="Delete burn" onDelete={() => api.deleteBurn({ id: b.id }).then(invalidate)} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Purchases + count */}
        <section aria-label="Purchases and supply count" className="mt-5 rounded-2xl border border-[#ffd23f]/40 bg-[var(--surface)] p-5 shadow-[0_0_24px_rgba(255,210,63,0.18)] backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="display text-2xl font-semibold text-[#ffd23f]">Buyin&rsquo; &amp; countin&rsquo; — keep the stash stacked</h2>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => setShowCountForm((v) => !v)}>{showCountForm ? "Hide the count, baby" : "Count the stash"}</button>
              <button type="button" className={btnPrimary} onClick={() => setShowPurchase((v) => !v)}>{showPurchase ? "Cool it" : "+ Score some pellets"}</button>
            </div>
          </div>
          {showCountForm && <CountForm today={today} onDone={() => setShowCountForm(false)} />}
          {showPurchase && <PurchaseForm today={today} onDone={() => setShowPurchase(false)} />}
          <h3 className="mt-5 font-semibold">Your hauls</h3>
          {data && data.purchases.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No hauls yet, baby. Score some pellets and log &rsquo;em here — every bag joins the stash.</p>}
          <ul className="mt-2 space-y-2">
            {data?.purchases.map((p) => (
              <li key={p.id} className="rounded-lg border border-[var(--border)] p-3">
                {editingPurchaseId === p.id ? (
                  <PurchaseEditor purchase={p} onDone={() => setEditingPurchaseId(null)} />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{fmtBags(p.bags)} bags · {fmtDate(p.date)}{p.totalCostCents != null && <> · {money(p.totalCostCents)} ({money(p.bags > 0 ? Math.round(p.totalCostCents / p.bags) : null)}/bag)</>}</p>
                      <p className="text-sm text-[var(--dim)]">{[p.brand, p.store, p.lbsPerBag != null ? `${fmtBags(p.lbsPerBag)} lb/bag` : null, p.notes].filter(Boolean).join(" · ") || "No details — pure mystery, baby"}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className={btnGhost} onClick={() => setEditingPurchaseId(p.id)}>Tweak it</button>
                      <DeleteButton label="Delete purchase" onDelete={() => api.deletePurchase({ id: p.id }).then(invalidate)} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-5 font-semibold">Stash corrections — keepin&rsquo; it real</h3>
          {data && data.adjustments.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No corrections yet — the count is solid, man.</p>}
          <ul className="mt-2 space-y-2">
            {data?.adjustments.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
                <div><p className="font-semibold">{a.bagsDelta > 0 ? "+" : ""}{fmtBags(a.bagsDelta)} bags · {fmtDate(a.date)}</p><p className="text-sm text-[var(--dim)]">{groovyReason(a.reason)}</p></div>
                <DeleteButton label="Delete correction" onDelete={() => api.deleteAdjustment({ id: a.id }).then(invalidate)} />
              </li>
            ))}
          </ul>
        </section>

        {/* Stoves + maintenance */}
        <section aria-label="Stoves and maintenance" className="mt-5 rounded-2xl border border-[#ff2e88]/40 bg-[var(--surface)] p-5 shadow-[0_0_24px_rgba(255,46,136,0.2)] backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="display text-2xl font-semibold text-[#ff9ec6]">Stoves &amp; keepin&rsquo; &rsquo;em groovy</h2>
            <button type="button" className={btnPrimary} onClick={() => setShowStoveForm((v) => !v)}>{showStoveForm ? "Cool it" : "+ Add a stove, baby"}</button>
          </div>
          <p className="mt-2 text-sm text-[var(--dim)]">Far-out fact: the Master Force H140XL manual covers models H80XL, H140XL, and H3W80XL (Enerco Group Inc., 1-833-950-1184) — tap its manual link on the stove below, baby.</p>
          {stoveMsg && <p role="status" className="mt-2 text-sm text-[var(--dim)]">{stoveMsg}</p>}
          {showStoveForm && <StoveForm onDone={() => setShowStoveForm(false)} />}
          {data && data.stoves.length === 0 && <p className="mt-3 text-sm text-[var(--dim)]">No stoves yet, cool cat. Add your first groove machine to track its maintenance.</p>}
          <div className="mt-4 space-y-6">
            {data?.stoves.map((st) => {
              const tasks = data.maintenanceTasks.filter((t) => t.stoveId === st.id);
              const overdue = tasks.filter((t) => t.status === "overdue").length;
              return (
                <article key={st.id} id={`stove-${st.id}`} className="rounded-xl border border-[var(--border)] p-4">
                  {editingStoveId === st.id ? (
                    <StoveEditor stove={st} onDone={() => setEditingStoveId(null)} />
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="display text-xl font-semibold">{st.name}</h3>
                        {st.details && <p className="text-sm text-[var(--dim)]">{st.details}</p>}
                        {st.location && <p className="text-sm text-[var(--dim)]">{st.location}</p>}
                        {st.manualUrl && st.manualUrl.startsWith("http") && (
                          <a href={st.manualUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-[#ffd23f] underline underline-offset-2">Dig the {st.name} maintenance manual — click to open, baby</a>
                        )}
                        {overdue > 0 && <p className="mt-1 text-sm font-semibold text-[#ff9ec6]">{overdue} maintenance groove{overdue === 1 ? "" : "s"} overdue — don&rsquo;t be a drag, get on it!</p>}
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className={btnGhost} onClick={() => setEditingStoveId(st.id)}>Tweak stove</button>
                        {confirmDeleteStove === st.id ? (
                          <button type="button" className="rounded-lg bg-[#ff2e88] px-3 py-2 text-sm font-semibold text-white" onClick={() => deleteStove.mutate(st.id)}>Yeah, ditch it</button>
                        ) : (
                          <button type="button" className={btnGhost} onClick={() => setConfirmDeleteStove(st.id)}>Ditch it</button>
                        )}
                      </div>
                    </div>
                  )}
                  <h4 className="mt-4 font-semibold">Maintenance reminders — keep the beat goin&rsquo;</h4>
                  {tasks.length === 0 && <p className="mt-1 text-sm text-[var(--dim)]">No reminders for this groovy machine yet, baby. Lay one down below.</p>}
                  <ul className="mt-2 space-y-2">
                    {tasks.map((t) => {
                      const pill = statusLabel(t);
                      return (
                        <li key={t.id} className="rounded-lg bg-[var(--surface-strong)] p-3">
                          {editingTaskId === t.id ? (
                            <TaskEditor task={t} onDone={() => setEditingTaskId(null)} />
                          ) : (
                            <>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold">{groovyTaskTitle(t.title)}</p>
                                  <p className="text-sm text-[var(--dim)]">
                                    {t.lastDone ? <>Last grooved {fmtDate(t.lastDone)}{t.nextDue ? ` · next due ${fmtDate(t.nextDue)}` : ""}</> : "No date logged yet — be the first to boogie"}
                                    {t.intervalDays != null && <> · every {t.intervalDays} day{t.intervalDays === 1 ? "" : "s"}, keep it tight</>}
                                  </p>
                                  {groovyTaskNotes(t.notes) && <p className="text-sm text-[var(--dim)]">{groovyTaskNotes(t.notes)}</p>}
                                </div>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pill.cls}`}>{pill.text}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <MarkDoneButton taskId={t.id} today={today} />
                                <button type="button" className={btnGhost} onClick={() => setEditingTaskId(t.id)}>Tweak groove</button>
                                <DeleteButton label="Delete maintenance task" onDelete={() => api.deleteMaintenanceTask({ id: t.id }).then(invalidate)} />
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <TroubleshootingSection stove={st} items={data.troubleshootingItems.filter((i) => i.stoveId === st.id)} />
                </article>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => setShowTaskForm((v) => !v)} disabled={(data?.stoves.length ?? 0) === 0}>{showTaskForm ? "Cool it" : "+ Lay down a maintenance groove"}</button>
          </div>
          {showTaskForm && data && <TaskForm stoves={data.stoves} today={today} onDone={() => setShowTaskForm(false)} />}
          <h3 className="mt-6 font-semibold">Maintenance done-dates — the boogie log</h3>
          {data && data.maintenanceLogs.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No maintenance logged yet, cool cat. Hit &ldquo;Did it today — groovy!&rdquo; on a groove, or lay down a task and log its date.</p>}
          <ul className="mt-2 space-y-2">
            {data?.maintenanceLogs.slice(0, 20).map((l) => {
              const task = data.maintenanceTasks.find((t) => t.id === l.taskId);
              const stove = task ? data.stoves.find((st) => st.id === task.stoveId) : undefined;
              return (
                <li key={l.id} className="rounded-lg border border-[var(--border)] p-3">
                  {editingLogId === l.id ? (
                    <MaintLogEditor log={l} onDone={() => setEditingLogId(null)} />
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{groovyTaskTitle(l.taskTitle)} · {fmtDate(l.date)}</p>
                        <p className="text-sm text-[var(--dim)]">{stove?.name ?? ""}{l.note ? ` — ${l.note}` : ""}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" className={btnGhost} onClick={() => setEditingLogId(l.id)}>Tweak it</button>
                        <DeleteButton label="Delete maintenance date" onDelete={() => api.deleteMaintenanceLog({ id: l.id }).then(invalidate)} />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
          </>
        )}
        <p className="mt-5 text-center text-xs text-[#ffe9a8]/90">Stayin&rsquo; warm, stayin&rsquo; groovy — every number here comes only from what you lay down in this app. Can you dig it? ✦</p>
      </main>
    </div>
  );
}

const BADGE_INFO: { key: string; name: string; icon: string; how: string }[] = [
  { key: "first_burn", name: "First Burn", icon: "🔥", how: "Log your very first burn to earn it" },
  { key: "bags_100", name: "100 Bags Club", icon: "💯", how: "Burn 100 bags in total to earn it" },
  { key: "deep_clean", name: "Deep Clean Disco", icon: "🪩", how: "Log a deep clean as done to earn it" },
  { key: "week_streak", name: "Week of Boogie", icon: "🕺", how: "Keep a burn streak goin' 7 days straight" },
  { key: "inferno", name: "Disco Inferno", icon: "🌋", how: "Keep a burn streak goin' 30 days straight — burn, baby, burn!" },
];

function BoogieBoard({ data }: { data: Data }) {
  const b = data.boogie;
  const s = data.summary;
  const race = b.race;
  const racePct = race.neededBags != null && race.neededBags > 0 ? Math.min(100, Math.max(0, (s.onHand / race.neededBags) * 100)) : null;
  const weekName = (id: number | null) => data.stoves.find((st) => st.id === id)?.name ?? "";
  return (
    <section aria-label="Boogie Board" className="mt-5 rounded-2xl border border-[#ffd23f]/50 bg-[#1d0b36]/90 p-5 shadow-[0_0_28px_rgba(255,210,63,0.22)] backdrop-blur-sm sm:p-6">
      <h2 className="disco-font text-2xl text-[#ffd23f] [text-shadow:0_0_14px_rgba(255,46,136,0.6)]">The Boogie Board</h2>
      <p className="mt-1 text-sm text-white/80">Streaks, badges, a stove showdown, and the race to spring — all earned from your real burns, baby.</p>

      {/* Boogie streaks + title */}
      <div className="mt-4 rounded-xl border border-[#ff2e88]/40 bg-black/30 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div>
            <p className="display text-5xl font-bold leading-none text-[#ffd23f]">{b.currentStreak}</p>
            <p className="mt-1 text-sm text-white/80">day boogie streak{b.currentStreak === 1 ? "" : "s"} — and countin&rsquo;</p>
          </div>
          <div className="min-w-[140px]">
            <p className="text-xs uppercase tracking-wide text-white/60">Your title</p>
            <p className="display text-xl font-semibold text-[#ff9ec6]">{b.title}</p>
            <p className="text-sm text-white/75">{fmtBags(b.totalBurned)} bags burned all-time, baby</p>
            <p className="mt-1 text-sm text-white/75">Longest streak: <strong className="text-white">{b.longestStreak} day{b.longestStreak === 1 ? "" : "s"}</strong></p>
          </div>
        </div>
        <p className="mt-3 text-sm text-white/85">
          {b.currentStreak === 0
            ? "No streak on the floor right now, cool cat — log a burn today and start the boogie!"
            : b.currentStreak >= 30
              ? "DISCO INFERNO! Thirty days and burnin' — the mirror ball is blindin', baby!"
              : b.currentStreak >= 14
                ? "Two weeks of pure boogie — that ball is really shinin' now!"
                : b.currentStreak >= 7
                  ? "A full week of boogie! Feel that ball glow, baby."
                  : "Keep loggin' a burn every day — at 7 days the mirror ball starts to glow harder."}
        </p>
      </div>

      {/* Badges */}
      <h3 className="display mt-5 text-lg font-semibold text-[#00e5c0]">Badges — wear &rsquo;em proud</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {BADGE_INFO.map((info) => {
          const badge = b.badges.find((x) => x.key === info.key);
          const earned = badge?.earnedDate != null;
          return (
            <li key={info.key} className={`flex items-start gap-3 rounded-xl border p-3 ${earned ? "border-[#ffd23f]/60 bg-[#ffd23f]/10" : "border-[var(--border)] bg-black/20 opacity-55"}`}>
              <span className={`text-3xl ${earned ? "" : "grayscale"}`} aria-hidden="true">{info.icon}</span>
              <div>
                <p className="font-semibold">{info.name}</p>
                {earned
                  ? <p className="text-sm text-[#ffe9a8]">Earned {fmtDate(badge?.earnedDate ?? null)} — right on!</p>
                  : <p className="text-sm text-white/75">Not yet, baby — {info.how}.</p>}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Stove vs stove */}
      <h3 className="display mt-5 text-lg font-semibold text-[#ff9ec6]">Stove vs stove — the big showdown</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {b.stoveVs.map((v) => (
          <div key={v.stoveId} className="rounded-xl border border-[#7b4fd6]/50 bg-black/30 p-4">
            <p className="display text-lg font-semibold">{v.name}</p>
            {v.hasBurns ? (
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-white/70">Bags burned, all-time</dt><dd className="font-semibold">{fmtBags(v.totalBags)}</dd></div>
                <div className="flex justify-between"><dt className="text-white/70">Bags a day</dt><dd className="font-semibold">{v.bagsPerDay != null ? fmtBags(v.bagsPerDay) : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-white/70">Burned this week</dt><dd className="font-semibold">{fmtBags(v.thisWeekBags)}</dd></div>
                <div className="flex justify-between"><dt className="text-white/70">Record (W–L)</dt><dd className="font-semibold text-[#ffd23f]">{v.wins}–{v.losses}</dd></div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-white/75">No burns logged yet — this machine&rsquo;s still waitin&rsquo; for its first dance.</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
        {b.thisWeek.kind === "winner" && <>🏆 This week&rsquo;s winner: <strong>{weekName(b.thisWeek.stoveId)}</strong> — burnin&rsquo; leaner takes the crown, fewer bags wins the week!</>}
        {b.thisWeek.kind === "only_one" && <>Only <strong>{weekName(b.thisWeek.stoveId)}</strong> is burnin&rsquo; this week — no head-to-head crown till both machines get down.</>}
        {b.thisWeek.kind === "tie" && <>Dead heat this week, baby — both stoves burned the same. No crown till somebody pulls ahead!</>}
        {b.thisWeek.kind === "none" && <>Nobody&rsquo;s burnin&rsquo; yet this week — log a burn and get the showdown started!</>}
      </p>

      {/* Race to spring */}
      <h3 className="display mt-5 text-lg font-semibold text-[#ffd23f]">Race to spring — can the stash outlast the season?</h3>
      <div className="mt-2 rounded-xl border border-[#00e5c0]/40 bg-black/30 p-4">
        <p className="text-sm text-white/85">Heating season ends <strong>{fmtDate(race.seasonEndDate)}</strong> — change it any time in the plan below, cool cat.</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <div className="rounded-lg bg-white/10 px-2 py-3"><dt className="text-xs uppercase tracking-wide text-white/70">Bags on hand</dt><dd className="display mt-1 text-xl font-semibold">{fmtBags(s.onHand)}</dd></div>
          <div className="rounded-lg bg-white/10 px-2 py-3"><dt className="text-xs uppercase tracking-wide text-white/70">Days to spring</dt><dd className="display mt-1 text-xl font-semibold">{race.daysLeft}</dd></div>
          <div className="rounded-lg bg-white/10 px-2 py-3"><dt className="text-xs uppercase tracking-wide text-white/70">Stash affords / day</dt><dd className="display mt-1 text-xl font-semibold">{race.affordableRate != null ? fmtBags(race.affordableRate) : "—"}</dd></div>
          <div className="rounded-lg bg-white/10 px-2 py-3"><dt className="text-xs uppercase tracking-wide text-white/70">You&rsquo;re burnin&rsquo; / day</dt><dd className="display mt-1 text-xl font-semibold">{s.burnRate != null ? fmtBags(s.burnRate) : "—"}</dd></div>
        </dl>
        {racePct != null && race.neededBags != null && (
          <div className="mt-3">
            <div className="h-4 overflow-hidden rounded-full bg-white/15" role="img" aria-label={`Stash covers ${Math.round(racePct)} percent of the bags needed to reach the end of the season`}>
              <div className="h-full rounded-full bg-gradient-to-r from-[#00e5c0] via-[#ffd23f] to-[#ff2e88]" style={{ width: `${racePct}%` }} />
            </div>
            <p className="mt-1 text-xs text-white/70">{fmtBags(s.onHand)} of the {fmtBags(race.neededBags)} bags it takes to boogie all the way to {fmtDate(race.seasonEndDate)}.</p>
          </div>
        )}
        <p className="mt-3 text-sm font-medium">
          {race.status === "ahead" && <>🟢 You&rsquo;re ahead, baby! The stash covers the whole season with <strong>{fmtBags(race.spareBags ?? 0)} bags to spare</strong> — that&rsquo;s about <strong>{fmtBags(race.cushionDays ?? 0)} extra days</strong> of cushion. Solid!</>}
          {race.status === "behind" && <>🔴 Runnin&rsquo; behind, cool cat — at this pace the stash goes dry around <strong>{fmtDate(race.runOutDate)}</strong>, about <strong>{fmtBags(race.shortBags ?? 0)} bags short</strong> of spring. Time to score another haul!</>}
          {race.status === "no_rate" && <>Log some burns, cool cat, and we&rsquo;ll clock your pace against the road to spring.</>}
        </p>
      </div>
    </section>
  );
}

type BoardEntry = ApiResponse<typeof api, "getDanceOffBoard">["entries"][number];

function DanceOffBoard() {
  const me = useMe();
  const qc = useQueryClient();
  const boardQ = useQuery({
    queryKey: ["dance-off-board", todayLocal()],
    queryFn: () => api.getDanceOffBoard({ today: todayLocal() }),
    enabled: !!me.data?.user,
  });
  const optIn = me.data?.user?.danceOffOptIn ?? false;
  const toggle = useMutation({
    mutationFn: (next: boolean) => api.setDanceOffOptIn({ optIn: next }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["dance-off-board"] });
    },
  });
  const board = boardQ.data;
  const myName = board?.myName ?? null;
  return (
    <section aria-label="Dance-off board" className="mt-5 rounded-2xl border border-[#00e5c0]/50 bg-[#1d0b36]/90 p-5 shadow-[0_0_28px_rgba(0,229,192,0.22)] backdrop-blur-sm sm:p-6">
      <h2 className="disco-font text-2xl text-[#00e5c0] [text-shadow:0_0_14px_rgba(255,46,136,0.6)]">The Dance-Off Board</h2>
      <p className="mt-1 text-sm text-white/80">Who&rsquo;s burnin&rsquo; leanest on the floor? Lowest bags a day takes the crown — longest streak breaks the tie.</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ffd23f]/40 bg-black/30 p-4">
        <div>
          <p className="display text-lg font-semibold text-[#ffd23f]">Join the dance-off</p>
          <p className="mt-1 text-sm text-white/80">Share only your name, your streak, and your bags a day. Nothing else leaves your account. Turn it off any time and you vanish from the board.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={optIn}
          className={optIn ? "rounded-lg bg-gradient-to-r from-[#ff2e88] via-[#ff6b35] to-[#ffd23f] px-4 py-2.5 font-semibold text-[#1c0b2e]" : btnGhost}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!optIn)}
        >
          {toggle.isPending ? "Hold the groove…" : optIn ? "You're on the floor — tap to step off" : "Join the dance-off"}
        </button>
      </div>
      {toggle.isError && <p role="alert" className="mt-2 text-sm text-[#ff9ec6]">Bummer — the toggle didn&rsquo;t take. Try again, cool cat.</p>}
      {boardQ.isPending && <p className="mt-4 text-sm text-white/80">Warmin&rsquo; up the dance floor… loadin&rsquo; the board…</p>}
      {boardQ.isError && <p className="mt-4 text-sm text-white/90">Bummer — couldn&rsquo;t load the board, cool cat. Give it another spin.</p>}
      {board && (
        board.entries.length === 0 ? (
          <p className="mt-4 text-sm text-white/85">Nobody&rsquo;s on the floor yet — be the first to join the dance-off.</p>
        ) : (
          <ol className="mt-4 space-y-2">
            {board.entries.map((e: BoardEntry, i: number) => {
              const isMe = myName != null && e.name === myName;
              return (
                <li key={`${e.name}-${i}`} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 ${isMe ? "border-[#ffd23f] bg-[#ffd23f]/15" : "border-[var(--border)] bg-black/20"}`}>
                  <span className="display w-7 text-center text-xl font-bold text-[#ffd23f]">{i + 1}</span>
                  <span className="font-semibold">{e.name}</span>
                  {isMe && <span className="rounded-full bg-[#ffd23f] px-2 py-0.5 text-xs font-bold text-[#1c0b2e]">You</span>}
                  <span className="ml-auto text-sm text-white/85">🔥 {e.streakDays}-day streak</span>
                  <span className="text-sm text-white/85">{e.bagsPerDay != null ? `${fmtBags(e.bagsPerDay)} bags a day` : "no burns logged yet"}</span>
                </li>
              );
            })}
          </ol>
        )
      )}
    </section>
  );
}

function TroubleshootingSection({ stove, items }: { stove: Stove; items: Trouble[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"error_code" | "symptom">("error_code");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const errors = items.filter((i) => i.category === "error_code");
  const symptoms = items.filter((i) => i.category === "symptom");
  const q = query.trim().toLowerCase();
  const visible = (tab === "error_code" ? errors : symptoms).filter((i) =>
    !q || `${i.codeLabel ?? ""} ${i.title} ${i.cause ?? ""}`.toLowerCase().includes(q),
  );
  const guideLabel = stove.name.includes("Master Force") ? "Open the full factory manual — troubleshooting is on pages 25–29" : "Open the full factory service guide (PPC90 / TSC90, 8390-017)";
  return (
    <div className="mt-5 rounded-lg border border-[#ffd23f]/40 bg-black/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-[#ffd23f]">Factory troubleshooting — when the groove goes wrong</h4>
        <button type="button" aria-expanded={open} className={btnGhost} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide troubleshooting" : `Show troubleshooting (${items.length})`}
        </button>
      </div>
      {!open && <p className="mt-1 text-sm text-[var(--dim)]">Straight from the factory {stove.name.includes("Master Force") ? "owner's manual" : "service guide"}: every error code and symptom fix for this stove, plus factory support contacts.</p>}
      {open && (
        <div className="mt-3">
          <p className="rounded-lg bg-[#ff2e88]/15 px-3 py-2 text-sm text-[var(--text)]">
            <strong>Safety first, always:</strong> turn the stove off, let it cool completely with no embers, and unplug it before cleaning, clearing a jam, or checking wires. Live-circuit multimeter tests use 115–120 VAC — if you are not comfortable with that, call a certified installer or electrician, or the factory below.
          </p>
          {(stove.factoryName || stove.factoryPhone || stove.factoryEmail || stove.troubleshootingUrl) && (
            <div className="mt-3 rounded-lg bg-[var(--surface-strong)] p-3 text-sm">
              <p className="font-semibold">Factory support{stove.factoryName ? ` — ${stove.factoryName}` : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {stove.factoryPhone && <a href={`tel:${stove.factoryPhone.replace(/[^+\d]/g, "")}`} className={btnGhost}>Call {stove.factoryPhone}</a>}
                {stove.factoryEmail && <a href={`mailto:${stove.factoryEmail}`} className={btnGhost}>Email {stove.factoryEmail}</a>}
                {stove.troubleshootingUrl && stove.troubleshootingUrl.startsWith("http") && (
                  <a href={stove.troubleshootingUrl} target="_blank" rel="noreferrer" className={btnGhost}>{guideLabel}</a>
                )}
                {stove.manualUrl && stove.manualUrl.startsWith("http") && (
                  <a href={stove.manualUrl} target="_blank" rel="noreferrer" className={btnGhost}>Owner's manual</a>
                )}
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Troubleshooting kind">
            <button type="button" aria-pressed={tab === "error_code"} className={tab === "error_code" ? btnPrimary : btnGhost} onClick={() => { setTab("error_code"); setExpandedId(null); }}>
              Error codes ({errors.length})
            </button>
            <button type="button" aria-pressed={tab === "symptom"} className={tab === "symptom" ? btnPrimary : btnGhost} onClick={() => { setTab("symptom"); setExpandedId(null); }}>
              Symptoms &amp; fixes ({symptoms.length})
            </button>
          </div>
          <div className="mt-3">
            <Field label={`Search ${stove.name} troubleshooting`}>
              <input aria-label={`Search troubleshooting for ${stove.name}`} type="search" className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try E2, auger, sooty, blower…" />
            </Field>
          </div>
          {visible.length === 0 && <p className="mt-3 text-sm text-[var(--dim)]">Nothing in the factory guide matches that search, cool cat. Try the code exactly as the stove shows it, or a word like auger, igniter, or blower.</p>}
          <ul className="mt-3 space-y-2">
            {visible.map((item) => {
              const expanded = expandedId === item.id;
              return (
                <li key={item.id} className="rounded-lg bg-[var(--surface-strong)] p-3">
                  <button type="button" aria-expanded={expanded} className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setExpandedId(expanded ? null : item.id)}>
                    <span>
                      {item.codeLabel && <span className="mr-2 rounded-full bg-[#ff2e88] px-2 py-0.5 text-xs font-bold text-white">{item.codeLabel}</span>}
                      <span className="font-semibold">{item.title}</span>
                      {item.cause && <span className="mt-1 block text-sm font-normal text-[var(--dim)]">{item.cause}</span>}
                    </span>
                    <span aria-hidden="true" className="shrink-0 text-lg leading-none text-[#ffd23f]">{expanded ? "−" : "+"}</span>
                  </button>
                  {expanded && (
                    <div className="mt-2 border-t border-[var(--border)] pt-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#00e5c0]">Factory fix</p>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--text)]">{item.fix}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-[var(--dim)]">
            Source: {stove.name.includes("Master Force")
              ? "Master Forge owner's manual for H80XL / H140XL / H3W80XL (Enerco Group Inc., Rev. I) — Error Codes and Troubleshooting, pages 25–29."
              : "PelPro PPC90 / TSC90 Digital Control Pellet Stoves Service Guide 8390-017 (Hearth & Home Technologies) — error code definitions, symptom charts, and factory test procedures. The factory guide lists codes #1, #2, #3, #4, #5, and #7 — there is no #6."}
          </p>
        </div>
      )}
    </div>
  );
}

function DeleteButton({ label, onDelete }: { label: string; onDelete: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (confirming) {
    return (
      <span className="flex gap-1">
        <button type="button" aria-label={`Confirm ${label}`} className="rounded-lg bg-[#ff2e88] px-2.5 py-2 text-sm font-semibold text-white" disabled={busy} onClick={() => { setBusy(true); onDelete().finally(() => { setBusy(false); setConfirming(false); }); }}>Yeah, ditch it</button>
        <button type="button" aria-label={`Cancel ${label}`} className={btnGhost} onClick={() => setConfirming(false)}>Keep groovin&rsquo;</button>
      </span>
    );
  }
  return <button type="button" aria-label={label} className={btnGhost} onClick={() => setConfirming(true)}>Ditch it</button>;
}

function MarkDoneButton({ taskId, today }: { taskId: number; today: string }) {
  const invalidate = useInvalidate();
  const [msg, setMsg] = useState("");
  const m = useMutation({
    mutationFn: () => api.addMaintenanceLog({ taskId, date: today, note: null }),
    onSuccess: () => { invalidate(); setMsg("Right on! Done today is logged."); },
    onError: () => setMsg("Bummer — couldn't save that."),
  });
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="rounded-lg bg-[#00e5c0] px-3 py-2 text-sm font-semibold text-[#1c0b2e]" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving… hold the groove" : "Did it today — groovy!"}</button>
      {msg && <span role="status" className="text-xs text-[var(--dim)]">{msg}</span>}
    </span>
  );
}

function PlannerForm({ initial, today, summary }: { initial: Data["settings"]; today: string; summary: Data["summary"] | undefined }) {
  const invalidate = useInvalidate();
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? "");
  const [safety, setSafety] = useState(String(initial.safetyBags));
  const [windowDays, setWindowDays] = useState(String(initial.burnWindowDays));
  const [lowDays, setLowDays] = useState(String(initial.lowStockDays));
  const [manualRate, setManualRate] = useState(initial.manualBurnRate != null ? String(initial.manualBurnRate) : "");
  const [seasonMonth, setSeasonMonth] = useState(initial.seasonEnd.slice(0, 2) || "04");
  const [seasonDay, setSeasonDay] = useState(initial.seasonEnd.slice(3, 5) || "15");
  const [msg, setMsg] = useState("");
  const save = useMutation({
    mutationFn: () => api.updateSettings({
      targetDate: targetDate || null, safetyBags: Number(safety) || 0,
      burnWindowDays: Number(windowDays), lowStockDays: Number(lowDays),
      manualBurnRate: numOrNull(manualRate),
      seasonEnd: `${seasonMonth.padStart(2, "0")}-${seasonDay.padStart(2, "0")}`,
    }),
    onSuccess: () => { invalidate(); setMsg("Plan saved — right on!"); },
    onError: () => setMsg("Bummer — couldn't save the plan, baby. Try again."),
  });
  return (
    <section aria-label="How many pellets do I need" className="mt-5 rounded-2xl border border-[#ff6b35]/50 bg-[var(--surface)] p-5 shadow-[0_0_24px_rgba(255,107,53,0.2)] backdrop-blur-sm">
      <h2 className="display text-2xl font-semibold text-[#ff6b35]">How many bags to keep the party burnin&rsquo;?</h2>
      <p className="mt-2 text-sm text-[var(--dim)]">
        {summary?.burnRate != null
          ? summary.burnRateSource === "manual"
            ? <>You&rsquo;re groovin&rsquo; at your set rate of {fmtBags(summary.burnRate)} bags a day, baby.</>
            : <>Your burn log says you&rsquo;re shakin&rsquo; it at {fmtBags(summary.burnRate)} bags a day.</>
          : "Log some burns, or lay down a daily rate below, and the forecast will start to boogie."}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Groove through (optional date)">
          <input aria-label="Cover through date" type="date" className={inputCls} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
        <Field label="Spare bags for the stash, just in case">
          <input aria-label="Spare bags to keep" type="number" min="0" step="0.5" className={inputCls} value={safety} onChange={(e) => setSafety(e.target.value)} />
        </Field>
        <Field label="Burn-rate window, baby — how far back we groove">
          <select aria-label="Burn rate window" className={inputCls} value={windowDays} onChange={(e) => setWindowDays(e.target.value)}>
            <option value="7">Last 7 days — a groovy week</option>
            <option value="14">Last 14 days — two groovy weeks</option>
            <option value="30">Last 30 days — a whole month of funk</option>
            <option value="90">Last 90 days — a season of soul</option>
            <option value="0">All logged burns, baby</option>
          </select>
        </Field>
        <Field label="Low-stash boogie warning (days)">
          <input aria-label="Low-stock warning days" type="number" min="0" max="60" className={inputCls} value={lowDays} onChange={(e) => setLowDays(e.target.value)} />
        </Field>
        <Field label="Heating season ends — month (race to spring)">
          <select aria-label="Heating season end month" className={inputCls} value={seasonMonth} onChange={(e) => setSeasonMonth(e.target.value)}>
            {["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m, i) => (
              <option key={m} value={m}>{["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][i]}</option>
            ))}
          </select>
        </Field>
        <Field label="Heating season ends — day of the month">
          <input aria-label="Heating season end day" type="number" min="1" max="31" step="1" className={inputCls} value={seasonDay} onChange={(e) => setSeasonDay(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Daily burn rate — leave blank and let your log do the talkin'">
            <input aria-label="Daily burn rate in bags" type="number" inputMode="decimal" min="0.1" step="0.1" className={inputCls} value={manualRate} onChange={(e) => setManualRate(e.target.value)} placeholder="e.g. 1.5" />
          </Field>
        </div>
        <button type="submit" className={`${btnPrimary} col-span-2`} disabled={save.isPending}>{save.isPending ? "Saving… don't stop the music" : "Save the plan, keep groovin'"}</button>
      </form>
      {msg && <p role="status" className="mt-2 text-sm text-[var(--dim)]">{msg}</p>}
      <p className="mt-3 text-sm text-[var(--dim)]">Today is {fmtDate(today)}, cool cat. The &ldquo;grab&rdquo; number up top uses the date, spare bags, and rate you saved here. Can you dig it?</p>
    </section>
  );
}

function PurchaseForm({ today, onDone }: { today: string; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [date, setDate] = useState(today);
  const [bags, setBags] = useState("");
  const [brand, setBrand] = useState("");
  const [store, setStore] = useState("");
  const [cost, setCost] = useState("");
  const [lbs, setLbs] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");
  const m = useMutation({
    mutationFn: () => api.addPurchase({
      date, bags: Number(bags), brand: brand || null, store: store || null,
      totalCostCents: cost.trim() ? Math.round(Number(cost) * 100) : null,
      lbsPerBag: numOrNull(lbs), notes: notes || null,
    }),
    onSuccess: () => { invalidate(); onDone(); },
    onError: () => setMsg("Bummer — couldn't save the haul, baby. Check the bags and the bread."),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!Number(bags) || Number(bags) <= 0) { setMsg("Hey now — how many bags did you score?"); return; } m.mutate(); }} className="mt-4 space-y-3 rounded-xl border border-[var(--border)] p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date you scored 'em"><input aria-label="Purchase date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Bags scored"><input aria-label="Bags bought" type="number" inputMode="decimal" min="0.5" step="0.5" className={inputCls} value={bags} onChange={(e) => setBags(e.target.value)} required /></Field>
        <Field label="Brand (optional — lay it on me)"><input aria-label="Pellet brand" type="text" className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
        <Field label="Store (optional — where'd you dig it?)"><input aria-label="Store" type="text" className={inputCls} value={store} onChange={(e) => setStore(e.target.value)} /></Field>
        <Field label="Bread spent $ (optional)"><input aria-label="Total cost in dollars" type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Lb per bag (optional)"><input aria-label="Pounds per bag" type="number" inputMode="decimal" min="1" step="1" className={inputCls} value={lbs} onChange={(e) => setLbs(e.target.value)} placeholder="40" /></Field>
      </div>
      <Field label="Notes (optional — spill it)"><input aria-label="Purchase notes" type="text" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <button type="submit" className={btnPrimary} disabled={m.isPending}>{m.isPending ? "Saving… keep dancin'" : "Save the haul, baby"}</button>
      {msg && <p role="status" className="text-sm text-[var(--dim)]">{msg}</p>}
    </form>
  );
}

function PurchaseEditor({ purchase, onDone }: { purchase: Purchase; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [date, setDate] = useState(purchase.date);
  const [bags, setBags] = useState(String(purchase.bags));
  const [brand, setBrand] = useState(purchase.brand ?? "");
  const [store, setStore] = useState(purchase.store ?? "");
  const [cost, setCost] = useState(purchase.totalCostCents != null ? (purchase.totalCostCents / 100).toFixed(2) : "");
  const [lbs, setLbs] = useState(purchase.lbsPerBag != null ? String(purchase.lbsPerBag) : "");
  const [notes, setNotes] = useState(purchase.notes ?? "");
  const m = useMutation({
    mutationFn: () => api.updatePurchase({
      id: purchase.id, date, bags: Number(bags), brand: brand || null, store: store || null,
      totalCostCents: cost.trim() ? Math.round(Number(cost) * 100) : null, lbsPerBag: numOrNull(lbs), notes: notes || null,
    }),
    onSuccess: () => { invalidate(); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date you scored 'em"><input aria-label="Edit purchase date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Bags scored"><input aria-label="Edit bags bought" type="number" min="0.5" step="0.5" className={inputCls} value={bags} onChange={(e) => setBags(e.target.value)} required /></Field>
        <Field label="Brand, baby"><input aria-label="Edit pellet brand" type="text" className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
        <Field label="Store, cool cat"><input aria-label="Edit store" type="text" className={inputCls} value={store} onChange={(e) => setStore(e.target.value)} /></Field>
        <Field label="Bread spent $"><input aria-label="Edit total cost in dollars" type="number" min="0" step="0.01" className={inputCls} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Lb per bag"><input aria-label="Edit pounds per bag" type="number" min="1" className={inputCls} value={lbs} onChange={(e) => setLbs(e.target.value)} /></Field>
      </div>
      <Field label="Notes — spill it"><input aria-label="Edit purchase notes" type="text" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex gap-2"><button type="submit" className={btnPrimary} disabled={m.isPending}>Save the remix</button><button type="button" className={btnGhost} onClick={onDone}>Never mind</button></div>
    </form>
  );
}

function BurnEditor({ burn, stoves, onDone }: { burn: Burn; stoves: Stove[]; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [date, setDate] = useState(burn.date);
  const [bags, setBags] = useState(String(burn.bags));
  const [stoveId, setStoveId] = useState(burn.stoveId != null ? String(burn.stoveId) : "");
  const [note, setNote] = useState(burn.note ?? "");
  const m = useMutation({
    mutationFn: () => api.updateBurn({ id: burn.id, date, bags: Number(bags), stoveId: stoveId ? Number(stoveId) : null, note: note || null }),
    onSuccess: () => { invalidate(); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Night of the boogie"><input aria-label="Edit burn date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Bags burned, baby"><input aria-label="Edit bags burned" type="number" min="0" step="0.5" className={inputCls} value={bags} onChange={(e) => setBags(e.target.value)} required /></Field>
      </div>
      <Field label="Groove machine (stove)"><select aria-label="Edit burn stove" className={inputCls} value={stoveId} onChange={(e) => setStoveId(e.target.value)}><option value="">No stove picked — free bird</option>{stoves.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Note — lay it on me"><input aria-label="Edit burn note" type="text" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2"><button type="submit" className={btnPrimary} disabled={m.isPending}>Save the remix</button><button type="button" className={btnGhost} onClick={onDone}>Never mind</button></div>
    </form>
  );
}

function CountForm({ today, onDone }: { today: string; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [counted, setCounted] = useState("");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const m = useMutation({
    mutationFn: () => api.setCount({ date, countedBags: Number(counted), reason: reason || null }),
    onSuccess: (r) => { invalidate(); setMsg(r.delta === 0 ? "Right on — the count matches the tracked stash. No correction needed, the groove is tight." : `Count saved, groovy! Correction of ${r.delta > 0 ? "+" : ""}${fmtBags(r.delta)} bags recorded.`); },
    onError: () => setMsg("Bummer — couldn't save the count, baby. Try again."),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (counted.trim() === "") { setMsg("Hey now — how many bags did you count, for real?"); return; } m.mutate(); }} className="mt-4 space-y-3 rounded-xl border border-[var(--border)] p-4">
      <p className="text-sm text-[var(--dim)]">Count the bags you&rsquo;ve really got, cool cat. The difference from the tracked total gets saved as a correction, so your hauls and burns stay untouched — solid, man.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bags counted, for real"><input aria-label="Bags counted on hand" type="number" inputMode="decimal" min="0" step="0.5" className={inputCls} value={counted} onChange={(e) => setCounted(e.target.value)} required /></Field>
        <Field label="Date of the count"><input aria-label="Count date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      </div>
      <Field label="Why the change? (optional)"><input aria-label="Count reason" type="text" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Physical count, baby" /></Field>
      <div className="flex gap-2"><button type="submit" className={btnPrimary} disabled={m.isPending}>{m.isPending ? "Saving… hold on" : "Set the real count, baby"}</button><button type="button" className={btnGhost} onClick={onDone}>Cool it</button></div>
      {msg && <p role="status" className="text-sm text-[var(--dim)]">{msg}</p>}
    </form>
  );
}

function StoveForm({ onDone }: { onDone: () => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [details, setDetails] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const m = useMutation({
    mutationFn: () => api.addStove({ name, location: location || null, manualUrl: manualUrl || null, details: details || null }),
    onSuccess: () => { invalidate(); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="mt-4 space-y-3 rounded-xl border border-[var(--border)] p-4">
      <Field label="Stove name, baby"><input aria-label="Stove name" type="text" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Living room groove machine" required /></Field>
      <Field label="Details (optional — spill it)"><input aria-label="Stove details" type="text" className={inputCls} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Cast iron, 90-pound hopper, pure funk" /></Field>
      <Field label="Location (optional — where's it shakin'?)"><input aria-label="Stove location" type="text" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      <Field label="Maintenance manual link (optional)"><input aria-label="Maintenance manual link" type="url" className={inputCls} value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://…" /></Field>
      <button type="submit" className={btnPrimary} disabled={m.isPending}>{m.isPending ? "Saving… keep dancin'" : "Add the stove, baby"}</button>
    </form>
  );
}

function StoveEditor({ stove, onDone }: { stove: Stove; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState(stove.name);
  const [location, setLocation] = useState(stove.location ?? "");
  const [details, setDetails] = useState(stove.details ?? "");
  const [manualUrl, setManualUrl] = useState(stove.manualUrl ?? "");
  const m = useMutation({
    mutationFn: () => api.updateStove({ id: stove.id, name, location: location || null, manualUrl: manualUrl || null, details: details || null }),
    onSuccess: () => { invalidate(); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-3">
      <Field label="Stove name, baby"><input aria-label="Edit stove name" type="text" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Details — spill it"><input aria-label="Edit stove details" type="text" className={inputCls} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Cast iron, 90-pound hopper, pure funk" /></Field>
      <Field label="Location — where's it shakin'?"><input aria-label="Edit stove location" type="text" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      <Field label="Maintenance manual link — swap it anytime, cool cat"><input aria-label="Edit maintenance manual link" type="url" className={inputCls} value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://…" /></Field>
      <p className="text-xs text-[var(--dim)]">If the model or manual changes, paste the right manual link here, baby.</p>
      <div className="flex gap-2"><button type="submit" className={btnPrimary} disabled={m.isPending}>Save the stove, baby</button><button type="button" className={btnGhost} onClick={onDone}>Never mind</button></div>
    </form>
  );
}

function TaskForm({ stoves, today, onDone }: { stoves: Stove[]; today: string; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [stoveId, setStoveId] = useState(stoves[0] ? String(stoves[0].id) : "");
  const [preset, setPreset] = useState(0);
  const [title, setTitle] = useState(MAINT_PRESETS[0]?.title ?? "");
  const [interval, setInterval] = useState(MAINT_PRESETS[0]?.interval != null ? String(MAINT_PRESETS[0].interval) : "");
  const [notes, setNotes] = useState(MAINT_PRESETS[0]?.notes ?? "");
  const [logToday, setLogToday] = useState(false);
  const m = useMutation({
    mutationFn: async () => {
      const created = await api.addMaintenanceTask({ stoveId: Number(stoveId), title, intervalDays: numOrNull(interval) != null ? Math.round(numOrNull(interval) ?? 0) : null, notes: notes || null });
      if (logToday) await api.addMaintenanceLog({ taskId: created.id, date: today, note: null });
      return created;
    },
    onSuccess: () => { invalidate(); onDone(); },
  });
  function pickPreset(i: number) {
    setPreset(i);
    const p = MAINT_PRESETS[i];
    if (p) { setTitle(p.title); setInterval(p.interval != null ? String(p.interval) : ""); setNotes(p.notes); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!stoveId || !title.trim()) return; m.mutate(); }} className="mt-4 space-y-3 rounded-xl border border-[var(--border)] p-4">
      <Field label="Which stove's gettin' the love?"><select aria-label="Maintenance task stove" className={inputCls} value={stoveId} onChange={(e) => setStoveId(e.target.value)}>{stoves.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Start from a far-out favorite">
        <select aria-label="Maintenance preset" className={inputCls} value={preset} onChange={(e) => pickPreset(Number(e.target.value))}>
          {MAINT_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        </select>
      </Field>
      <Field label="The groove (task)"><input aria-label="Maintenance task title" type="text" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="Repeat every (days) — leave blank for no due date, free bird"><input aria-label="Repeat every days" type="number" min="1" max="3650" className={inputCls} value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="e.g. 3, 30, or 365, baby" /></Field>
      <Field label="Notes (optional — lay it on me)"><input aria-label="Maintenance task notes" type="text" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={logToday} onChange={(e) => setLogToday(e.target.checked)} /> Mark it done today — I already boogied</label>
      <button type="submit" className={btnPrimary} disabled={m.isPending}>{m.isPending ? "Saving… keep groovin'" : "Lay down the groove, baby"}</button>
    </form>
  );
}

function TaskEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(task.title);
  const [interval, setInterval] = useState(task.intervalDays != null ? String(task.intervalDays) : "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const m = useMutation({
    mutationFn: () => api.updateMaintenanceTask({ id: task.id, title, intervalDays: numOrNull(interval) != null ? Math.round(numOrNull(interval) ?? 0) : null, notes: notes || null }),
    onSuccess: () => { invalidate(); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-3">
      <Field label="The groove (task)"><input aria-label="Edit maintenance task title" type="text" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="Repeat every (days) — blank means no due date, free bird"><input aria-label="Edit repeat every days" type="number" min="1" max="3650" className={inputCls} value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="Blank = no due date, baby" /></Field>
      <Field label="Notes — lay it on me"><input aria-label="Edit maintenance task notes" type="text" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex gap-2"><button type="submit" className={btnPrimary} disabled={m.isPending}>Save the groove</button><button type="button" className={btnGhost} onClick={onDone}>Never mind</button></div>
    </form>
  );
}

function MaintLogEditor({ log, onDone }: { log: MaintLog; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [date, setDate] = useState(log.date);
  const [note, setNote] = useState(log.note ?? "");
  const m = useMutation({
    mutationFn: () => api.updateMaintenanceLog({ id: log.id, date, note: note || null }),
    onSuccess: () => { invalidate(); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date you boogied"><input aria-label="Edit maintenance date done" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Note — lay it on me"><input aria-label="Edit maintenance note" type="text" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="flex gap-2"><button type="submit" className={btnPrimary} disabled={m.isPending}>Save the date, baby</button><button type="button" className={btnGhost} onClick={onDone}>Never mind</button></div>
    </form>
  );
}
