import path from "path";

import { customhostDeploymentDir } from "../constants";
import Mongo from "../database";
import { readFast, readSlow } from "./collect";
import { FAST_INTERVAL_MS, SLOW_INTERVAL_MS } from "./config";

// Records the build machine's health into Mongo (kept 30 days by a TTL
// index) for the dashboard's Machine Health tab. Read-only on the machine.
//
//   pm2 start dist/src/machineHealth/sampler.js --name tagmango-machine-health
//
// Run a single instance: each instance would write its own readings.

const diskPath = path.resolve(customhostDeploymentDir);
let scanning = false;

const fastTick = async () => {
  try {
    const fast = await readFast(diskPath);
    await Mongo.machine_health.insertOne({ t: new Date(), kind: "fast", fast });
  } catch (error) {
    console.error("machine health: fast reading failed", error);
  }
};

const slowTick = async () => {
  // a scan can outlast the interval while the disk is busy; never stack them
  if (scanning) return;
  scanning = true;
  try {
    const slow = await readSlow();
    await Mongo.machine_health.insertOne({ t: new Date(), kind: "slow", slow });
  } catch (error) {
    console.error("machine health: folder scan failed", error);
  } finally {
    scanning = false;
  }
};

Mongo.connect().then(() => {
  console.log(`machine health: sampling every ${FAST_INTERVAL_MS / 1000}s, scanning folders every ${SLOW_INTERVAL_MS / 60_000} min`);
  fastTick();
  slowTick();
  setInterval(fastTick, FAST_INTERVAL_MS);
  setInterval(slowTick, SLOW_INTERVAL_MS);
});
