import fs from "fs-extra";
import path from "path";

import { EXTERNAL_POD_CACHE_RETENTION_DAYS } from "../constants";
import { COCOAPODS_EXTERNAL, COCOAPODS_EXTERNAL_SPECS, XCODE_TRASH } from "./trash";

/**
 * Moves CocoaPods cache entries for local-path pods (hermes-engine and the
 * other node_modules podspecs) older than EXTERNAL_POD_CACHE_RETENTION_DAYS
 * into XCODE_TRASH, with their cached podspec. Each workspace path gets its
 * own entry and CocoaPods never removes them (hermes-engine alone grew by
 * ~10 GB a day). A pod install that finds none downloads it again. Returns
 * how many were moved.
 *
 * pod install copies from these entries, and a repeat deploy of an app reuses
 * its own older one, so this must not run during a pod install: the worker
 * calls it before an iOS job starts (the iOS lane is idle) inside the
 * simulator turn (the screenshot step's Detox build runs pod install too).
 */
export const trashStaleExternalPods = async (stamp: number) => {
  if (!(await fs.pathExists(COCOAPODS_EXTERNAL))) return 0;
  await fs.ensureDir(XCODE_TRASH);
  const cutoff = Date.now() - EXTERNAL_POD_CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let moved = 0;
  for (const pod of await fs.readdir(COCOAPODS_EXTERNAL)) {
    const podDir = path.join(COCOAPODS_EXTERNAL, pod);
    if (pod.startsWith(".") || !(await fs.lstat(podDir)).isDirectory()) continue;
    for (const entry of await fs.readdir(podDir)) {
      const full = path.join(podDir, entry);
      try {
        if ((await fs.lstat(full)).mtimeMs >= cutoff) continue;
        await fs.rename(full, path.join(XCODE_TRASH, `cocoapods-${pod}-${entry}-${stamp}`));
        moved++;
        // without its entry the cached podspec only points at nothing
        await fs.remove(path.join(COCOAPODS_EXTERNAL_SPECS, pod, `${entry}.podspec.json`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return moved;
};
