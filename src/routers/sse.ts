import { Hono } from "hono";
import { getDeploymentTaskStatusSSE } from "src/controllers/deployment";

const router = new Hono();
router.get(
  "/deployments-task-status/:deploymentId",
  ...getDeploymentTaskStatusSSE,
);

export default router;
