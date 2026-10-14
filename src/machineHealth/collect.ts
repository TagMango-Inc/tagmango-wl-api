import { execFile } from "child_process";
import fs from "fs-extra";
import os from "os";

import { IMachineHealthSample } from "../types/database";
import { LOW_PRIORITY } from "../utils/trash";
import { PROCESS_GROUPS, WATCHED_FOLDERS } from "./config";

type Fast = NonNullable<IMachineHealthSample["fast"]>;
type Slow = NonNullable<IMachineHealthSample["slow"]>;

const GB = 1024 ** 3;
const round = (n: number, digits = 2) => +n.toFixed(digits);

/** stdout of a command, or "" if it fails or times out (a reading must never throw) */
const run = (cmd: string, args: string[], timeout = 20_000) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? "" : stdout),
    ),
  );

const groupOf = (name: string) => {
  for (const [group, names] of Object.entries(PROCESS_GROUPS)) {
    if (names.some((p) => name === p || (p.length >= 4 && name.startsWith(p)))) return group;
  }
  return "other";
};

// `top -l 2`: the first sample's CPU is since boot, the second is the last second
const parseTop = (out: string) => {
  const second = out.split(/^Processes:/m)[2] ?? out;
  const cpu = /CPU usage:\s+([\d.]+)% user,\s+([\d.]+)% sys,\s+([\d.]+)% idle/.exec(second);
  const rows = (second.split(/^\s*PID\s+%CPU.*$/m)[1] ?? "").split("\n");
  const procs: { name: string; cpu: number }[] = [];
  for (const row of rows) {
    const m = /^\s*\d+\s+([\d.]+)\s+(.+)$/.exec(row);
    if (m) procs.push({ cpu: +m[1], name: m[2].trim() });
  }
  return {
    cpu: { user: +(cpu?.[1] ?? 0), sys: +(cpu?.[2] ?? 0), idle: +(cpu?.[3] ?? 100) },
    procs,
  };
};

