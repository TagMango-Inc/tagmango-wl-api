import "dotenv/config";

import { MeiliSearch } from "meilisearch";

import Mongo from "../database";

const client = new MeiliSearch({
  host: "http://localhost:7700",
  apiKey: process.env.MEILI_MASTER_KEY,
});

async function populateMeilisearch() {
  const customhosts = await Mongo.customhost
    .aggregate([
      {
        $match: {
          whitelableStatus: { $ne: "drafted" },
        },
      },
      {
        $project: {
          _id: 1,
          appName: 1,
          host: 1,
          logo: 1,
        },
      },
    ])
    .toArray();

  const resp = await client.index("customhosts").addDocuments(customhosts, {
    primaryKey: "_id",
  });

  console.log(resp);
  console.log(await client.getStats());
}

export { populateMeilisearch };
