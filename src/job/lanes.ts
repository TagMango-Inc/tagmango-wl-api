import { Job } from "bullmq";

import { BuildJobPayloadType } from "../types";

// Two build lanes run in the worker process, one job each: buildQueue (iOS,
// and Android while the Android lane is off) and androidBuildQueue. These
// keep the lanes off each other's shared state.

/** runs one task at a time across both lanes, in the order they ask */
export const takingTurns = () => {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const turn = last.then(run, run);
    last = turn.catch(() => undefined);
    return turn;
  };
};

/** root/<repo> is reset and fetched by the first task of every deployment and
 *  copied by the second; at the same time, git's index.lock collides */
export const withRootRepo = takingTurns();

/** screenshot generation runs Detox on the iOS simulator for both platforms
 *  and shuts every simulator down when it ends */
export const withSimulator = takingTurns();

/** bundle → job id. An app's iOS and Android deploys use the same
 *  deployments/<bundle> folder, so they never run at the same time. */
const activeBundles = new Map<string, string>();

/** false when the bundle is building in the other lane */
export const claimBundle = (bundle: string, jobId: string) => {
  const owner = activeBundles.get(bundle);
  if (owner && owner !== jobId) return false;
  activeBundles.set(bundle, jobId);
  return true;
};

/** on completed/failed; a job only releases a bundle it claimed */
export const releaseBundle = (job?: Job<BuildJobPayloadType>) => {
  if (job?.id && activeBundles.get(job.data.bundle) === job.id) {
    activeBundles.delete(job.data.bundle);
  }
};
