import Mongo from "../database";

const runMigration = async () => {
  // Run your migration here
  console.log("Migration ran successfully");
};

Mongo.connect().then(() => {
  runMigration();
});
