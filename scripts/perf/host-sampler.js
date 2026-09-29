// Samples machine pressure every 30s into ~/wl-perf/host/<date>.jsonl so the
// "before" and "after" of each phase can be compared. Read-only; uses only
// macOS built-ins (top, iostat, sysctl, df, vm_stat).
//
//   pm2 start scripts/perf/host-sampler.js --name wl-perf-sampler
//   node scripts/perf/summarize-host.js --since 2026-09-29
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const INTERVAL_MS = 30_000;
const OUT_DIR = path.join(os.homedir(), "wl-perf", "host");
// WL_REPO lets the script run from a copy outside the repo
const REPO = process.env.WL_REPO || path.resolve(__dirname, "..", "..");

// processes whose CPU we track by name; anything else only shows in `top`
const WATCHED = [
  "fseventsd", "mds_stores", "mds", "mdworker_shared", "watchman", "rm",
  "cp", "git", "node", "java", "xcodebuild", "clang", "swift-frontend", "ld",
  "hermesc", "ruby", "bird", "fileproviderd", "backupd", "kernel_task",
];

const run = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 20_000 }, (err, stdout) =>
      resolve(err ? "" : stdout),
    ),
  );

// second sample of `top -l 2` has real per-interval CPU; the first is since boot
const parseTop = (out) => {
  const blocks = out.split(/^\s*PID\s+%CPU/m);
  const rows = (blocks[2] ?? blocks[1] ?? "").split("\n").slice(1);
  const procs = [];
  for (const row of rows) {
    const m = row.trim().match(/^(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (m) procs.push({ cpu: +m[2], mem: m[3], name: m[4].trim() });
  }
  return procs;
};

const toMb = (s) => {
  const m = /^([\d.]+)([BKMG])/.exec(s || "");
  if (!m) return 0;
  return +m[1] * { B: 1 / 1048576, K: 1 / 1024, M: 1, G: 1024 }[m[2]];
};

const sample = async () => {
  const [top, io, swap, pressure, load, df, vm] = await Promise.all([
    run("top", ["-l", "2", "-s", "1", "-n", "40", "-o", "cpu", "-stats", "pid,cpu,rsize,command"]),
    run("iostat", ["-d", "-w", "1", "-c", "2", "disk0"]),
    run("sysctl", ["-n", "vm.swapusage"]),
    run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
    run("sysctl", ["-n", "vm.loadavg"]),
    run("df", ["-k", REPO]),
    run("vm_stat", []),
  ]);

  const procs = parseTop(top);
  const byName = {};
  for (const p of procs) {
    const name = WATCHED.find((w) => p.name === w || p.name.startsWith(w));
    if (!name) continue;
    byName[name] ??= { cpu: 0, memMb: 0, n: 0 };
    byName[name].cpu += p.cpu;
    byName[name].memMb += toMb(p.mem);
    byName[name].n += 1;
  }

  const ioLine = io.trim().split("\n").pop()?.trim().split(/\s+/) ?? [];
  const dfLine = df.trim().split("\n").pop()?.split(/\s+/) ?? [];
  const vmNum = (label) => +(new RegExp(`${label}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0);

  return {
    t: new Date().toISOString(),
    load1: +(load.match(/[\d.]+/)?.[0] ?? 0),
    swapUsedMb: +(swap.match(/used = ([\d.]+)M/)?.[1] ?? 0),
    pressure: +pressure.trim() || 0,
    freeDiskGb: +((+dfLine[3] || 0) / 1048576).toFixed(1),
    diskMBps: +(ioLine[2] ?? 0),
    diskTps: +(ioLine[1] ?? 0),
    pageouts: vmNum("Pageouts"),
    swapouts: vmNum("Swapouts"),
    procs: byName,
    top5: procs.slice(0, 5).map((p) => [p.name, p.cpu]),
  };
};

const tick = async () => {
  try {
    const s = await sample();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.appendFileSync(path.join(OUT_DIR, `${s.t.slice(0, 10)}.jsonl`), JSON.stringify(s) + "\n");
  } catch (error) {
    console.error("sample failed", error);
  }
};

// --once writes a single sample and exits (handy to check it works)
if (process.argv.includes("--once")) tick();
else {
  tick();
  setInterval(tick, INTERVAL_MS);
}
