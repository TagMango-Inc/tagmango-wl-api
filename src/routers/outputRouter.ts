import "dotenv/config";

import { Hono } from "hono";

import { getAllaabDetails } from "../controllers/output";

const router = new Hono();

router.get("/android/aab", ...getAllaabDetails);

export default router;
