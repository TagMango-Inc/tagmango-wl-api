import { Hono } from "hono";

import {
  listDeploymentRequestsHandler,
  getDeploymentRequestHandler,
  updateDeploymentRequestStatusHandler,
  deleteDeploymentRequestHandler,
  deleteDeploymentRequestPlatformHandler,
  getDeploymentRequestStatsHandler,
} from "../controllers/deploymentRequest";

const router = new Hono();

// Get stats for dashboard (must be before /:id to avoid route conflict)
router.get("/stats", ...getDeploymentRequestStatsHandler);

// List all deployment requests with pagination and filtering
router.get("/", ...listDeploymentRequestsHandler);

// Get single deployment request
router.get("/:id", ...getDeploymentRequestHandler);

// Update deployment request status
router.patch("/:id/status", ...updateDeploymentRequestStatusHandler);

// Delete entire deployment request
router.delete("/:id", ...deleteDeploymentRequestHandler);

// Delete specific platform from deployment request
router.delete("/:id/:platform", ...deleteDeploymentRequestPlatformHandler);

export default router;
