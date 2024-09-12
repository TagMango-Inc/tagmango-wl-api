import { Hono } from "hono";

import {
  getDeploymentTaskLogsSSE,
  getDeploymentTaskStatusSSE,
} from "../../src/controllers/sse";

const router = new Hono();
router.get(
  "/deployments-task-status/:deploymentId",
  ...getDeploymentTaskStatusSSE,
);
router.get(
  "/deployments-task-logs/:deploymentId/:taskId",
  ...getDeploymentTaskLogsSSE,
);

export default router;
