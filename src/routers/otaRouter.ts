import "dotenv/config";

import { Hono } from "hono";

import {
  handleAssetsRequest,
  handleManifestRequest,
  handleUploadUpdateRequest,
} from "../controllers/otaController";

const router = new Hono();

router.get("/assets", ...handleAssetsRequest);
router.get("/manifest", ...handleManifestRequest);
router.post("/upload", ...handleUploadUpdateRequest);

export default router;
