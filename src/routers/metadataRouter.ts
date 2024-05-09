import { Hono } from "hono";
import {
  createMetadata,
  getAppMetadata,
  updateMetadataAndroidSettings,
  updateMetadataIosSettings,
  uploadMetadataLogo,
} from "src/controllers/metadata";

const router = new Hono();

router.get("/:appId", ...getAppMetadata);
router.post("/:appId", ...createMetadata);
router.patch("/settings/logo/upload/:appId", ...uploadMetadataLogo);
router.patch("/settings/android/:appId", ...updateMetadataAndroidSettings);
router.patch("/settings/ios/:appId", ...updateMetadataIosSettings);

export default router;
