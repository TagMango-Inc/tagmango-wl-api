import "dotenv/config";

import { Hono } from "hono";
import {
  createNewDashboardUser,
  deleteDashboardUser,
  getAllDashboardUsers,
  getCurrentUser,
  resendEmailVerification,
  updateDashboardUser,
  updateDashboardUserPassword,
} from "src/controllers/usermangement";

const router = new Hono();

router.get("/users", ...getAllDashboardUsers);
router.get("/users/me", ...getCurrentUser);

router.post("/users", ...createNewDashboardUser);
router.post("/users/:id/resend-verification-email", ...resendEmailVerification);

router.patch("/users", ...updateDashboardUser);
router.patch("/users/update-password", ...updateDashboardUserPassword);

router.delete("/users/:id", ...deleteDashboardUser);

export default router;
