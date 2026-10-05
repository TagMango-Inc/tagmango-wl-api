// Read-only: per-command and per-step timings recorded in tasks[].perf by the
// worker. Same windows as measure-tat.js so the two reports line up.
//   node scripts/perf/measure-commands.js --since 2026-09-30 --out perf/commands-before.json
require("dotenv").config();
const fs = require("fs");
const { MongoClient } = require("mongodb");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const until = new Date(arg("until", new Date().toISOString()));
const since = new Date(arg("since", new Date(until - 7 * 864e5).toISOString()));
const out = arg("out");

const TASKS = [
  "git fetch root", "copy root project", "generate assets", "screenshots",
  "metadata files", "pre-deploy + bundle script", "create app on platform",
  "fastlane build", "fastlane upload", "cleanup",
];

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const sec = (ms) => +(ms / 1000).toFixed(1);
const stats = (xs) => ({ n: xs.length, p50s: sec(pct(xs, 50)), p90s: sec(pct(xs, 90)), maxs: sec(pct(xs, 100)) });

// bundle ids, host ids and version numbers vary per app; strip them so the
// same command groups together
const normalise = (label) =>
  label
    .replace(/deployments\/[\w.]+/g, "deployments/<bundle>")
    .replace(/\b[0-9a-f]{24}\b/g, "<id>")
    .replace(/v\/[\d.]+/g, "v/<version>")
    .replace(/group\.[\w.]+/g, "group.<bundle>")
    .replace(/-a [\w.]+/g, "-a <bundle>");

(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred" });
  const docs = await client
    .db()
    .collection("wldeployments")
    .find(
      { updatedAt: { $gte: since, $lt: until }, "tasks.perf": { $exists: true } },
      { projection: { platform: 1, isFirstDeployment: 1, status: 1, "tasks.perf": 1 } },
    )
    .toArray();
  await client.close();

  const groups = {};
  for (const d of docs) {
    const key = `${d.platform}.${d.isFirstDeployment ? "first" : "subsequent"}`;
    const g = (groups[key] ??= { deployments: 0, commands: {}, steps: {}, diskUsedGb: [] });
    g.deployments++;
    d.tasks.forEach((t, i) => {
      if (!t.perf) return;
      for (const c of t.perf.commands) {
        if (!c.ok) continue;
        const k = `${TASKS[i]} :: ${normalise(c.label)}`;
        (g.commands[k] ??= []).push(c.ms);
      }
      for (const s of t.perf.steps) {
        const k = `${TASKS[i]} :: ${s.source} :: ${s.name}`;
        (g.steps[k] ??= []).push(s.ms);
      }
      const { start, end } = t.perf.diskFreeGb ?? {};
      if (start != null && end != null) g.diskUsedGb.push({ task: TASKS[i], gb: +(start - end).toFixed(1) });
    });
  }

  const report = { since, until, generatedAt: new Date(), groups: {} };
  for (const [key, g] of Object.entries(groups)) {
    const rank = (m) =>
      Object.fromEntries(
        Object.entries(m)
          .map(([k, xs]) => [k, stats(xs)])
          .sort((a, b) => b[1].p50s * b[1].n - a[1].p50s * a[1].n),
      );
    const diskByTask = {};
    for (const { task, gb } of g.diskUsedGb) (diskByTask[task] ??= []).push(gb);
    report.groups[key] = {
      deployments: g.deployments,
      commands: rank(g.commands),
      steps: rank(g.steps),
      // positive = the task consumed disk
      diskUsedGbByTask: Object.fromEntries(
        Object.entries(diskByTask).map(([t, xs]) => [t, { p50: pct(xs, 50), max: pct(xs, 100) }]),
      ),
    };
  }

  const json = JSON.stringify(report, null, 2);
  if (out) fs.writeFileSync(out, json);
  console.log(json);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
