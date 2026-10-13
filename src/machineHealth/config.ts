import os from "os";
import path from "path";

import { customhostDeploymentDir } from "../constants";
import {
  DEPLOYMENT_TRASH,
  GEM_CACHE_DIR,
  GYM_LOGS,
  XCODE_ARCHIVES,
  XCODE_DERIVED_DATA,
  XCODE_TRASH,
} from "../utils/trash";

export const FAST_INTERVAL_MS = 30_000;
// a folder scan walks hundreds of thousands of files, so it runs rarely and
// at background priority
export const SLOW_INTERVAL_MS = Number(process.env.WL_HEALTH_SCAN_MIN ?? 30) * 60_000;

const home = os.homedir();

/** folders whose size is tracked; keys are shown in the dashboard */
export const WATCHED_FOLDERS: Record<string, string> = {
  deployments: path.resolve(customhostDeploymentDir),
  deploymentTrash: path.resolve(DEPLOYMENT_TRASH),
  derivedData: XCODE_DERIVED_DATA,
  xcodeArchives: XCODE_ARCHIVES,
  xcodeTrash: XCODE_TRASH,
  gymLogs: GYM_LOGS,
  gems: GEM_CACHE_DIR,
  gradle: path.join(home, ".gradle/caches"),
  simulators: path.join(home, "Library/Developer/CoreSimulator/Devices"),
  cocoapods: path.join(home, "Library/Caches/CocoaPods"),
  npm: path.join(home, ".npm/_cacache"),
  aabOutputs: path.resolve("outputs"),
};

/**
 * Process names (as top prints them, cut to 16 characters) grouped by what
 * they are working for. Names of 4+ characters match by prefix, shorter ones
 * exactly ("ld" must not catch "launchd"). Anything else is "other".
 */
export const PROCESS_GROUPS: Record<string, string[]> = {
  android: ["java", "aapt2", "gradle"],
  ios: [
    "clang", "swift-frontend", "swift-driver", "swift", "xcodebuild", "ld",
    "ibtool", "actool", "XCBBuildService", "SWBBuildService", "codesign",
    "lipo", "simctl", "launchd_sim",
  ],
  js: ["node", "hermesc"],
  ruby: ["ruby", "pod"],
  indexing: [
    "mds", "mds_stores", "mdworker", "fseventsd", "watchman", "bird", "fileproviderd",
    "backupd", "mediaanalysisd", "photoanalysisd",
  ],
  system: ["kernel_task", "WindowServer", "rm", "cp", "git", "tar", "du"],
};
