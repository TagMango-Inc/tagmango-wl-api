import os from "os";
import path from "path";

import { customhostDeploymentDir } from "../constants";

// A deployment workspace is hundreds of thousands of files. Deleting one
// inline floods fseventsd and Spotlight and competes with the next build for
// disk. Instead it is renamed into a trash folder on the same volume (instant,
// atomic) and deleted at background priority, off the build's critical path.

/** trash for deployments/<bundle>-<platform> workspaces */
export const DEPLOYMENT_TRASH = `${customhostDeploymentDir}/.trash`;
/** trash for Xcode DerivedData / Archives entries */
export const XCODE_TRASH = path.join(os.homedir(), "Library/Developer/.wl-trash");
export const XCODE_DERIVED_DATA = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData");
export const XCODE_ARCHIVES = path.join(os.homedir(), "Library/Developer/Xcode/Archives");
export const GYM_LOGS = path.join(os.homedir(), "Library/Logs/gym");
/** shared gem installs, one folder per Ruby version + Gemfile.lock hash */
export const GEM_CACHE_DIR = path.join(os.homedir(), "wl-cache.noindex/bundle");
/** trash for gem folders unused for GEM_CACHE_RETENTION_DAYS */
export const GEM_TRASH = path.join(os.homedir(), "wl-cache.noindex/.trash");
/**
 * CocoaPods' cache of pods whose podspec comes from a local path (hermes-engine,
 * React-Core-prebuilt, ReactNativeDependencies from node_modules). Every
 * workspace path gets its own entry, ~90 MB for hermes-engine, and CocoaPods
 * never removes any: 1,255 hermes-engine copies (111 GB) by 21 Oct 2026.
 */
export const COCOAPODS_EXTERNAL = path.join(os.homedir(), "Library/Caches/CocoaPods/Pods/External");
/** the matching cached podspecs, <pod>/<entry>.podspec.json */
export const COCOAPODS_EXTERNAL_SPECS = path.join(os.homedir(), "Library/Caches/CocoaPods/Pods/Specs/External");

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

/**
 * zsh: trash the .xcarchive bundles under Xcode's Archives folder, then the
 * empty day folders Xcode files them in (Archives/<YYYY-MM-DD>/). Nothing
 * reads an archive after the build: gym exports the .ipa into the workspace
 * and the upload uses that. With `olderThanMin` only archives untouched for
 * that long go, so an archive being written is left alone.
 */
export const trashArchivesCommand = (
  dir: string,
  trashDir: string,
  { olderThanMin }: { olderThanMin?: number } = {},
) => {
  const age = olderThanMin === undefined ? "" : `^mm-${olderThanMin}`;
  return `{ mkdir -p ${trashDir}; for a in ${dir}/*/*.xcarchive(N/${age}); do mv $a ${trashDir}/\${a:t:r}-$(date +%s)-$$.xcarchive; done; rmdir ${dir}/*(N/^F) 2>/dev/null; true; }`;
};

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
