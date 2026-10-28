import gplay from "google-play-scraper";
import { WithId } from "mongodb";

import {
  PLAY_SHADOW_CONTROL_HOSTS,
  PLAY_SHADOW_MAX_SKIPPED_RUNS,
  PLAY_SHADOW_RUN_BUDGET_MS,
} from "../constants";
import { IMetaData, IPlayVersionObservation } from "../types/database";
import {
  findPlayStoreCandidates,
  findPlayStoreControls,
  getTargetPlayVersion,
  newPlayRunId,
  recordPlayObservation,
} from "../utils/playStore";

/**
 * Shadow run of google-play-scraper next to the Puppeteer Play Store cron.
 * It only records observations (wlplayversionobservations); it never writes
 * metadata or deployment requests. scripts/play-shadow-report.ts compares
 * the two sources to decide when gps can replace Puppeteer.
 *
 * Throttling: one request at a time with a 3-6s random gap, no library
 * retries, a time budget per run, and a circuit breaker that skips the next
 * runs (doubling, capped) when Play answers 429/503 or errors pile up.
 */

const randomDelay = (min = 3000, max = 6000) =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min),
  );

// Play's answers when it wants us to slow down
const THROTTLE_STATUSES = new Set([429, 503]);
const MAX_CONSECUTIVE_ERRORS = 3;

let running = false;
let skipRuns = 0;
let nextBackoff = 3;

export const runPlayStoreShadow = async (): Promise<void> => {
  if (process.env.PLAY_GPS_SHADOW === "off") return;
  if (running) {
    console.log("play-store-shadow: previous run still going, skipping");
    return;
  }
  if (skipRuns > 0) {
    console.log(`play-store-shadow: backing off, ${skipRuns} run(s) to skip`);
    skipRuns--;
    return;
  }

  running = true;
  try {
    const tripped = await scrapeOnce();
    if (tripped) {
      skipRuns = nextBackoff;
      nextBackoff = Math.min(nextBackoff * 2, PLAY_SHADOW_MAX_SKIPPED_RUNS);
      console.log(
        `play-store-shadow: circuit open, skipping ${skipRuns} run(s)`,
      );
    } else {
      nextBackoff = 3;
    }
  } catch (error) {
    console.error("play-store-shadow: run failed:", (error as Error).message);
  } finally {
    running = false;
  }
};

/** @returns true when the circuit breaker tripped */
const scrapeOnce = async (): Promise<boolean> => {
  const target = await getTargetPlayVersion();
  const candidates = await findPlayStoreCandidates(target);
  const controls = target
    ? await findPlayStoreControls(target, PLAY_SHADOW_CONTROL_HOSTS)
    : [];
  const queue: { metadata: WithId<IMetaData>; control: boolean }[] = [
    ...candidates.map((metadata) => ({ metadata, control: false })),
    ...controls.map((metadata) => ({ metadata, control: true })),
  ];

  const runId = newPlayRunId("gps");
  const runStart = Date.now();
  console.log(
    `play-store-shadow: ${candidates.length} candidates + ${controls.length} controls`,
  );

  let consecutiveErrors = 0;
  let checked = 0;
  for (const { metadata, control } of queue) {
    if (Date.now() - runStart > PLAY_SHADOW_RUN_BUDGET_MS) {
      console.log(
        `play-store-shadow: time budget hit after ${checked}/${queue.length}`,
      );
      break;
    }

    const bundleId = metadata.androidDeploymentDetails.bundleId;
    const startedAt = Date.now();
    const base = {
      runId,
      source: "gps" as const,
      host: metadata.host,
      bundleId,
      targetVersion: target,
      storedVersion:
        metadata.androidDeploymentDetails.playStore?.versionName || null,
      ...(control && { control: true }),
      checkedAt: new Date(startedAt),
    };
    const record = (
      fields: Pick<
        IPlayVersionObservation,
        "outcome" | "version" | "storeUpdatedAt" | "httpStatus" | "error"
      >,
    ) =>
      recordPlayObservation({
        ...base,
        ...fields,
        durationMs: Date.now() - startedAt,
      });

    try {
      // requestOptions goes to got but isn't in the library's types; no
      // hidden retries, a 429 must reach the circuit breaker
      const options = {
        appId: bundleId,
        lang: "en",
        country: "in",
        requestOptions: { retry: { limit: 0 }, timeout: { request: 20000 } },
      };
      const app = await gplay.app(options);
      const version = app.version?.trim() || null;
      await record({
        outcome: version ? "ok" : "no_version",
        version,
        storeUpdatedAt: app.updated ? new Date(app.updated) : null,
      });
      consecutiveErrors = 0;
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = (error as Error).message;
      if (status === 404) {
        await record({ outcome: "not_found", version: null, httpStatus: 404 });
        consecutiveErrors = 0;
      } else if (status && THROTTLE_STATUSES.has(status)) {
        await record({
          outcome: "throttled",
          version: null,
          httpStatus: status,
          error: message,
        });
        console.log(`play-store-shadow: throttled (${status}) on ${bundleId}`);
        return true;
      } else {
        await record({
          outcome: "error",
          version: null,
          httpStatus: status,
          error: message,
        });
        if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(
            `play-store-shadow: ${consecutiveErrors} errors in a row, last: ${message}`,
          );
          return true;
        }
      }
    }

    checked++;
    await randomDelay();
  }

  console.log(
    `play-store-shadow: checked ${checked} in ${Math.round((Date.now() - runStart) / 1000)}s`,
  );
  return false;
};
