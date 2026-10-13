import { Hono } from "hono";

import {
  getIosReviewAccounts,
  getIosReviewOverview,
  getIosReviewRunApps,
  getIosReviewRuns,
  scanIosReview,
  submitIosReview,
} from "../controllers/iosReview";

const router = new Hono();

router.get("/accounts", ...getIosReviewAccounts);
router.get("/runs/:runId/apps", ...getIosReviewRunApps);
router.get("/:accountId", ...getIosReviewOverview);
router.get("/:accountId/runs", ...getIosReviewRuns);
router.post("/:accountId/scan", ...scanIosReview);
router.post("/:accountId/submit", ...submitIosReview);

export default router;
