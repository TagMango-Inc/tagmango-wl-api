import 'dotenv/config';

import { MeiliSearch } from 'meilisearch';

import Mongo from '../database';

const client = new MeiliSearch({
  host: "http://localhost:7700",
  apiKey: process.env.MEILI_MASTER_KEY,
});

async function populateMeilisearch() {
  // const resp = await client.index("customhosts").search("acharya");
  // console.log(resp.hits);
  // console.log(resp.processingTimeMs);

  //   await client.deleteTasks({ uids: [0, 1, 2] });

  await Mongo.connect().then(async () => {
    const customhosts = await Mongo.customhost
      .aggregate([
        {
          $match: {
            whitelableStatus: { $ne: "drafted" },
          },
        },
        {
          $lookup: {
            from: "customhostmetadatas",
            localField: "deploymentMetadata",
            foreignField: "_id",
            as: "deploymentDetails",
          },
        },
        {
          $unwind: {
            path: "$deploymentDetails",
          },
        },
        {
          $project: {
            _id: 1,
            appName: 1,
            host: 1,
            logo: 1,
            createdAt: 1,
            updatedAt: 1,
            androidVersionName:
              "$deploymentDetails.androidDeploymentDetails.versionName",
            iosVersionName:
              "$deploymentDetails.iosDeploymentDetails.versionName",
            iosUnderReview:
              "$deploymentDetails.iosDeploymentDetails.isUnderReview",
          },
        },
      ])
      .toArray();
    const resp = await client.index("customhosts").addDocuments(customhosts, {
      primaryKey: "_id",
    });
    console.log(resp);
  });

  console.log(await client.getStats());

  // await client.deleteIndexIfExists("customhosts");
}

populateMeilisearch()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
