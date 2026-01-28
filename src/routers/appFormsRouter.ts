import { Hono } from "hono";

import {
  deleteFormByIdHandler,
  getAllFormsCount,
  getAllFormsHandler,
  getFormByIdHandler,
  getLiveAppsOnOldVersion,
  markFormApprovedHandler,
  markFormDeployedHandler,
  markFormInReviewHandler,
  markFormInStoreReviewHandler,
  markFormUnpublished,
  rejectFormHandler,
  releaseEditAppForm,
  toggleIsExternalDevAccount,
} from "../controllers/appForms";

const router = new Hono();

router.get("/", ...getAllFormsHandler);
router.get("/count", ...getAllFormsCount);
router.get("/live-apps-on-old-version", ...getLiveAppsOnOldVersion);
router.get("/:formId", ...getFormByIdHandler);

router.patch(
  "/host/:formId/mark-in-store-review",
  ...markFormInStoreReviewHandler,
);
router.patch("/host/:formId/mark-approved", ...markFormApprovedHandler);
router.patch("/host/:formId/mark-in-review", ...markFormInReviewHandler);
router.patch("/host/:formId/mark-unpublished", ...markFormUnpublished);
router.patch("/host/:formId/mark-deployed", ...markFormDeployedHandler);
router.patch(
  "/host/:hostId/mark-is-external-dev-account",
  ...toggleIsExternalDevAccount,
);
router.post("/host/:hostId/:formId/release-edit-form", ...releaseEditAppForm);

router.delete("/:formId", ...deleteFormByIdHandler);

router.patch("/:formId/reject", ...rejectFormHandler);

export default router;
