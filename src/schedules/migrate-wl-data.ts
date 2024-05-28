import cron from "node-cron";

import { MIGRATE_CRON } from "../constants";
import Mongo from "../database";
import { populateMeilisearch } from "../migrations/populate-meilisearch";

Mongo.connect().then(() => {
  cron.schedule(MIGRATE_CRON, async () => {
    await populateMeilisearch();
  });
});
