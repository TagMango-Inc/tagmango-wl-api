import { execFile } from "child_process";
import fs from "fs-extra";
import path from "path";
import util from "util";

import {
  customhostDeploymentDir,
  DEPLOYMENT_FOLDER_RETENTION_HOURS,
  GEM_CACHE_RETENTION_DAYS,
} from "../constants";
import Mongo from "../database";
import { Status } from "../types/database";
import {
  GEM_CACHE_DIR,
  GEM_TRASH,
  GYM_LOGS,
  LOW_PRIORITY,
  XCODE_ARCHIVES,
  XCODE_DERIVED_DATA,
  XCODE_TRASH,
} from "../utils/trash";

const execFileAsync = util.promisify(execFile);

const deploymentsDir = path.resolve(customhostDeploymentDir);
// expired folders are renamed in here first so they vanish from
// deployments/ atomically, then deleted
const trashDir = path.join(deploymentsDir, ".trash");

// each folder is a full RN project copy (node_modules, Pods, build output);
// deleting several at once floods fseventsd and starves the running build,
// so one at a time at background priority
const REMOVE_CONCURRENCY = 1;

let isRunning = false;

/**
 * Moves shared gem folders not used for GEM_CACHE_RETENTION_DAYS into
 * GEM_TRASH. The copy task touches a folder each time a deployment uses it,
 * so mtime is the last use. Returns the names moved.
 */
const trashUnusedGemFolders = async (stamp: number) => {
  if (!(await fs.pathExists(GEM_CACHE_DIR))) return [];
  await fs.ensureDir(GEM_TRASH);
  const cutoff = Date.now() - GEM_CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const moved: string[] = [];
  for (const name of await fs.readdir(GEM_CACHE_DIR)) {
    const dir = path.join(GEM_CACHE_DIR, name);
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.mtimeMs >= cutoff) continue;
    try {
      await fs.rename(dir, path.join(GEM_TRASH, `${name}-${stamp}`));
      moved.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return moved;
};

const HOUR_MS = 60 * 60 * 1000;
const GYM_LOG_RETENTION_MS = 3 * 24 * HOUR_MS;

/** the workspace a DerivedData project folder was built from (Xcode's info.plist) */
const derivedDataWorkspace = async (dir: string) => {
  try {
    const plist = await fs.readFile(path.join(dir, "info.plist"), "utf-8");
    return /<key>WorkspacePath<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1] ?? null;
  } catch {
    return null;
  }
};

/**
 * Xcode output the iOS cleanup step only removes after a *successful*
 * deployment; failed builds left theirs behind. Moved to XCODE_TRASH here:
 * DerivedData project folders and archives untouched for an hour (never the
 * shared *.noindex caches, never a folder built from a workspace in use) and
 * gym logs older than 3 days. Returns how many were moved.
 */
export const trashStaleXcodeOutput = async (activeBundles: Set<string>, stamp: number) => {
  await fs.ensureDir(XCODE_TRASH);
  let moved = 0;
  const trash = async (dir: string, name: string, maxAgeMs: number, guard?: () => Promise<boolean>) => {
    const full = path.join(dir, name);
    try {
      const stat = await fs.lstat(full);
      if (stat.mtimeMs > Date.now() - maxAgeMs) return;
      if (guard && !(await guard())) return;
      await fs.rename(full, path.join(XCODE_TRASH, `${name}-${stamp}`));
      moved++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  const list = async (dir: string) => ((await fs.pathExists(dir)) ? fs.readdir(dir) : []);

  for (const name of await list(XCODE_DERIVED_DATA)) {
    if (name.endsWith(".noindex") || name.startsWith(".")) continue;
    await trash(XCODE_DERIVED_DATA, name, HOUR_MS, async () => {
      const workspace = await derivedDataWorkspace(path.join(XCODE_DERIVED_DATA, name));
      return ![...activeBundles].some((b) => workspace?.includes(`/${customhostDeploymentDir}/${b}/`));
    });
  }
  for (const name of await list(XCODE_ARCHIVES)) {
    if (!name.startsWith(".")) await trash(XCODE_ARCHIVES, name, HOUR_MS);
  }
  for (const name of await list(GYM_LOGS)) {
    if (!name.startsWith(".")) await trash(GYM_LOGS, name, GYM_LOG_RETENTION_MS);
  }
  return moved;
};

/**
 * bundle ids whose folder is in use: a running deployment, or a restarted
 * one queued to resume from its finished tasks. A fresh pending deployment
 * starts with a new copy of the project, so it doesn't keep a folder.
 */
const getActiveBundles = async () => {
  const activeHosts = await Mongo.deployment.distinct("host", {
    $or: [
      { status: Status.PROCESSING },
      {
        status: Status.PENDING,
        "tasks.status": { $in: [Status.SUCCESS, Status.PROCESSING] },
      },
    ],
  });
  if (!activeHosts.length) return new Set<string>();

  const metadatas = await Mongo.metadata
    .find(
      { host: { $in: activeHosts } },
      {
        projection: {
          "androidDeploymentDetails.bundleId": 1,
          "iosDeploymentDetails.bundleId": 1,
        },
      },
    )
    .toArray();

  return new Set(
    metadatas
      .flatMap((m) => [
        m.androidDeploymentDetails?.bundleId,
        m.iosDeploymentDetails?.bundleId,
      ])
      .filter(Boolean),
  );
};

// native rm is far faster than fs.rm on trees with hundreds of thousands of
// files; background QoS lets a build take the disk first
const removeDir = (dir: string) =>
  execFileAsync(LOW_PRIORITY[0], [...LOW_PRIORITY.slice(1), "rm", "-rf", dir]);

const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) => {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    },
  );
  await Promise.all(runners);
};

