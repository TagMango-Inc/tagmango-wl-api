import fs from "fs-extra";
import cron from "node-cron";
import path from "path";

import { DAY_FROM_NOW, REMOVE_BUNDLES_CRON } from "../constants";
import { AABDetailsType } from "../types";

const { readFile, writeFile } = fs.promises;

const AAB_DIR = "./outputs/android";
const AAB_INDEX = "./data/android-aab.json";

/**
 * First-deploy Android bundles are kept for DAY_FROM_NOW days for download
 * from the dashboard, then removed along with their index entry. Files with
 * no index entry (left by an older run) go once they are as old.
 */
export const removeExpiredBundles = async () => {
  const cutoff = Date.now() - DAY_FROM_NOW * 24 * 60 * 60 * 1000;

  let index: AABDetailsType = {};
  try {
    index = JSON.parse(await readFile(AAB_INDEX, "utf-8"));
  } catch {
    // no index yet: only the orphan sweep below applies
  }

  const expired = Object.keys(index).filter(
    (hostId) => new Date(index[hostId].createdAt).getTime() < cutoff,
  );
  if (expired.length) {
    const kept = { ...index };
    expired.forEach((hostId) => delete kept[hostId]);
    await writeFile(AAB_INDEX, JSON.stringify(kept, null, 2));
  }

  const files = (await fs.pathExists(AAB_DIR)) ? await fs.readdir(AAB_DIR) : [];
  let removed = 0;
  for (const file of files.filter((f) => f.endsWith(".aab"))) {
    const hostId = path.basename(file, ".aab");
    const isExpired = expired.includes(hostId);
    const isOrphan =
      !index[hostId] &&
      (await fs.stat(path.join(AAB_DIR, file))).mtimeMs < cutoff;
    if (isExpired || isOrphan) {
      await fs.remove(path.join(AAB_DIR, file));
      removed++;
    }
  }

  console.log(
    `remove-bundle: ${expired.length} expired index entries, ${removed} .aab files removed`,
  );
};

export const scheduleRemoveBundles = () =>
  cron.schedule(REMOVE_BUNDLES_CRON, async () => {
    console.log("Running remove-bundle schedule");
    try {
      await removeExpiredBundles();
    } catch (error) {
      console.error("Error removing expired bundles:", error);
    }
  });
