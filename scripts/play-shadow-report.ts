/**
 * Read-only comparison of the two Play Store version scrapers: the Puppeteer
 * cron (source of truth) and the google-play-scraper shadow (gps). Reads
 * wlplayversionobservations only and prints a Markdown report with the
 * sunset gates, ready to paste into the tracking PR.
 *
 * Run from the API folder (needs .env with MONGO_URI):
 *   npx tsx scripts/play-shadow-report.ts                 # last 14 days
 *   npx tsx scripts/play-shadow-report.ts --days 3
 *   npx tsx scripts/play-shadow-report.ts > /tmp/shadow.md && \
 *     gh pr comment <pr> --body-file /tmp/shadow.md
 */
import "dotenv/config";

import { MongoClient } from "mongodb";

import { Collections, IPlayVersionObservation } from "../src/types/database";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

// a gps check this close to a Puppeteer check of the same app counts as a pair
const PAIR_WINDOW_MS = 45 * 60 * 1000;

const GATES = {
  days: 14,
  rolloutApps: 20, // apps both sources saw reach the target (a real rollout)
  pairs: 200,
  agreement: 0.99,
  throttleFreeDays: 7,
};

type Row = Pick<
  IPlayVersionObservation,
  | "runId"
  | "source"
  | "bundleId"
  | "version"
  | "outcome"
  | "error"
  | "targetVersion"
  | "control"
  | "durationMs"
  | "checkedAt"
>;

const ist = (d: Date) =>
  new Date(d.getTime() + 330 * 60 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
const pct = (n: number, d: number) =>
  d ? `${((100 * n) / d).toFixed(1)}%` : "-";
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const hours = (ms: number) =>
  Number.isNaN(ms) ? "-" : `${(ms / 3600000).toFixed(1)}h`;

/** numeric version parts, or null for things like "Varies with device" */
const parse = (v: string | null) =>
  v && /^\d+(\.\d+)*$/.test(v) ? v.split(".").map(Number) : null;
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
};

