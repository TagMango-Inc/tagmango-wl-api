import 'dotenv/config';

import { Hono } from 'hono';

import {
  getReleaseDetails,
  updateReleaseDetails,
} from '../controllers/release';

const router = new Hono();

router.get("/", ...getReleaseDetails);
router.patch("/", ...updateReleaseDetails);

export default router;
