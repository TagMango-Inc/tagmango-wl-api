import { Hono } from "hono";

import {
  getAllCustomHostsHandler,
  getCustomHostByIdHandler,
  patchCustomHostByIdHandler,
} from "../../src/controllers/customhost";
import {
  cancelDeploymentJobByDeploymentId,
  createBulkReDeploymentHandler,
  createNewDeploymentHandler,
  getAllDeployments,
  getAllDeploymentsHandler,
  getDeploymentDetails,
  getDeploymentDetailsById,
  getDeploymentRequirementsChecklist,
  getDeploymentTaskLogsByTaskId,
  getLatestRedeploymentDetailsById,
  getRecentDeploymentsHandler,
  restartDeploymentTaskByDeploymentId,
  updateFailedAndroidDeploymentStatus,
} from "../../src/controllers/deployment";

const router = new Hono();

/**https://www.postman.com/lively-spaceship-273497/workspace/tagmango/request/22586029-73920c1e-9c46-4045-ad5c-559dbdb94234
*! Protected Routes
** App Router
/wl/apps/
/wl/apps/{:id} [ GET PATCH ]
/wl/apps/{:id}/deploy/{:android|ios} [ GET ]  [sse]  [ fetching all the required data for the build process  from database without passing it through query params ]
/wl/apps/{:id}/upload/asset [ POST ]  [ ":id" is for future purpose, may be someday we may have to upload the asset to S3 and store the URL in the database.]
*/

router.get("/", ...getAllCustomHostsHandler);
router.get("/recent-deployments", ...getRecentDeploymentsHandler);
router.get("/deployments", ...getAllDeployments);
router.get("/latest-redeployment-details", ...getLatestRedeploymentDetailsById);
router.get("/:id", ...getCustomHostByIdHandler);
router.patch("/:id", ...patchCustomHostByIdHandler);
router.get("/:id/deployment-details/:target", ...getDeploymentDetails);
router.get("/:id/deployments", ...getAllDeploymentsHandler);
router.get("/:id/deployments/:deploymentId", ...getDeploymentDetailsById);
router.get(
  "/:id/deployments/:deploymentId/restart",
  ...restartDeploymentTaskByDeploymentId,
);
router.post("/:id/deployments", ...createNewDeploymentHandler);
router.post("/deployments/bulk-redeploy", ...createBulkReDeploymentHandler);
router.get(
  "/:id/deployments/:deploymentId/logs/:taskId",
  ...getDeploymentTaskLogsByTaskId,
);
router.delete(
  "/deployment/cancel-job/:deploymentId/:target/:version",
  ...cancelDeploymentJobByDeploymentId,
);
router.post(
  "/deployments/failed-android-status",
  ...updateFailedAndroidDeploymentStatus,
);
router.get(
  "/:id/deployments/requirements/:creatorId",
  ...getDeploymentRequirementsChecklist,
);

export default router;
