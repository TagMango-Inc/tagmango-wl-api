import { Hono } from "hono";

import {
  approveFormHandler,
  createFormRequestHandler,
  deleteFormByIdHandler,
  fetchPreRequisitesForApp,
  generateFormValuesAIHandler,
  getAllFormsHandler,
  getFormByHostIdHandler,
  getFormByIdHandler,
  getFormOverviewByHostIdHandler,
  markFormDeployedHandler,
  rejectFormHandler,
  submitFormHandler,
  updateInfoIosSettings,
  updateStoreAndroidSettings,
  updateStoreIosSettings,
  uploadAndroidFeatureGraphic,
  uploadFormLogo,
} from "../controllers/appForms";

const router = new Hono();

router.get("/", ...getAllFormsHandler);
router.get("/:formId", ...getFormByIdHandler);

router.get("/host/:hostId/overview", ...getFormOverviewByHostIdHandler);
router.get("/host/:hostId", ...getFormByHostIdHandler);
router.post("/host/:hostId/request", ...createFormRequestHandler);
router.patch("/host/:hostId/mark-deployed", ...markFormDeployedHandler);

router.post("/:formId/generate", ...generateFormValuesAIHandler);

// router.patch("/:formId", ...patchFormByIdHandler);
router.patch("/:formId/logo/upload", ...uploadFormLogo);
router.patch("/:formId/android/store", ...updateStoreAndroidSettings);
router.patch(
  "/:formId/android/feature-graphic",
  ...uploadAndroidFeatureGraphic,
);
router.patch("/:formId/ios/store", ...updateStoreIosSettings);
router.patch("/:formId/ios/info", ...updateInfoIosSettings);

router.patch("/:formId/submit", ...submitFormHandler);

router.delete("/:formId", ...deleteFormByIdHandler);

router.patch("/:formId/approve", ...approveFormHandler);
router.patch("/:formId/reject", ...rejectFormHandler);

router.get("/host/:hostId/pre-requisites", ...fetchPreRequisitesForApp);

export default router;
