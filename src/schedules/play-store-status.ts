import gplay from "google-play-scraper";

import {
  PLAY_STORE_MAX_SKIPPED_RUNS,
  PLAY_STORE_RUN_BUDGET_MS,
} from "../constants";
import Mongo from "../database";
import { IPlayVersionObservation } from "../types/database";
import {
  findPlayStoreCandidates,
  getTargetPlayVersion,
  newPlayRunId,
  recordPlayObservation,
} from "../utils/playStore";

/**
 * Reads each pending app's live version from its Google Play listing with
 * google-play-scraper, saves it to the app's metadata and, when it matches
 * the version AppZap is pushing (appreleaseversions), marks the app's
 * android deployment request as success. Every check is also recorded in
 * wlplayversionobservations for debugging.
 *
 * Replaced a Puppeteer scraper after 4 weeks in shadow (wl-api#73): no wrong
 * version in ~50k paired checks, and it saw each rollout as early or earlier.
 *
 * Throttling: one request at a time with a 3-6s random gap, a time budget
 * per run, and the previous run must have finished. A 429/503 from Play
 * stops the run and skips the next runs (3, doubling up to a cap, reset by
 * a clean run). Other errors are retried once after a short pause; three
 * failures in a row (usually our own network) end the current run only.
 */

const randomDelay = (min = 3000, max = 6000) =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min),
  );

// Play's answers when it wants us to slow down
const THROTTLE_STATUSES = new Set([429, 503]);
const MAX_CONSECUTIVE_ERRORS = 3;
// same rule the Puppeteer scraper used: "Varies with device" and the like
// are not versions
const VERSION_PATTERN = /^\d+(\.\d+)+/;

let running = false;
let skipRuns = 0;
let nextBackoff = 3;

export const updatePlayStoreStatus = async (): Promise<void> => {
  if (process.env.PLAY_STORE_STATUS === "off") return;
  if (running) {
    console.log("play-store-status: previous run still going, skipping");
    return;
  }
  if (skipRuns > 0) {
    console.log(`play-store-status: backing off, ${skipRuns} run(s) to skip`);
    skipRuns--;
    return;
  }

  running = true;
  try {
    const throttled = await runOnce();
    if (throttled) {
      skipRuns = nextBackoff;
      nextBackoff = Math.min(nextBackoff * 2, PLAY_STORE_MAX_SKIPPED_RUNS);
      console.log(
        `play-store-status: throttled by Play, skipping ${skipRuns} run(s)`,
      );
    } else {
      nextBackoff = 3;
    }
  } catch (error) {
    console.error("play-store-status: run failed:", (error as Error).message);
  } finally {
    running = false;
  }
};

type Fetched =
  | { kind: "app"; version: string | null; updated?: number }
  | { kind: "error"; status?: number; message: string };

const fetchApp = async (appId: string): Promise<Fetched> => {
  try {
    // requestOptions goes to got but isn't in the library's types; no
    // hidden retries, a 429 must reach the throttling logic
    const options = {
      appId,
      lang: "en",
      country: "in",
      requestOptions: { retry: { limit: 0 }, timeout: { request: 30000 } },
    };
    const app = await gplay.app(options);
    return {
      kind: "app",
      version: app.version?.trim() || null,
      updated: app.updated,
    };
  } catch (error) {
    return {
      kind: "error",
      status: (error as { status?: number }).status,
      message: (error as Error).message,
    };
  }
};

/** @returns true when Play throttled us */
const runOnce = async (): Promise<boolean> => {
  const target = await getTargetPlayVersion();
  if (!target) {
    console.log(
      "No appreleaseversions document found, deployment requests will not auto-complete this run",
    );
  }
  const candidates = await findPlayStoreCandidates(target);
  console.log(`play-store-status: ${candidates.length} apps to check`);
  if (candidates.length === 0) return false;

  const runId = newPlayRunId("gps");
  const runStart = Date.now();
  let consecutiveErrors = 0;
  let checked = 0;
  let updated = 0;

  for (const metadata of candidates) {
    if (Date.now() - runStart > PLAY_STORE_RUN_BUDGET_MS) {
      console.log(
        `play-store-status: time budget hit after ${checked}/${candidates.length}`,
      );
      break;
    }

    const bundleId = metadata.androidDeploymentDetails.bundleId;
    const startedAt = Date.now();
    const record = (
      fields: Pick<
        IPlayVersionObservation,
        "outcome" | "version" | "storeUpdatedAt" | "httpStatus" | "error"
      >,
    ) =>
      recordPlayObservation({
        runId,
        source: "gps",
        host: metadata.host,
        bundleId,
        targetVersion: target,
        storedVersion:
          metadata.androidDeploymentDetails.playStore?.versionName || null,
        checkedAt: new Date(startedAt),
        durationMs: Date.now() - startedAt,
        ...fields,
      });

    let result = await fetchApp(bundleId);
    // timeouts, dropped connections and the parser tripping over an odd
    // listing page are usually gone on a second try
    if (
      result.kind === "error" &&
      result.status !== 404 &&
      !(result.status && THROTTLE_STATUSES.has(result.status))
    ) {
      await randomDelay(2000, 4000);
      result = await fetchApp(bundleId);
    }

    if (result.kind === "app") {
      consecutiveErrors = 0;
      const version =
        result.version && VERSION_PATTERN.test(result.version)
          ? result.version
          : null;
      await record({
        outcome: version ? "ok" : "no_version",
        version: result.version,
        storeUpdatedAt: result.updated ? new Date(result.updated) : null,
      });
      if (version) {
        await saveVersion(metadata.host, version, target);
        updated++;
      } else {
        console.log(`❌ ${bundleId}: no version (${result.version})`);
      }
    } else if (result.status === 404) {
      consecutiveErrors = 0;
      await record({ outcome: "not_found", version: null, httpStatus: 404 });
    } else if (result.status && THROTTLE_STATUSES.has(result.status)) {
      await record({
        outcome: "throttled",
        version: null,
        httpStatus: result.status,
        error: result.message,
      });
      console.log(
        `play-store-status: throttled (${result.status}) on ${bundleId}`,
      );
      return true;
    } else {
      await record({
        outcome: "error",
        version: null,
        httpStatus: result.status,
        error: result.message,
      });
      console.log(`❌ ${bundleId}: ${result.message}`);
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log(
          `play-store-status: ${consecutiveErrors} errors in a row, ending this run`,
        );
        break;
      }
    }

    checked++;
    await randomDelay();
  }

  console.log(
    `play-store-status: checked ${checked}, updated ${updated} in ${Math.round((Date.now() - runStart) / 1000)}s`,
  );
  return false;
};

const saveVersion = async (
  host: IPlayVersionObservation["host"],
  version: string,
  target: string | null,
) => {
  await Mongo.metadata.updateOne(
    { host },
    {
      $set: {
        "androidDeploymentDetails.playStore.versionName": version,
        "androidDeploymentDetails.playStore.status": "READY_FOR_DISTRIBUTION",
      },
    },
  );

  // Only complete the deployment request when the live version is the
  // release AppZap is pushing to all hosts.
  if (target && version === target) {
    const flipResult = await Mongo.deployment_requests.updateOne(
      { host, "android.status": "processing" },
      { $set: { "android.status": "success", updatedAt: new Date() } },
    );
    if (flipResult.modifiedCount > 0) {
      console.log(
        `Marked android deployment request as success for host ${host}`,
      );
    }
  }
};
