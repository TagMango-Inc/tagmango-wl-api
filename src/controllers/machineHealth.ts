import { createFactory } from "hono/factory";

import Mongo from "../database";
import { androidBuildQueue, buildQueue, redeploymentQueue } from "../job/config";
import { PROCESS_GROUPS } from "../machineHealth/config";
import { failureReason } from "../machineHealth/failureReasons";
import { PLAN_MARKERS } from "../machineHealth/markers";
import { Response } from "../utils/statuscode";

const factory = createFactory();

/** both build lanes summed, so the dashboard keeps one build queue */
const buildJobCounts = async () => {
  const lanes = await Promise.all(
    [buildQueue, androidBuildQueue].map((q) =>
      q.getJobCounts("waiting", "active", "delayed", "paused"),
    ),
  );
  const total: Record<string, number> = {};
  for (const counts of lanes) {
    for (const [state, n] of Object.entries(counts)) total[state] = (total[state] ?? 0) + n;
  }
  return total;
};

/** range → how far back, and the bucket each chart point averages over */
const RANGES = {
  "6h": { ms: 6 * 3600e3, bucketMin: 1 },
  "24h": { ms: 24 * 3600e3, bucketMin: 5 },
  "7d": { ms: 7 * 86400e3, bucketMin: 30 },
  "30d": { ms: 30 * 86400e3, bucketMin: 120 },
} as const;
type Range = keyof typeof RANGES;

const GROUPS = [...Object.keys(PROCESS_GROUPS), "other"];

// alert thresholds; the worker refuses jobs below WL_MIN_FREE_DISK_GB (40)
const DISK_CRITICAL_GB = 60;
const DISK_WARNING_GB = 120;
const SWAP_WARNING_GB = 24;
const STALE_AFTER_MS = 3 * 60_000;

type Alert = { level: "critical" | "warning"; title: string; detail: string };

const avg = (field: string) => ({ $avg: field });

