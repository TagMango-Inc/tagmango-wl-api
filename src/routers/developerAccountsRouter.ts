import { Hono } from "hono";

import {
  createNewDeveloperAccountAndroidHandler,
  getAllDeveloperAccountsAndroidHandler,
  getAllDeveloperAccountsIosHandler,
  getDeveloperAccountAndroidByIdHandler,
  getUploadKeyCertificate,
} from "../controllers/developerAccounts";

const router = new Hono();

// get all developer accounts android
router.get("/android", ...getAllDeveloperAccountsAndroidHandler);

// get developer account android by id
router.get("/android/:id", ...getDeveloperAccountAndroidByIdHandler);

router.get("/android/:id/get-upload-key", ...getUploadKeyCertificate);
// create new developer account android
router.post("/android", ...createNewDeveloperAccountAndroidHandler);

// get all developer accounts ios
router.get("/ios", ...getAllDeveloperAccountsIosHandler);

export default router;
