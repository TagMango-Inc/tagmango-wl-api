import { Hono } from "hono";

import {
  deleteFormByIdHandler,
  getAllFormsCount,
  getAllFormsHandler,
  getFormByIdHandler,
  getLiveAppsOnOldVersion,
  markFormApprovedHandler,
  markFormDeployedHandler,
  markFormInStoreReviewHandler,
  markFormUnpublished,
  rejectFormHandler,
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
router.patch("/host/:formId/mark-unpublished", ...markFormUnpublished);
router.patch("/host/:formId/mark-deployed", ...markFormDeployedHandler);
router.patch(
  "/host/:hostId/mark-is-external-dev-account",
  ...toggleIsExternalDevAccount,
);

router.delete("/:formId", ...deleteFormByIdHandler);

router.patch("/:formId/reject", ...rejectFormHandler);

export default router;
