import "dotenv/config";

import { Hono } from "hono";

import {
  freeupSpace,
  getDeviceSpace,
  getReleaseDetails,
  updateReleaseDetails,
} from "../controllers/release";

const router = new Hono();

router.get("/", ...getReleaseDetails);
router.patch("/", ...updateReleaseDetails);

router.get("/space", ...getDeviceSpace);
router.post("/free", ...freeupSpace);

export default router;
