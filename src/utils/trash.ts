import os from "os";
import path from "path";

import { customhostDeploymentDir } from "../constants";

// A deployment workspace is hundreds of thousands of files. Deleting one
// inline floods fseventsd and Spotlight and competes with the next build for
// disk. Instead it is renamed into a trash folder on the same volume (instant,
// atomic) and deleted at background priority, off the build's critical path.

/** trash for deployments/<bundle> workspaces */
export const DEPLOYMENT_TRASH = `${customhostDeploymentDir}/.trash`;
/** trash for Xcode DerivedData / Archives entries */
export const XCODE_TRASH = path.join(os.homedir(), "Library/Developer/.wl-trash");

/**
 * Background QoS throttles disk and CPU when anything else (a build) wants
 * them; nice keeps it last in the CPU queue as well.
 */
export const LOW_PRIORITY = ["taskpolicy", "-b", "nice", "-n", "19"];

/** zsh: move `target` into `trashDir` if it exists, falling back to deleting it */
export const trashCommand = (target: string, trashDir: string) =>
  `{ mkdir -p ${trashDir}; if [[ -e ${target} ]]; then mv ${target} ${trashDir}/${path.basename(target)}-$(date +%s)-$$ || rm -rf ${target}; fi; }`;

/**
 * zsh: trash entries of `dir` untouched for `olderThanMin` (default an hour),
 * except those matching `keep` (a zsh pattern, e.g. "*.noindex"). The age check means a build running alongside never loses
 * its own files. Housekeeping only, so it never fails the task.
 */
export const trashStaleEntriesCommand = (
  dir: string,
  trashDir: string,
  { keep, olderThanMin = 60 }: { keep?: string; olderThanMin?: number } = {},
) =>
  `{ mkdir -p ${trashDir}; for e in ${dir}/*(N^mm-${olderThanMin}); do [[ \${e:t} == ${keep ?? "''"} ]] || mv $e ${trashDir}/\${e:t}-$(date +%s)-$$; done; true; }`;

/** zsh: shut down booted simulators (Detox leaves them running) */
export const shutdownSimulatorsCommand = () =>
  `{ xcrun simctl shutdown all > /dev/null 2>&1; true; }`;

/**
 * zsh: delete what is in the trash dirs right now, at background priority,
 * detached so the task finishes without waiting for it. Entries trashed
 * later are not affected (the glob expands now).
 */
export const purgeTrashInBackgroundCommand = (...trashDirs: string[]) =>
  `{ ${LOW_PRIORITY.join(" ")} rm -rf ${trashDirs.map((d) => `${d}/*(DN)`).join(" ")} > /dev/null 2>&1 &! }`;
