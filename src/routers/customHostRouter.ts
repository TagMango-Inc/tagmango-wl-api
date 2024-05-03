import { Hono } from "hono";
import {
  createNewDeploymentHandler,
  deployCustomHostHandler,
  getAllCustomHostsHandler,
  getAllDeploymentsHandler,
  getCustomHostByIdHandler,
  getLastDeploymentDetailsHandler,
  patchCustomHostByIdHandler,
  uploadAssetHandler,
} from "src/controllers/customhost";

const router = new Hono();

/**
*! Protected Routes
** App Router 
/wl/apps/
/wl/apps/{:id} [ GET PATCH ]
/wl/apps/{:id}/deploy/{:android|ios} [ GET ]  [sse]  [ fetching all the required data for the build process  from database without passing it through query params ]
/wl/apps/{:id}/upload/asset [ POST ]  [ ":id" is for future purpose, may be someday we may have to upload the asset to S3 and store the URL in the database.]
*/

router.get("/", ...getAllCustomHostsHandler);
router.get("/:id", ...getCustomHostByIdHandler);
router.patch("/:id", ...patchCustomHostByIdHandler);
router.get("/:id/deploy/:target", ...deployCustomHostHandler);
router.post("/:id/upload/asset", ...uploadAssetHandler);
router.get(
  "/:id/last-deployment-details/:target",
  ...getLastDeploymentDetailsHandler,
);
router.get("/:id/deployments", ...getAllDeploymentsHandler);
router.post("/:id/deployments", ...createNewDeploymentHandler);

export default router;
