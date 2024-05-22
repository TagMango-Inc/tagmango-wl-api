import Mongo from "../database";
import { populateMeilisearch } from "./populate-meilisearch";

const runMigration = async () => {
  // Run your migration here
  console.log("Migration ran successfully");
  await populateMeilisearch();
};

Mongo.connect().then(() => {
  runMigration()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
});
