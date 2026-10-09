import crypto from "crypto";
import fs from "fs-extra";
import path from "path";

// Store screenshots / listing images are generated into the workspace before
// the upload task. When they are byte-identical to what was last uploaded for
// the app, the upload lane skips them (WL_SKIP_SCREENSHOTS=1): re-uploading
// made App Store Connect reprocess every screenshot, up to ~3 min per iOS
// deploy, and cost ~37 s per Android one.

const listFiles = async (dir: string): Promise<string[]> => {
  if (!(await fs.pathExists(dir))) return [];
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else if (entry.isFile() && !entry.name.startsWith(".")) out.push(full);
  }
  return out;
};

/** the folders the upload lane takes screenshots / listing images from */
const screenshotDirs = async (workspace: string, platform: "android" | "ios") => {
  if (platform === "ios") return [path.join(workspace, "fastlane/screenshots/ios")];
  const metadata = path.join(workspace, "fastlane/metadata/android");
  if (!(await fs.pathExists(metadata))) return [];
  const langs = await fs.readdir(metadata);
  return langs.map((lang) => path.join(metadata, lang, "images"));
};

/**
 * sha256 over every file's relative path and contents, in a stable order.
 * null when there are no files, so "nothing generated" never counts as a match.
 */
export const hashScreenshots = async (workspace: string, platform: "android" | "ios") => {
  const files = (
    await Promise.all((await screenshotDirs(workspace, platform)).map(listFiles))
  ).flat();
  if (!files.length) return null;

  const hash = crypto.createHash("sha256");
  for (const file of files.map((f) => path.relative(workspace, f)).sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(workspace, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
};

/** where the last uploaded hash is kept on the app's metadata document */
export const uploadedHashField = (platform: "android" | "ios") =>
  platform === "ios"
    ? "iosDeploymentDetails.uploadedScreenshotsHash"
    : "androidDeploymentDetails.uploadedScreenshotsHash";
