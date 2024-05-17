import { Hono } from "hono";

import {
  deleteAndroidScreenshots,
  getAppMetadata,
  reorderAndroidScreenshots,
  updateBuildMetadataAndroidSettings,
  updateBuildMetadataIosSettings,
  updateInfoMetadataIosSettings,
  updateReviewMetadataIosSettings,
  updateStoreMetadataAndroidSettings,
  updateStoreMetadataIosSettings,
  uploadAndroidScreenshots,
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
// router.patch(
//   "/settings/android/featureGraphic/:appId",
//   ...updateAndroidFeatureGraphic,
// );
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

router.patch("/:appId/settings/ios/build", ...updateBuildMetadataIosSettings);
router.patch("/:appId/settings/ios/store", ...updateStoreMetadataIosSettings);
router.patch("/:appId/settings/ios/info", ...updateInfoMetadataIosSettings);
router.patch("/:appId/settings/ios/review", ...updateReviewMetadataIosSettings);
// router.patch("/:appId/settings/ios/screenshots/upload", ...uploadIosScreenshots);
// router.patch(
//   "/:appId/settings/ios/screenshots/reorder",
//   ...updateIosScreenshotsOrder,
// );
// router.delete("/:appId/settings/ios/screenshots", ...deleteIosScreenshots);

export default router;
