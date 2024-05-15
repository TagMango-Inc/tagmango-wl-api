import { Hono } from "hono";

import {
  createOrRevokeSubscription,
  getAllMangoesByCreator,
  updateIapProductIds,
  updateMangoIapDetails,
} from "../../src/controllers/iap";

const router = new Hono();

router.get("/mangoes-by-creator/:creatorId", ...getAllMangoesByCreator);

router.patch("/update-product-ids", ...updateIapProductIds);

router.patch("/mangoes/:mangoId", ...updateMangoIapDetails);

router.post("/subscriptions/:mangoId", ...createOrRevokeSubscription);

export default router;
