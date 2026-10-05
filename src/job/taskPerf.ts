import fs from "fs-extra";

import { IDeploymentTaskPerf } from "../types/database";

// Per-command timings inside a task, so each optimisation can be measured
// against the command it changes. The task's own zsh prints a marker before
// every command using $EPOCHREALTIME, so this adds no extra processes.
const CMD_MARKER = "@@WLCMD";
const MARKER_LINE = /^@@WLCMD (\d+|end) (\d+(?:\.\d+)?)$/;
const MARKER_LINES = /^@@WLCMD .*(?:\r?\n|$)/gm;
// app-build.js logs "Success: <step>" after each shell step and
// "Completed operation: <step>" after each file edit
const APP_BUILD_STEP = /^(?:Success|Completed operation): (.+)$/;
// rows of the "fastlane summary" table: | 3 | gradle | 412 |
const FASTLANE_STEP = /^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/;
const ANSI = /\x1b\[[0-9;]*m/g;

export const instrumentCommands = (commands: string[]) => [
  "zmodload zsh/datetime",
  ...commands.flatMap((command, i) => [
    `print -r -- "${CMD_MARKER} ${i} $EPOCHREALTIME"`,
    command,
  ]),
  `print -r -- "${CMD_MARKER} end $EPOCHREALTIME"`,
];

// command text can carry secrets (appstore-metadata gets the .p8 in argv),
// so only a prefix with JSON arguments cut out is stored. JSON args start
// with {" — shell groups like "{ mkdir …; }" are kept readable.
const commandLabel = (command: string) =>
  command.replace(/\{".*\}/s, "{…}").slice(0, 120);

export const diskFreeGb = async () => {
  try {
    const { bavail, bsize } = await fs.promises.statfs(process.cwd());
    return +((bavail * bsize) / 1024 ** 3).toFixed(1);
  } catch {
    return null;
  }
};

export const createTaskPerf = (commands: string[]) => {
  const marks: { key: string; at: number }[] = [];
  const steps: IDeploymentTaskPerf["steps"] = [];
  let lastAppBuildStepAt = Date.now();
  let partial = "";

  const onLine = (raw: string) => {
    const line = raw.replace(ANSI, "").trim();
    const marker = MARKER_LINE.exec(line);
    if (marker) {
      marks.push({ key: marker[1], at: Math.round(+marker[2] * 1000) });
      return;
    }
    const appBuild = APP_BUILD_STEP.exec(line);
    if (appBuild) {
      const now = Date.now();
      steps.push({ source: "app-build", name: appBuild[1], ms: now - lastAppBuildStepAt });
      lastAppBuildStepAt = now;
      return;
    }
    const fastlane = FASTLANE_STEP.exec(line);
    if (fastlane && fastlane[1] !== "Action") {
      steps.push({ source: "fastlane", name: fastlane[1], ms: +fastlane[2] * 1000 });
    }
  };

  return {
    /** feed raw stdout; returns the chunk with marker lines removed for logging */
    onStdout(data: string) {
      const lines = (partial + data).split("\n");
      partial = lines.pop() ?? "";
      lines.forEach(onLine);
      return data.replace(MARKER_LINES, "");
    },
    async finish(diskFreeStart: number | null): Promise<IDeploymentTaskPerf> {
      if (partial) onLine(partial);
      const byKey = new Map(marks.map((m) => [m.key, m.at]));
      const end = byKey.get("end") ?? Date.now();
      return {
        commands: commands.flatMap((command, i) => {
          const start = byKey.get(String(i));
          if (start === undefined) return []; // never reached
          const next = byKey.get(String(i + 1)) ?? byKey.get("end");
          return [{ label: commandLabel(command), ms: (next ?? end) - start, ok: next !== undefined }];
        }),
        steps,
        diskFreeGb: { start: diskFreeStart, end: await diskFreeGb() },
      };
    },
  };
};