const main = async () => {
  const days = Number(arg("days") ?? GATES.days);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const uri = process.env.MONGO_URI || "";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(uri.split("?")[0].split("/").pop());
  const rows = (await db
    .collection<IPlayVersionObservation>(Collections.PLAY_VERSION_OBSERVATIONS)
    .find(
      { checkedAt: { $gte: since } },
      {
        projection: {
          _id: 0,
          runId: 1,
          source: 1,
          bundleId: 1,
          version: 1,
          outcome: 1,
          error: 1,
          targetVersion: 1,
          control: 1,
          durationMs: 1,
          checkedAt: 1,
        },
      },
    )
    .sort({ checkedAt: 1 })
    .toArray()) as Row[];
  await client.close();

  const out: string[] = [];
  const p = (s = "") => out.push(s);
  const pup = rows.filter((r) => r.source === "puppeteer");
  const gps = rows.filter((r) => r.source === "gps");

  p(`## Play Store shadow report (last ${days} days)`);
  p();
  if (!rows.length) {
    p("No observations yet.");
    console.log(out.join("\n"));
    return;
  }
  const first = rows[0].checkedAt;
  const last = rows[rows.length - 1].checkedAt;
  const coveredDays = (last.getTime() - first.getTime()) / (24 * 3600 * 1000);
  p(`Data: ${ist(first)} → ${ist(last)} IST (${coveredDays.toFixed(1)} days)`);
  p();

  // --- volume and outcomes per source
  p("### Checks per source");
  p();
  p(
    "| | runs | checks | ok | not found | no version | error | throttled | success | median check |",
  );
  p("|---|---|---|---|---|---|---|---|---|---|");
  const success: Record<string, number> = {};
  for (const [name, rs] of [
    ["puppeteer", pup],
    ["gps", gps],
  ] as const) {
    const c = (o: Row["outcome"]) => rs.filter((r) => r.outcome === o).length;
    const answered = c("ok") + c("not_found");
    const attempted = rs.length - c("throttled");
    success[name] = attempted ? answered / attempted : 0;
    const median = quantile(
      rs.map((r) => r.durationMs),
      0.5,
    );
    p(
      `| ${name} | ${new Set(rs.map((r) => r.runId)).size} | ${rs.length} | ${c("ok")} | ${c("not_found")} | ${c("no_version")} | ${c("error")} | ${c("throttled")} | ${pct(answered, attempted)} | ${Number.isNaN(median) ? "-" : `${(median / 1000).toFixed(1)}s`} |`,
    );
  }
  p();
  p("_success = ok or not found, out of checks that weren't throttled_");
  p();

  // --- pair each Puppeteer check with the nearest gps check of the same app
  const gpsByBundle = new Map<string, Row[]>();
  for (const r of gps) {
    if (!gpsByBundle.has(r.bundleId)) gpsByBundle.set(r.bundleId, []);
    gpsByBundle.get(r.bundleId)!.push(r);
  }
  const kinds: Record<string, number> = {};
  const examples: string[] = [];
  let comparable = 0;
  let agree = 0;
  for (const a of pup) {
    let b: Row | undefined;
    for (const g of gpsByBundle.get(a.bundleId) ?? []) {
      const d = Math.abs(g.checkedAt.getTime() - a.checkedAt.getTime());
      if (
        d <= PAIR_WINDOW_MS &&
        (!b || d < Math.abs(b.checkedAt.getTime() - a.checkedAt.getTime()))
      )
        b = g;
    }
    if (!b) {
      kinds["no gps check nearby"] = (kinds["no gps check nearby"] ?? 0) + 1;
      continue;
    }
    const answered = (r: Row) =>
      r.outcome === "ok" || r.outcome === "not_found";
    let kind: string;
    if (!answered(a) && !answered(b)) kind = "both failed";
    else if (!answered(b)) kind = `gps ${b.outcome}`;
    else if (!answered(a)) kind = `puppeteer ${a.outcome}`;
    else {
      comparable++;
      if (a.outcome !== b.outcome) kind = "found vs not found";
      else if (a.outcome === "not_found" || a.version === b.version)
        kind = "agree";
      else {
        const pa = parse(a.version);
        const pb = parse(b.version);
        if (!pb) kind = "gps non-numeric version";
        else if (!pa) kind = "puppeteer non-numeric version";
        else kind = compare(pb, pa) < 0 ? "gps older" : "gps newer";
      }
      if (kind === "agree") agree++;
    }
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (kind !== "agree" && kind !== "both failed" && examples.length < 20)
      examples.push(
        `| ${ist(a.checkedAt)} | ${a.bundleId} | ${a.version ?? a.outcome} | ${b.version ?? b.outcome}${b.error ? ` (${b.error.slice(0, 60)})` : ""} | ${kind} |`,
      );
  }
  p("### Agreement (Puppeteer check vs nearest gps check within 45 min)");
  p();
  p(
    `Comparable pairs (both answered): **${comparable}**, agree: **${agree} (${pct(agree, comparable)})**`,
  );
  p();
  p("| result | pairs |");
  p("|---|---|");
  for (const [k, n] of Object.entries(kinds).sort((x, y) => y[1] - x[1]))
    p(`| ${k} | ${n} |`);
  p();
  if (examples.length) {
    p("<details><summary>Disagreements (first 20)</summary>");
    p();
    p("| when (IST) | bundle | puppeteer | gps | kind |");
    p("|---|---|---|---|---|");
    examples.forEach((e) => p(e));
    p();
    p("</details>");
    p();
  }

  // --- how much earlier gps sees an app reach the target
  const firstSeen = (rs: Row[]) => {
    const m = new Map<string, Date>();
    for (const r of rs)
      if (r.outcome === "ok" && r.version && r.version === r.targetVersion) {
        const key = `${r.bundleId}@${r.version}`;
        if (!m.has(key)) m.set(key, r.checkedAt);
      }
    return m;
  };
  const pupSeen = firstSeen(pup);
  const gpsSeen = firstSeen(gps.filter((r) => !r.control));
  const leads: number[] = [];
  for (const [k, t] of pupSeen) {
    const g = gpsSeen.get(k);
    if (g) leads.push(t.getTime() - g.getTime());
  }
  const gpsOnly = [...gpsSeen.keys()].filter((k) => !pupSeen.has(k)).length;
  const pupOnly = [...pupSeen.keys()].filter((k) => !gpsSeen.has(k)).length;
  p("### Detection lead (apps reaching the target version)");
  p();
  p(
    `Seen by both: **${leads.length}** · gps only: ${gpsOnly} · Puppeteer only: ${pupOnly}`,
  );
  p();
  p(
    `gps ahead of Puppeteer by: median ${hours(quantile(leads, 0.5))}, p90 ${hours(quantile(leads, 0.9))}, worst ${hours(leads.length ? Math.min(...leads) : NaN)} (negative = gps later)`,
  );
  p();

  // --- gps flapping: reported the target, later reported something else
  const flaps: string[] = [];
  for (const [bundle, rs] of gpsByBundle) {
    let sawTarget: Row | undefined;
    for (const r of rs) {
      if (r.outcome !== "ok") continue;
      if (r.version === r.targetVersion) sawTarget = r;
      else if (sawTarget && sawTarget.targetVersion === r.targetVersion) {
        flaps.push(
          `${bundle}: ${sawTarget.version} at ${ist(sawTarget.checkedAt)}, then ${r.version} at ${ist(r.checkedAt)}`,
        );
        break;
      }
    }
  }
  const controls = gps.filter((r) => r.control && r.outcome !== "throttled");
  const controlsOk = controls.filter(
    (r) => r.outcome === "ok" && r.version === r.targetVersion,
  ).length;
  p("### gps consistency");
  p();
  p(`Flapping apps (target, then an older version): **${flaps.length}**`);
  flaps.slice(0, 10).forEach((f) => p(`- ${f}`));
  p();
  p(
    `Control apps read as the target: **${controlsOk}/${controls.length} (${pct(controlsOk, controls.length)})**`,
  );
  p();

  // --- throttling per IST day
  const throttled = gps.filter((r) => r.outcome === "throttled");
  const byDay = new Map<
    string,
    { checks: number; throttled: number; errors: number }
  >();
  for (const r of gps) {
    const day = ist(r.checkedAt).slice(0, 10);
    const d = byDay.get(day) ?? { checks: 0, throttled: 0, errors: 0 };
    d.checks++;
    if (r.outcome === "throttled") d.throttled++;
    if (r.outcome === "error") d.errors++;
    byDay.set(day, d);
  }
  p("### gps per day (IST)");
  p();
  p("| day | checks | errors | throttled |");
  p("|---|---|---|---|");
  for (const [day, d] of byDay)
    p(`| ${day} | ${d.checks} | ${d.errors} | ${d.throttled} |`);
  p();

  // --- gates
  const throttleWindow = Date.now() - GATES.throttleFreeDays * 24 * 3600 * 1000;
  const recentThrottles = throttled.filter(
    (r) => r.checkedAt.getTime() >= throttleWindow,
  ).length;
  const gates: [string, boolean, string][] = [
    [
      `≥ ${GATES.days} days of data`,
      coveredDays >= GATES.days,
      `${coveredDays.toFixed(1)} days`,
    ],
    [
      `≥ ${GATES.rolloutApps} apps seen reaching the target by both (a real rollout)`,
      leads.length >= GATES.rolloutApps,
      `${leads.length}`,
    ],
    [
      `≥ ${GATES.pairs} comparable pairs`,
      comparable >= GATES.pairs,
      `${comparable}`,
    ],
    [
      `agreement ≥ ${GATES.agreement * 100}%`,
      comparable > 0 && agree / comparable >= GATES.agreement,
      pct(agree, comparable),
    ],
    [
      "gps success rate ≥ Puppeteer's",
      pup.length > 0 && gps.length > 0 && success.gps >= success.puppeteer,
      `${pct(success.gps, 1)} vs ${pct(success.puppeteer, 1)}`,
    ],
    [
      `no throttling in the last ${GATES.throttleFreeDays} days`,
      recentThrottles === 0,
      `${recentThrottles}`,
    ],
    ["no flapping", flaps.length === 0, `${flaps.length}`],
    [
      "control apps 100% correct",
      controls.length > 0 && controlsOk === controls.length,
      pct(controlsOk, controls.length),
    ],
  ];
  p("### Sunset gates");
  p();
  p("| gate | | value |");
  p("|---|---|---|");
  for (const [name, ok, value] of gates)
    p(`| ${name} | ${ok ? "✅" : "❌"} | ${value} |`);
  p();
  const allPass = gates.every(([, ok]) => ok);
  p(
    allPass
      ? "**All gates pass: gps can take over as the writer (phase 2). Every disagreement above still needs an explanation.**"
      : "**Not ready: keep gps in shadow.**",
  );

  console.log(out.join("\n"));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
