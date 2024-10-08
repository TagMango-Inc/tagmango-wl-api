import Mongo from '../database';
import { populateAppForms } from './populateAppForms';

const runMigration = async () => {
  // Run your migration here
  // await populateMeilisearch();
  await populateAppForms();
  console.log("Migration ran successfully");
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
