import { Hono } from "hono";

import {
  approveFormHandler,
  deleteFormByIdHandler,
  fetchPreRequisitesForApp,
  generateFormValuesAIHandler,
  getAllFormsCount,
  getAllFormsHandler,
  getFormByHostIdHandler,
  getFormByIdHandler,
  getFormOverviewByHostIdHandler,
  getLiveAppsOnOldVersion,
  markAppsLiveBannerSeenHandler,
  markFormApprovedHandler,
  markFormDeployedHandler,
  markFormInStoreReviewHandler,
  markFormUnpublished,
  rejectFormHandler,
  submitFormHandler,
  updateStoreAndroidSettings,
  updateStoreIosSettings,
  uploadFormLogo,
} from "../controllers/appForms";

const router = new Hono();

router.get("/", ...getAllFormsHandler);
router.get("/count", ...getAllFormsCount);
router.get("/live-apps-on-old-version", ...getLiveAppsOnOldVersion);
router.get("/:formId", ...getFormByIdHandler);

router.get("/host/:hostId/overview", ...getFormOverviewByHostIdHandler);
router.patch(
  "/host/:hostId/mark-apps-live-banner-seen",
  ...markAppsLiveBannerSeenHandler,
);
router.get("/host/:hostId", ...getFormByHostIdHandler);

router.patch(
  "/host/:hostId/mark-in-store-review",
  ...markFormInStoreReviewHandler,
);
router.patch("/host/:hostId/mark-approved", ...markFormApprovedHandler);
router.patch("/host/:hostId/mark-unpublished", ...markFormUnpublished);
router.patch("/host/:hostId/mark-deployed", ...markFormDeployedHandler);

router.post("/:formId/generate", ...generateFormValuesAIHandler);

router.patch("/:formId/logo/upload", ...uploadFormLogo);
router.patch("/:formId/android/store", ...updateStoreAndroidSettings);

router.patch("/:formId/ios/store", ...updateStoreIosSettings);

router.patch("/:formId/submit", ...submitFormHandler);

router.delete("/:formId", ...deleteFormByIdHandler);

router.patch("/:formId/approve", ...approveFormHandler);
router.patch("/:formId/reject", ...rejectFormHandler);

router.get("/host/:hostId/pre-requisites", ...fetchPreRequisitesForApp);

export default router;
