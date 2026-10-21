import fs from "fs-extra";
import os from "os";
import path from "path";

import { GRADLE_BUILD_CACHE_RETENTION_DAYS } from "../constants";

/**
 * Gradle keeps local build-cache entries 7 days after their last use and can't
 * cap the cache by size. Most entries belong to one app (its bundle id and
 * resources) and are never used again: the cache grew to 73 GB with ~5,000
 * new entries a day, while the shared ones (46% of tasks come from the cache)
 * are used by every build. Retention can only be set from an init script, so
 * the worker writes one into the Gradle user home on startup.
 */
export const GRADLE_INIT_SCRIPT = "wl-build-cache-retention.gradle";

export const gradleInitScript = (days = GRADLE_BUILD_CACHE_RETENTION_DAYS) =>
  `// Written by tagmango-wl-api (src/job/gradleCache.ts) on worker start; edits are overwritten.
beforeSettings { settings ->
    settings.caches {
        buildCache.removeUnusedEntriesAfterDays = ${days}
    }
}
`;

/** writes the init script when missing or different; true when it changed */
export const ensureGradleCacheRetention = async () => {
  const home = process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle");
  const file = path.join(home, "init.d", GRADLE_INIT_SCRIPT);
  const content = gradleInitScript();
  if ((await fs.readFile(file, "utf8").catch(() => null)) === content) return false;
  await fs.outputFile(file, content);
  return true;
};
