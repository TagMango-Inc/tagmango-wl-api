import { Hono } from "hono";

import { getMachineHealth } from "../controllers/machineHealth";

const router = new Hono();

router.get("/", ...getMachineHealth);

export default router;
