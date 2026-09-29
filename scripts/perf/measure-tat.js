// Read-only TAT report for WL deployments. Run the same command before and
// after a change so the numbers are comparable:
//   node scripts/perf/measure-tat.js --since 2026-06-30 --until 2026-09-28 --out perf/before.json
require("dotenv").config();
const fs = require("fs");
const { MongoClient } = require("mongodb");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const until = new Date(arg("until", new Date().toISOString()));
const since = new Date(arg("since", new Date(until - 90 * 864e5).toISOString()));
const out = arg("out");

// task names embed the bundle id, so tasks are identified by position
const TASKS = [
  "git fetch root",
  "copy root project",
  "generate assets",
  "screenshots",
  "metadata files",
  "pre-deploy + bundle script",
  "create app on platform",
  "fastlane build",
  "fastlane upload",
  "cleanup",
];

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const min = (ms) => (ms == null ? null : +(ms / 60000).toFixed(1));
const stats = (xs) => ({
  n: xs.length,
  mean: min(xs.reduce((a, b) => a + b, 0) / (xs.length || 1)),
  p50: min(pct(xs, 50)),
  p75: min(pct(xs, 75)),
  p90: min(pct(xs, 90)),
  max: min(pct(xs, 100)),
});

(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URI, {
    readPreference: "secondaryPreferred",
  });
  const docs = await client
    .db()
    .collection("wldeployments")
    .find(
      { createdAt: { $gte: since, $lt: until }, status: { $in: ["success", "failed"] } },
      {
        projection: {
          platform: 1, status: 1, isFirstDeployment: 1, redeploymentId: 1,
          createdAt: 1, updatedAt: 1, versionName: 1,
          "tasks.status": 1, "tasks.duration": 1,
        },
      },
    )
    .toArray();
  await client.close();

  const report = { since, until, generatedAt: new Date(), groups: {} };
  for (const platform of ["android", "ios"]) {
    for (const first of [true, false]) {
      const key = `${platform}.${first ? "first" : "subsequent"}`;
      const group = docs.filter(
        (d) => d.platform === platform && !!d.isFirstDeployment === first,
      );
      const ok = group.filter((d) => d.status === "success");
      const failed = group.filter((d) => d.status === "failed");
      const work = (d) => d.tasks.reduce((a, t) => a + (t.duration || 0), 0);

      const failedAt = {};
      for (const d of failed) {
        const i = d.tasks.findIndex((t) => t.status === "failed");
        const name = TASKS[i] ?? `unknown(${i})`;
        failedAt[name] = (failedAt[name] || 0) + 1;
      }

      report.groups[key] = {
        success: ok.length,
        failed: failed.length,
        failureRate: +(failed.length / (group.length || 1)).toFixed(3),
        // sum of task durations = machine time spent building one app
        buildTimeMin: stats(ok.map(work)),
        // wall time including queue wait (large for bulk redeployments)
        createdToDoneMin: stats(ok.map((d) => d.updatedAt - d.createdAt)),
        // machine time burnt on deployments that ended up failing
        wastedOnFailuresHours: +(failed.map(work).reduce((a, b) => a + b, 0) / 36e5).toFixed(1),
        failedAtTask: failedAt,
        perTaskMin: Object.fromEntries(
          TASKS.map((name, i) => [
            name,
            stats(ok.map((d) => d.tasks[i]?.duration).filter((x) => x > 0)),
          ]),
        ),
      };
    }
  }

  const json = JSON.stringify(report, null, 2);
  if (out) fs.writeFileSync(out, json);
  console.log(json);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
