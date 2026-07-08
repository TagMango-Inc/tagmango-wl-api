/**
 * Stub test for C5: verifies the Redis pub/sub cancel path kills a detached
 * process group. No queue, no DB writes — a `sleep` stands in for fastlane.
 * Run: npx tsx scripts/test-cancellation.ts
 */
import { spawn } from "child_process";

import {
  publishDeploymentCancel,
  registerActiveTask,
  startCancellationListener,
} from "../src/job/cancellation";

const FAKE_DEPLOYMENT_ID = "deadbeefdeadbeefdeadbeef";

(async () => {
  const subscriber = startCancellationListener();
  await new Promise((r) => setTimeout(r, 300)); // let SUBSCRIBE settle

  // shell parent + sleep child, like the worker's zsh + fastlane tree
  const child = spawn("sleep 300 & wait", {
    shell: "/bin/zsh",
    detached: true,
  });
  registerActiveTask(FAKE_DEPLOYMENT_ID, child);
  console.log(`spawned pgid=${child.pid}`);

  const exit = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => child.on("close", (code, signal) => resolve({ code, signal })),
  );

  await publishDeploymentCancel(FAKE_DEPLOYMENT_ID);
  console.log("cancel published");

  const timeout = new Promise<"timeout">((r) =>
    setTimeout(() => r("timeout"), 5000),
  );
  const result = await Promise.race([exit, timeout]);

  if (result === "timeout") {
    console.error("FAIL: child still alive 5s after cancel");
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
    process.exit(1);
  }

  console.log(
    `PASS: child died with code=${result.code} signal=${result.signal}`,
  );
  subscriber.disconnect();
  process.exit(0);
})();
