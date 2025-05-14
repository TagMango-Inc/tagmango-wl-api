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
  "/host/:hostId/mark-in-store-review",
  ...markFormInStoreReviewHandler,
);
router.patch("/host/:hostId/mark-approved", ...markFormApprovedHandler);
router.patch("/host/:hostId/mark-unpublished", ...markFormUnpublished);
router.patch("/host/:hostId/mark-deployed", ...markFormDeployedHandler);
router.patch(
  "/host/:hostId/mark-is-external-dev-account",
  ...toggleIsExternalDevAccount,
);

router.delete("/:formId", ...deleteFormByIdHandler);

router.patch("/:formId/reject", ...rejectFormHandler);

export default router;
