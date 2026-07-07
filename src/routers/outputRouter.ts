import "dotenv/config";

import { Hono } from "hono";

import { deleteAabById, getAllaabDetails } from "../controllers/output";

const router = new Hono();

router.get("/android/aab", ...getAllaabDetails);
router.delete("/android/aab/:id", ...deleteAabById);

export default router;
