import { execFile } from "child_process";
import fs from "fs-extra";
import path from "path";
import util from "util";

import {
  customhostDeploymentDir,
  DEPLOYMENT_FOLDER_RETENTION_HOURS,
} from "../constants";
import Mongo from "../database";
import { Status } from "../types/database";
import { LOW_PRIORITY, XCODE_TRASH } from "../utils/trash";

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

/** bundle ids with a pending/processing deployment — their folders are in use */
const getActiveBundles = async () => {
  const activeHosts = await Mongo.deployment.distinct("host", {
    status: { $in: [Status.PENDING, Status.PROCESSING] },
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

    // also picks up anything left behind by an earlier interrupted run, and
    // Xcode output the worker moved aside
    const trashed = [
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
      `Expired (>${DEPLOYMENT_FOLDER_RETENTION_HOURS}h): ${toTrash.join(", ") || "none"}; removed ${removed}/${trashed.length} folders from .trash`,
    );
  } catch (error) {
    console.error("Error cleaning up deployment folders:", error);
  } finally {
    isRunning = false;
  }
};
