import "dotenv/config";

import { Hono } from "hono";

import {
  createNewDashboardUser,
  getAllDashboardUsers,
  getCurrentUser,
  updateDashboardUser,
  updateDashboardUserPassword,
} from "../../src/controllers/usermangement";

const router = new Hono();

router.get("/users", ...getAllDashboardUsers);
router.get("/users/me", ...getCurrentUser);

router.post("/users", ...createNewDashboardUser);

router.patch("/users", ...updateDashboardUser);
router.patch("/users/update-password", ...updateDashboardUserPassword);

export default router;
