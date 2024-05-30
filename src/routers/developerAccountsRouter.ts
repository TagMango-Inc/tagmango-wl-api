import { Hono } from "hono";

import {
  createNewDeveloperAccountAndroidHandler,
  getAllDeveloperAccountsAndroidHandler,
  getDeveloperAccountAndroidByIdHandler,
} from "../controllers/developerAccounts";

const router = new Hono();

// get all developer accounts android
router.get("/android", ...getAllDeveloperAccountsAndroidHandler);

// get developer account android by id
router.get("/android/:id", ...getDeveloperAccountAndroidByIdHandler);

// create new developer account android
router.post("/android", ...createNewDeveloperAccountAndroidHandler);

export default router;
