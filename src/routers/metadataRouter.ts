import { Hono } from "hono";

import {
  deleteAndroidScreenshots,
  deleteIosScreenshots,
  getAppMetadata,
  reorderAndroidScreenshots,
  reorderIosScreenshots,
  updateAndroidDeveloperAccountForApp,
  updateBuildMetadataAndroidSettings,
  updateBuildMetadataIosSettings,
  updateInfoMetadataIosSettings,
  updateReviewMetadataIosSettings,
  updateStoreMetadataAndroidSettings,
  updateStoreMetadataIosSettings,
  uploadAndroidFeatureGraphic,
  uploadAndroidScreenshots,
  uploadIosScreenshots,
  uploadMetadataLogo,
} from "../../src/controllers/metadata";

const router = new Hono();

router.get("/:appId", ...getAppMetadata);

router.patch("/:appId/settings/logo/upload", ...uploadMetadataLogo);

router.patch(
  "/:appId/settings/android/build",
  ...updateBuildMetadataAndroidSettings,
);
router.patch(
  "/:appId/settings/android/store",
  ...updateStoreMetadataAndroidSettings,
);
router.patch(
  "/:appId/settings/android/feature-graphic",
  ...uploadAndroidFeatureGraphic,
);
router.patch(
  "/:appId/settings/android/screenshots",
  ...uploadAndroidScreenshots,
);
router.patch(
  "/:appId/settings/android/screenshots/reorder",
  ...reorderAndroidScreenshots,
);
router.patch(
  "/:appId/settings/android/screenshots/delete",
  ...deleteAndroidScreenshots,
);
router.patch(
  "/:appId/settings/android/developer-account",
  ...updateAndroidDeveloperAccountForApp,
);

router.patch("/:appId/settings/ios/build", ...updateBuildMetadataIosSettings);
router.patch("/:appId/settings/ios/store", ...updateStoreMetadataIosSettings);
router.patch("/:appId/settings/ios/info", ...updateInfoMetadataIosSettings);
router.patch("/:appId/settings/ios/review", ...updateReviewMetadataIosSettings);
router.patch("/:appId/settings/ios/screenshots", ...uploadIosScreenshots);
router.patch(
  "/:appId/settings/ios/screenshots/reorder",
  ...reorderIosScreenshots,
);
router.patch(
  "/:appId/settings/ios/screenshots/delete",
  ...deleteIosScreenshots,
);

export default router;
