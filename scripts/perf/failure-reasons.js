// Read-only: most common last log line of the failing task, per platform
//   node scripts/perf/failure-reasons.js --since 2026-08-29
require("dotenv").config();
const { MongoClient } = require("mongodb");
const i = process.argv.indexOf("--since");
const since = new Date(i > -1 ? process.argv[i + 1] : Date.now() - 30 * 864e5);
(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred" });
  const rows = await c.db().collection("wldeployments").aggregate([
    { $match: { createdAt: { $gte: since }, status: "failed" } },
    { $project: { platform: 1, isFirstDeployment: 1, t: { $filter: { input: "$tasks", cond: { $eq: ["$$this.status", "failed"] } } } } },
    { $unwind: "$t" },
    { $project: { platform: 1, first: "$isFirstDeployment", name: { $substrCP: ["$t.name", 0, 30] }, dur: "$t.duration",
        msg: { $reduce: { input: { $slice: ["$t.logs.message", -6] }, initialValue: "", in: { $concat: ["$$value", " | ", { $substrCP: [{ $ifNull: ["$$this", ""] }, 0, 220] }] } } } } },
  ]).toArray();
  await c.close();
  const norm = (s) => s.replace(/com\.[\w.]+/g, "<bundle>").replace(/[0-9a-f]{24}/g, "<id>").replace(/\d+/g, "#").replace(/\s+/g, " ").slice(-380);
  const groups = {};
  for (const r of rows) {
    const k = `${r.platform}|${r.first ? "first" : "sub"}|${r.name}|${norm(r.msg)}`;
    (groups[k] ||= { n: 0, dur: 0 }).n++;
    groups[k].dur += r.dur || 0;
  }
  Object.entries(groups).sort((a, b) => b[1].n - a[1].n).slice(0, 40)
    .forEach(([k, v]) => console.log(`${v.n}\t${(v.dur / v.n / 1000).toFixed(0)}s\t${k}\n`));
})();