const vmCounter = (vm: string, label: string) =>
  +(new RegExp(`${label}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0);

let lastCounters: { pageouts: number; swapouts: number } | null = null;

export const readFast = async (diskPath: string): Promise<Fast> => {
  const cores = os.cpus().length;
  const [top, io, swap, pressure, vm, statfs] = await Promise.all([
    run("top", ["-l", "2", "-s", "1", "-n", "60", "-o", "cpu", "-stats", "pid,cpu,command"]),
    run("iostat", ["-d", "-w", "1", "-c", "2", "disk0"]),
    run("sysctl", ["-n", "vm.swapusage"]),
    run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
    run("vm_stat", []),
    // deployments/ may not exist yet on a fresh checkout; it sits on the repo's volume
    fs.promises.statfs(diskPath).catch(() => fs.promises.statfs(process.cwd())).catch(() => null),
  ]);

  const { cpu, procs } = parseTop(top);
  // one bad row (top has printed absurd values for java) must not swamp a chart
  const maxCores = cores;
  const groups: Record<string, number> = Object.fromEntries(
    [...Object.keys(PROCESS_GROUPS), "other"].map((g) => [g, 0]),
  );
  for (const p of procs) {
    groups[groupOf(p.name)] += Math.min(p.cpu / 100, maxCores);
  }
  // top lists only its first 60 rows; whatever they don't explain is "other"
  const busyCores = ((100 - cpu.idle) / 100) * cores;
  const listed = Object.values(groups).reduce((a, b) => a + b, 0);
  groups.other += Math.max(0, busyCores - listed);
  for (const g of Object.keys(groups)) groups[g] = round(groups[g]);

  const pageSize = +(/page size of (\d+) bytes/.exec(vm)?.[1] ?? 16384);
  const pages = (label: string) => (vmCounter(vm, label) * pageSize) / GB;
  const appGb = Math.max(0, pages("Anonymous pages") - pages("Pages purgeable"));
  const wiredGb = pages("Pages wired down");
  const compressedGb = pages("Pages occupied by compressor");

  const counters = { pageouts: vmCounter(vm, "Pageouts"), swapouts: vmCounter(vm, "Swapouts") };
  const delta = (k: keyof typeof counters) =>
    lastCounters ? Math.max(0, counters[k] - lastCounters[k]) : 0;
  const pageouts = delta("pageouts");
  const swapouts = delta("swapouts");
  lastCounters = counters;

  const ioCols = io.trim().split("\n").pop()?.trim().split(/\s+/) ?? [];

  return {
    load: os.loadavg().map((n) => round(n)) as [number, number, number],
    cores,
    cpu,
    mem: {
      totalGb: round(os.totalmem() / GB, 1),
      usedGb: round(appGb + wiredGb + compressedGb),
      appGb: round(appGb),
      wiredGb: round(wiredGb),
      compressedGb: round(compressedGb),
    },
    pressure: +pressure.trim() || 0,
    swapGb: round(+(/used = ([\d.]+)M/.exec(swap)?.[1] ?? 0) / 1024),
    pageouts,
    swapouts,
    disk: {
      freeGb: statfs ? round((statfs.bavail * statfs.bsize) / GB, 1) : 0,
      totalGb: statfs ? round((statfs.blocks * statfs.bsize) / GB, 1) : 0,
    },
    io: { mbps: +(ioCols[2] ?? 0), tps: +(ioCols[1] ?? 0) },
    groups,
    top: procs.slice(0, 8).map((p) => [p.name, p.cpu]),
  };
};

/** GB used by a folder; 0 when it does not exist */
const folderGb = async (dir: string) => {
  if (!(await fs.pathExists(dir))) return 0;
  const out = await run(LOW_PRIORITY[0], [...LOW_PRIORITY.slice(1), "du", "-sk", dir], 15 * 60_000);
  return round(Number(out.split("\t")[0] || 0) / 1024 ** 2);
};

const readPm2 = async (): Promise<Slow["pm2"]> => {
  try {
    const list = JSON.parse((await run("pm2", ["jlist"])) || "[]") as any[];
    const byName = new Map<string, Slow["pm2"][number]>();
    for (const p of list) {
      const env = p.pm2_env ?? {};
      const cur = byName.get(p.name) ?? {
        name: p.name, status: "online", restarts: 0, memMb: 0, cpu: 0, uptimeMin: Infinity,
      };
      if (env.status !== "online") cur.status = env.status;
      cur.restarts += env.restart_time ?? 0;
      cur.memMb += Math.round((p.monit?.memory ?? 0) / 1024 ** 2);
      cur.cpu += p.monit?.cpu ?? 0;
      if (env.pm_uptime) cur.uptimeMin = Math.min(cur.uptimeMin, Math.round((Date.now() - env.pm_uptime) / 60_000));
      byName.set(p.name, cur);
    }
    return [...byName.values()].map((p) => ({ ...p, uptimeMin: Number.isFinite(p.uptimeMin) ? p.uptimeMin : 0 }));
  } catch {
    return [];
  }
};

export const readSlow = async (): Promise<Slow> => {
  const started = Date.now();
  const folders: Record<string, number> = {};
  // one at a time: parallel scans would compete with a running build for disk
  for (const [key, dir] of Object.entries(WATCHED_FOLDERS)) {
    folders[key] = await folderGb(dir);
  }
  // the trash lives inside deployments/; report the live workspaces on their own
  folders.deployments = round(Math.max(0, folders.deployments - folders.deploymentTrash));

  const [sims, gradle, pm2] = await Promise.all([
    run("xcrun", ["simctl", "list", "devices", "booted", "-j"]),
    run("pgrep", ["-f", "GradleDaemon"]),
    readPm2(),
  ]);
  let bootedSimulators: string[] = [];
  try {
    const devices = JSON.parse(sims || "{}").devices ?? {};
    bootedSimulators = Object.values(devices).flat().map((d: any) => d.name);
  } catch {
    // keep empty
  }

  return {
    folders,
    bootedSimulators,
    gradleDaemons: gradle.trim() ? gradle.trim().split("\n").length : 0,
    pm2,
    scanMs: Date.now() - started,
  };
};
