import { Hono } from "hono";
import {
  createMetadata,
  updateMetadataAndroidSettings,
  updateMetadataIosSettings,
  uploadMetadataLogo,
} from "src/controllers/metadata";

const router = new Hono();

router.post("/:appId", ...createMetadata);
router.patch("/settings/logo/upload/:appId", ...uploadMetadataLogo);
router.patch("/settings/android/:appId", ...updateMetadataAndroidSettings);
router.patch("/settings/ios/:appId", ...updateMetadataIosSettings);

export default router;
