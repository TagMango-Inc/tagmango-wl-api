import { ChildProcess } from "child_process";
import Redis from "ioredis";

import { buildQueue, queueRedisOptions } from "./config";

/**
 * Cross-process cancellation for ACTIVE build jobs.
 *
 * The API process and the worker are separate processes sharing only Redis:
 * the controller can remove a *waiting* job from the queue, but an *active*
 * job is a running child process (fastlane/gradle) inside the worker. The
 * controller publishes the deploymentId on this channel; the worker kills the
 * task's process group and stops the task loop.
 */
export const DEPLOYMENT_CANCEL_CHANNEL = "wl:deployment-cancel";

const SIGKILL_GRACE_MS = 10_000;

/** API-side: request cancellation of an active job (reuses BullMQ's client). */
export const publishDeploymentCancel = async (deploymentId: string) => {
  const client = await buildQueue.client;
  await client.publish(DEPLOYMENT_CANCEL_CHANNEL, deploymentId);
};

// ---- worker-side state ----

let activeDeploymentId: string | null = null;
let activeChild: ChildProcess | null = null;
const cancelRequests = new Set<string>();

export const registerActiveTask = (
  deploymentId: string,
  child: ChildProcess,
) => {
  activeDeploymentId = deploymentId;
  activeChild = child;
  // the cancel message may have arrived between two tasks of the same job
  if (cancelRequests.has(deploymentId)) {
    killActiveChild();
  }
};

export const clearActiveTask = () => {
  activeDeploymentId = null;
  activeChild = null;
};

export const isCancelRequested = (deploymentId: string) =>
  cancelRequests.has(deploymentId);

/** call when a job finishes (any outcome) so the set doesn't grow unbounded */
export const consumeCancelRequest = (deploymentId: string) => {
  cancelRequests.delete(deploymentId);
};

const killActiveChild = () => {
  const child = activeChild;
  if (!child?.pid) return;
  // the task shell is spawned with detached:true so it leads its own process
  // group — negative pid signals the whole tree (zsh + fastlane + xcodebuild)
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* group already gone */
  }
  const timer = setTimeout(() => {
    try {
      if (child.pid && child.exitCode === null && !child.killed) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      /* group already gone */
    }
  }, SIGKILL_GRACE_MS);
  timer.unref();
};

/** worker-side: subscribe to cancel requests (dedicated connection — a
 *  subscribed ioredis connection can't run other commands) */
export const startCancellationListener = () => {
  const subscriber = new Redis(queueRedisOptions);
  subscriber.subscribe(DEPLOYMENT_CANCEL_CHANNEL);
  subscriber.on("message", (channel, deploymentId) => {
    if (channel !== DEPLOYMENT_CANCEL_CHANNEL || !deploymentId) return;
    cancelRequests.add(deploymentId);
    if (deploymentId === activeDeploymentId) {
      killActiveChild();
    }
  });
  return subscriber;
};
