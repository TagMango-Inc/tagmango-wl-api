import { Hono } from "hono";

import {
  createMetadata,
  getAppMetadata,
  getAppsCountByVersion,
  reorderAndroidScreenshots,
  reorderIosScreenshots,
  updateAndroidDeveloperAccountForApp,
  updateBuildMetadataAndroidSettings,
  updateBuildMetadataIosSettings,
  updateInfoMetadataIosSettings,
  updateIosAppleId,
  updateReviewMetadataIosSettings,
  updateStoreMetadataAndroidSettings,
  updateStoreMetadataIosSettings,
} from "../../src/controllers/metadata";

const router = new Hono();

router.get("/:appId", ...getAppMetadata);

router.post("/:appId", ...createMetadata);

router.patch(
  "/:appId/settings/android/build",
  ...updateBuildMetadataAndroidSettings,
);
router.patch(
  "/:appId/settings/android/store",
  ...updateStoreMetadataAndroidSettings,
);

router.patch(
  "/:appId/settings/android/screenshots/reorder",
  ...reorderAndroidScreenshots,
);

router.patch(
  "/:appId/settings/android/developer-account",
  ...updateAndroidDeveloperAccountForApp,
);

router.patch("/:appId/settings/ios/updateAppleId", ...updateIosAppleId);
router.patch("/:appId/settings/ios/build", ...updateBuildMetadataIosSettings);
router.patch("/:appId/settings/ios/store", ...updateStoreMetadataIosSettings);
router.patch("/:appId/settings/ios/info", ...updateInfoMetadataIosSettings);
router.patch("/:appId/settings/ios/review", ...updateReviewMetadataIosSettings);
router.patch(
  "/:appId/settings/ios/screenshots/reorder",
  ...reorderIosScreenshots,
);

router.get("/apps/version/:version", ...getAppsCountByVersion);

export default router;
