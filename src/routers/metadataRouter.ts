import { Hono } from "hono";

import {
  createMetadata,
  deleteAndroidFeatureGraphic,
  deleteAndroidScreenshots,
  deleteiOSIapScreenshot,
  deleteIosScreenshots,
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
  uploadAndroidFeatureGraphic,
  uploadAndroidScreenshots,
  uploadIosIAPScreenshot,
  uploadIosScreenshots,
  uploadMetadataLogo,
} from "../../src/controllers/metadata";

const router = new Hono();

router.get("/:appId", ...getAppMetadata);

router.post("/:appId", ...createMetadata);

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
  "/:appId/settings/android/feature-graphic/delete",
  ...deleteAndroidFeatureGraphic,
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
router.patch("/:appId/settings/ios/iapScreenshot", ...uploadIosIAPScreenshot);
router.patch("/:appId/settings/ios/screenshots", ...uploadIosScreenshots);
router.patch(
  "/:appId/settings/ios/screenshots/reorder",
  ...reorderIosScreenshots,
);
router.patch(
  "/:appId/settings/ios/screenshots/delete",
  ...deleteIosScreenshots,
);
router.patch(
  "/:appId/settings/ios/iapScreenshot/delete",
  ...deleteiOSIapScreenshot,
);
router.get("/apps/version/:version", ...getAppsCountByVersion);

export default router;