const readSeries = (since: Date, bucketMin: number) =>
  Mongo.machine_health
    .aggregate([
      { $match: { kind: "fast", t: { $gte: since } } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$t", unit: "minute", binSize: bucketMin } },
          load1: avg({ $arrayElemAt: ["$fast.load", 0] } as any),
          busyCores: avg({
            $multiply: [{ $divide: [{ $subtract: [100, "$fast.cpu.idle"] }, 100] }, "$fast.cores"],
          } as any),
          cores: { $max: "$fast.cores" },
          memUsedGb: avg("$fast.mem.usedGb"),
          memTotalGb: { $max: "$fast.mem.totalGb" },
          swapGb: avg("$fast.swapGb"),
          pressureMax: { $max: "$fast.pressure" },
          // 0 means the disk couldn't be read, not a full disk
          freeGb: { $min: { $cond: [{ $gt: ["$fast.disk.freeGb", 0] }, "$fast.disk.freeGb", null] } },
          ioMbps: avg("$fast.io.mbps"),
          ioMbpsMax: { $max: "$fast.io.mbps" },
          pageouts: { $sum: "$fast.pageouts" },
          ...Object.fromEntries(GROUPS.map((g) => [`g_${g}`, avg(`$fast.groups.${g}`)])),
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

const readBuilds = async (since: Date) => {
  const rows = await Mongo.deployment
    .aggregate([
      // by activity, not queue time: redeployments can sit queued for days
      { $match: { $or: [{ updatedAt: { $gte: since } }, { createdAt: { $gte: since } }] } },
      {
        $project: {
          host: 1,
          platform: 1,
          status: 1,
          isFirstDeployment: 1,
          createdAt: 1,
          updatedAt: 1,
          durationMs: { $sum: "$tasks.duration" },
          failed: {
            $first: { $filter: { input: "$tasks", cond: { $eq: ["$$this.status", "failed"] } } },
          },
        },
      },
      {
        $project: {
          host: 1,
          platform: 1,
          status: 1,
          isFirstDeployment: 1,
          createdAt: 1,
          updatedAt: 1,
          durationMs: 1,
          failedTask: "$failed.name",
          // only the tail of the failing task's log is read: enough to tell the cause
          logTail: {
            $reduce: {
              input: { $slice: [{ $ifNull: ["$failed.logs.message", []] }, -6] },
              initialValue: "",
              in: { $concat: ["$$value", " | ", { $substrCP: [{ $ifNull: ["$$this", ""] }, 0, 300] }] },
            },
          },
        },
      },
    ])
    .toArray();

  const hostIds = [...new Map(rows.map((r) => [String(r.host), r.host])).values()];
  const hosts = await Mongo.customhost
    .find({ _id: { $in: hostIds } }, { projection: { appName: 1 } })
    .toArray();
  const appName = new Map(hosts.map((h) => [String(h._id), h.appName]));

  // createdAt is when it was queued; it ran for durationMs up to its last update
  const startOf = (r: (typeof rows)[number]) => {
    const queued = new Date(r.createdAt);
    if (r.status === "pending" || !r.updatedAt) return queued;
    const start = new Date(+new Date(r.updatedAt) - (r.durationMs || 0));
    return start < queued ? queued : start;
  };

  const builds = rows.map((r) => ({
    id: String(r._id),
    host: String(r.host),
    appName: appName.get(String(r.host)) ?? "",
    platform: r.platform as string,
    status: r.status as string,
    first: !!r.isFirstDeployment,
    start: startOf(r),
    end: r.updatedAt as Date,
    queuedAt: r.createdAt as Date,
    minutes: +((r.durationMs || 0) / 60_000).toFixed(2),
    failedTask: r.status === "failed" ? (r.failedTask ?? null) : null,
    reason: r.status === "failed" ? failureReason(r.logTail ?? "") : null,
  }));
  return builds.sort((a, b) => +a.start - +b.start);
};

/** GB per day the free space is shrinking by, from a least-squares fit over the last 24h */
const diskTrend = (series: { _id: Date; freeGb: number }[]) => {
  const cutoff = Date.now() - 86400e3;
  const pts = series.filter((p) => +p._id >= cutoff && p.freeGb > 0);
  if (pts.length < 6) return null;
  const xs = pts.map((p) => +p._id / 86400e3);
  const ys = pts.map((p) => p.freeGb);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den ? -num / den : null;
};

const getMachineHealth = factory.createHandlers(async (c) => {
  try {
    const range = (c.req.query("range") ?? "24h") as Range;
    const { ms, bucketMin } = RANGES[range] ?? RANGES["24h"];
    const since = new Date(Date.now() - ms);

    const [latest, latestSlow, rawSeries, slowRows, builds, buildCounts, redeployCounts] =
      await Promise.all([
        Mongo.machine_health.findOne({ kind: "fast" }, { sort: { t: -1 } }),
        Mongo.machine_health.findOne({ kind: "slow" }, { sort: { t: -1 } }),
        readSeries(since, bucketMin),
        Mongo.machine_health
          .find({ kind: "slow", t: { $gte: since } }, { projection: { t: 1, "slow.folders": 1 }, sort: { t: 1 } })
          .toArray(),
        readBuilds(since),
        buildJobCounts(),
        redeploymentQueue.getJobCounts("waiting", "active", "delayed", "paused"),
      ]);

    const series = rawSeries.map((s: any) => ({
      t: s._id as Date,
      load1: +s.load1.toFixed(2),
      busyCores: +s.busyCores.toFixed(2),
      cores: s.cores,
      memUsedGb: +s.memUsedGb.toFixed(2),
      memTotalGb: s.memTotalGb,
      swapGb: +s.swapGb.toFixed(2),
      pressureMax: s.pressureMax,
      freeGb: s.freeGb,
      ioMbps: +s.ioMbps.toFixed(1),
      ioMbpsMax: +s.ioMbpsMax.toFixed(1),
      pageouts: s.pageouts,
      groups: Object.fromEntries(GROUPS.map((g) => [g, +(s[`g_${g}`] ?? 0).toFixed(2)])),
    }));

    const gbPerDay = diskTrend(rawSeries as any);
    const freeGb = latest?.fast?.disk.freeGb ?? null;
    const daysToFull = gbPerDay && gbPerDay > 0 && freeGb !== null ? +(freeGb / gbPerDay).toFixed(1) : null;

    const alerts: Alert[] = [];
    const ageMs = latest ? Date.now() - +latest.t : Infinity;
    if (ageMs > STALE_AFTER_MS) {
      alerts.push({
        level: "critical",
        title: latest ? `No readings for ${Math.round(ageMs / 60_000)} min` : "No readings yet",
        detail: "Check that pm2 app tagmango-machine-health is running on the Mac Studio.",
      });
    }
    if (latest?.fast) {
      const f = latest.fast;
      if (!f.disk.totalGb) {
        // no disk reading in this sample
      } else if (f.disk.freeGb < DISK_CRITICAL_GB) {
        alerts.push({ level: "critical", title: `${f.disk.freeGb} GB free`, detail: "The worker pauses jobs below 40 GB." });
      } else if (f.disk.freeGb < DISK_WARNING_GB) {
        alerts.push({ level: "warning", title: `${f.disk.freeGb} GB free`, detail: `Below ${DISK_WARNING_GB} GB.` });
      }
      if (daysToFull !== null && daysToFull < 3) {
        alerts.push({ level: "warning", title: `Disk full in ~${daysToFull} days`, detail: `Free space falling ${gbPerDay!.toFixed(0)} GB/day over the last 24h.` });
      }
      if (f.pressure >= 4) {
        alerts.push({ level: "critical", title: "Memory pressure critical", detail: `Swap ${f.swapGb} GB.` });
      } else if (f.swapGb > SWAP_WARNING_GB) {
        alerts.push({ level: "warning", title: `Swap at ${f.swapGb} GB`, detail: `Above ${SWAP_WARNING_GB} GB.` });
      }
    }
    if (latestSlow?.slow) {
      const s = latestSlow.slow;
      const iosRunning = builds.some((b) => b.platform === "ios" && b.status === "processing");
      if (s.bootedSimulators.length && !iosRunning) {
        alerts.push({ level: "warning", title: `${s.bootedSimulators.length} simulator(s) booted`, detail: `${s.bootedSimulators.join(", ")} — no iOS build is running.` });
      }
      for (const p of s.pm2.filter((p) => p.status !== "online")) {
        alerts.push({ level: "critical", title: `pm2 ${p.name} is ${p.status}`, detail: `${p.restarts} restarts.` });
      }
    }
    const recent = builds.filter((b) => +new Date(b.start) > Date.now() - 6 * 3600e3 && ["success", "failed"].includes(b.status));
    const recentFailed = recent.filter((b) => b.status === "failed").length;
    if (recent.length >= 4 && recentFailed / recent.length > 0.25) {
      alerts.push({ level: "warning", title: `${recentFailed} of ${recent.length} builds failed in the last 6h`, detail: "See Failures below." });
    }

    return c.json(
      {
        message: "Fetched machine health",
        result: {
          range,
          bucketMin,
          since,
          now: new Date(),
          latest,
          latestSlow,
          series,
          folders: slowRows.map((r) => ({ t: r.t, folders: r.slow?.folders ?? {} })),
          builds,
          queue: { build: buildCounts, redeployment: redeployCounts },
          disk: { gbPerDay: gbPerDay === null ? null : +gbPerDay.toFixed(1), daysToFull },
          markers: PLAN_MARKERS.filter((m) => new Date(m.t) >= since),
          alerts,
        },
      },
      Response.OK,
    );
  } catch (error) {
    console.error("machine health failed", error);
    return c.json({ message: "Internal Server Error" }, Response.INTERNAL_SERVER_ERROR);
  }
});

export { getMachineHealth };
