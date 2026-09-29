// Summarises the host sampler's JSONL into before/after numbers.
//   node scripts/perf/summarize-host.js --since 2026-09-29 --until 2026-10-02 --out perf/host-before.json
// Samples are split into "building" (a compiler or bundler is busy) and "idle"
// so a quiet day doesn't flatter the numbers.
const fs = require("fs");
const os = require("os");
const path = require("path");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const dir = arg("dir", path.join(os.homedir(), "wl-perf", "host"));
const since = new Date(arg("since", "1970-01-01"));
const until = new Date(arg("until", new Date().toISOString()));
const out = arg("out");

const BUILD_PROCS = ["java", "xcodebuild", "clang", "swift-frontend", "ld", "hermesc"];

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({
  min: pct(xs, 0),
  p50: pct(xs, 50),
  p90: pct(xs, 90),
  max: pct(xs, 100),
  mean: xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null,
});

const samples = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".jsonl"))
  .flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n"))
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((s) => new Date(s.t) >= since && new Date(s.t) < until)
  .sort((a, b) => a.t.localeCompare(b.t));

const isBuilding = (s) =>
  BUILD_PROCS.reduce((a, p) => a + (s.procs[p]?.cpu ?? 0), 0) > 50;

const summarise = (group) => {
  const names = [...new Set(group.flatMap((s) => Object.keys(s.procs)))];
  const procCpu = Object.fromEntries(
    names
      .map((n) => [n, stats(group.map((s) => s.procs[n]?.cpu ?? 0))])
      .sort((a, b) => b[1].mean - a[1].mean),
  );
  return {
    samples: group.length,
    load1: stats(group.map((s) => s.load1)),
    swapUsedMb: stats(group.map((s) => s.swapUsedMb)),
    // share of samples at each memory-pressure level (1 normal, 2 warn, 4 critical)
    pressure: Object.fromEntries(
      [1, 2, 4].map((l) => [l, +(group.filter((s) => s.pressure === l).length / (group.length || 1)).toFixed(3)]),
    ),
    freeDiskGb: stats(group.map((s) => s.freeDiskGb)),
    diskMBps: stats(group.map((s) => s.diskMBps)),
    procCpu,
  };
};

// pageouts are cumulative counters; report the rate over the window
const rate = (key) => {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const hours = (new Date(last.t) - new Date(first.t)) / 36e5;
  return hours > 0 ? Math.round((last[key] - first[key]) / hours) : null;
};

const report = {
  since,
  until,
  generatedAt: new Date(),
  pageoutsPerHour: rate("pageouts"),
  swapoutsPerHour: rate("swapouts"),
  all: summarise(samples),
  building: summarise(samples.filter(isBuilding)),
  idle: summarise(samples.filter((s) => !isBuilding(s))),
};

const json = JSON.stringify(report, null, 2);
if (out) fs.writeFileSync(out, json);
console.log(json);