export const cleanupDeploymentFolders = async () => {
  if (isRunning) {
    console.log("cleanup-deployment-folders already running, skipping");
    return;
  }
  isRunning = true;

  try {
    if (!(await fs.pathExists(deploymentsDir))) return;
    await fs.ensureDir(trashDir);

    const cutoff =
      Date.now() - DEPLOYMENT_FOLDER_RETENTION_HOURS * 60 * 60 * 1000;
    const activeBundles = await getActiveBundles();

    const entries = await fs.readdir(deploymentsDir, { withFileTypes: true });
    const toTrash: string[] = [];

    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map(async ({ name }) => {
          if (activeBundles.has(name)) return;
          const stat = await fs.lstat(path.join(deploymentsDir, name));
          // birthtime is 0 on filesystems that don't record it
          const createdAt = stat.birthtimeMs || stat.mtimeMs;
          if (createdAt < cutoff) toTrash.push(name);
        }),
    );

    // rename is atomic, so a deployment never sees a half-deleted folder;
    // with multiple cron instances only one wins the rename
    const stamp = Date.now();
    await Promise.all(
      toTrash.map(async (name) => {
        try {
          await fs.rename(
            path.join(deploymentsDir, name),
            path.join(trashDir, `${name}-${stamp}`),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }),
    );

    const unusedGems = await trashUnusedGemFolders(stamp);
    const staleXcode = await trashStaleXcodeOutput(activeBundles, stamp);

    // also picks up anything left behind by an earlier interrupted run, and
    // Xcode output and gem folders moved aside
    const trashed = [
      ...((await fs.pathExists(GEM_TRASH)) ? await fs.readdir(GEM_TRASH) : []).map(
        (name) => path.join(GEM_TRASH, name),
      ),
      ...(await fs.readdir(trashDir)).map((name) => path.join(trashDir, name)),
      ...((await fs.pathExists(XCODE_TRASH)) ? await fs.readdir(XCODE_TRASH) : []).map(
        (name) => path.join(XCODE_TRASH, name),
      ),
    ];
    let removed = 0;
    await runWithConcurrency(trashed, REMOVE_CONCURRENCY, async (name) => {
      try {
        await removeDir(name);
        removed++;
      } catch (error) {
        console.error(`Failed to remove deployment folder ${name}:`, error);
      }
    });

    console.log(
      `Expired (>${DEPLOYMENT_FOLDER_RETENTION_HOURS}h): ${toTrash.join(", ") || "none"}; unused gem folders (>${GEM_CACHE_RETENTION_DAYS}d): ${unusedGems.join(", ") || "none"}; removed ${removed}/${trashed.length} folders from trash; stale Xcode output moved: ${staleXcode}`,
    );
  } catch (error) {
    console.error("Error cleaning up deployment folders:", error);
  } finally {
    isRunning = false;
  }
};
