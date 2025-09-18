import "dotenv/config";

import { Worker } from "bullmq";
import fs from "fs-extra";
import { ObjectId, WithId } from "mongodb";
import pino from "pino";

import Mongo from "../../src/database";
import {
  IDeveloperAccountAndroid,
  IDeveloperAccountIos,
  Status,
} from "../../src/types/database";
import { DEFAULT_IOS_DEVELOPER_ACCOUNT_ID } from "../constants";
import { RedeploymentJobPayloadType } from "../types";
import { generateDeploymentTasks } from "../utils/generateTaskDetails";
import { buildQueue, queueRedisOptions } from "./config";

const logger = pino({
  level: "debug",
  msgPrefix: "[ REDEPLOYEMENT_WORKER ] ",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const { readFile, writeFile } = fs.promises;

(async () => {
  Mongo.connect()
    .then(() => {
      const worker = new Worker<RedeploymentJobPayloadType>(
        "redeploymentQueue",
        async (job) => {
          const {
            hostIds,
            platform: target,
            redeploymentId,
            userId,
          } = job.data;

          logger.info("Redeployment Worker Started");
          logger.info(`Target Platform: ${target}`);
          logger.info(`Total apps: ${hostIds.length}`);

          logger.info("Initiated Deployment Creation Process");

          await Mongo.redeployment.updateOne(
            {
              _id: new ObjectId(redeploymentId),
            },
            {
              $set: {
                status: "processing",
                updatedAt: new Date(),
              },
            },
          );

          logger.info("Deployment Creation Status Changed to Processing");

          // some day use this for real time progress
          // job.updateProgress({
          //   task: {
          //     id: taskId,
          //     name: taskName,
          //     type: "initialised",
          //     duration: 0,
          //   },
          //   type: "success",
          //   message: `Initialized task [ ${taskName} ]`,
          //   timestamp: new Date(),
          // } as JobProgressType);

          for (const hostId of hostIds) {
            logger.info(`Deployment Creation for hostId: ${hostId}`);
            try {
              const recentActiveDeployment = await Mongo.deployment.findOne({
                host: new ObjectId(hostId),
                status: { $in: [Status.PENDING, Status.PROCESSING] },
                platform: target,
              });

              if (recentActiveDeployment) {
                const { _id, versionName, platform } = recentActiveDeployment;
                const jobName = `${_id}-${platform}-${versionName}`;
                const jobs = await buildQueue.getJobs();
                const job = jobs.find((job) => job.name === jobName);
                if (job) {
                  const jobStatus = await job.getState();
                  if (jobStatus === "active" || jobStatus === "waiting") {
                    logger.info(
                      `Deployment for host ${hostId} is already in progress`,
                    );

                    await Mongo.redeployment.updateOne(
                      {
                        _id: new ObjectId(redeploymentId),
                      },
                      {
                        $inc: { "progress.completed": 1 },
                        $push: {
                          "progress.failed": {
                            hostId: new ObjectId(hostId),
                            reason: "Deployment is already in progress",
                          },
                        },
                      },
                    );

                    continue;
                  }
                }
              }

              const customhost = await Mongo.customhost.findOne({
                _id: new ObjectId(hostId),
              });

              const metadata = await Mongo.metadata.findOne({
                host: new ObjectId(hostId),
              });

              if (!customhost) {
                logger.error(`Custom host not found for hostId: ${hostId}`);
                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason: "Custom host not found",
                      },
                    },
                  },
                );

                continue;
              }

              if (!metadata) {
                logger.error(`Metadata not found for hostId: ${hostId}`);
                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason: "Metadata not found",
                      },
                    },
                  },
                );

                continue;
              }

              if (
                target === "android" &&
                metadata.androidDeploymentDetails.isDeploymentBlocked
              ) {
                logger.error(
                  `Android deployment is blocked for hostId: ${hostId}`,
                );

                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason:
                          metadata.androidDeploymentDetails
                            .deploymentBlockReason,
                      },
                    },
                  },
                );
                continue;
              }

              if (
                target === "ios" &&
                metadata.iosDeploymentDetails.isDeploymentBlocked
              ) {
                logger.error(`iOS deployment is blocked for hostId: ${hostId}`);

                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason:
                          metadata.iosDeploymentDetails.deploymentBlockReason,
                      },
                    },
                  },
                );

                continue;
              }

              if (!customhost.appName) {
                logger.error(`App Name is required for hostId: ${hostId}`);
                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason: "App Name is required",
                      },
                    },
                  },
                );

                continue;
              }

              if (target === "ios" && !metadata.iosDeploymentDetails.bundleId) {
                logger.error(
                  `Bundle ID for iOS is required for hostId: ${hostId}`,
                );
                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason: "Bundle ID for iOS is required",
                      },
                    },
                  },
                );

                continue;
              }

              if (
                target === "android" &&
                !metadata.androidDeploymentDetails.bundleId
              ) {
                logger.error(
                  `Bundle ID for Android is required for hostId: ${hostId}`,
                );
                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason: "Bundle ID for Android is required",
                      },
                    },
                  },
                );

                continue;
              }

              if (!customhost.onesignalAppId) {
                logger.error(
                  `OneSignal App ID is required for hostId: ${hostId}`,
                );
                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason: "OneSignal App ID is required",
                      },
                    },
                  },
                );

                continue;
              }

              let androidDeveloperAccount: WithId<IDeveloperAccountAndroid> | null =
                null;
              let iosDeveloperAccount: WithId<IDeveloperAccountIos> | null =
                null;

              if (target === "android" && metadata.androidDeveloperAccount) {
                androidDeveloperAccount =
                  await Mongo.developer_accounts_android.findOne({
                    _id: metadata.androidDeveloperAccount,
                  });
              } else if (target === "ios") {
                // NOTE: After migrations, all the metadata were linked to old developer account
                // for new metadatas, we need to link to default ios developer account and save

                if (metadata.iosDeveloperAccount) {
                  iosDeveloperAccount =
                    await Mongo.developer_accounts_ios.findOne({
                      _id: metadata.iosDeveloperAccount,
                    });
                } else {
                  iosDeveloperAccount =
                    await Mongo.developer_accounts_ios.findOne({
                      _id: new ObjectId(DEFAULT_IOS_DEVELOPER_ACCOUNT_ID), // default ios developer account id
                    });

                  // save the default ios developer account id to the metadata
                  await Mongo.metadata.updateOne(
                    { host: new ObjectId(customhost._id) },
                    {
                      $set: {
                        iosDeveloperAccount: new ObjectId(
                          DEFAULT_IOS_DEVELOPER_ACCOUNT_ID,
                        ),
                      },
                    },
                  );
                }
              }

              if (target === "ios" && !iosDeveloperAccount) {
                logger.error(
                  `iOS Developer Account not found for hostId: ${hostId}`,
                );
                await Mongo.redeployment.updateOne(
                  {
                    _id: new ObjectId(redeploymentId),
                  },
                  {
                    $inc: { "progress.completed": 1 },
                    $push: {
                      "progress.failed": {
                        hostId: new ObjectId(hostId),
                        reason: "iOS Developer Account not found",
                      },
                    },
                  },
                );

                continue;
              }

              const { lastDeploymentDetails } =
                target === "android"
                  ? metadata.androidDeploymentDetails
                  : metadata.iosDeploymentDetails;
              const {
                versionName: lastDeploymentVersionName,
                buildNumber: lastDeploymentBuildNumber,
              } = lastDeploymentDetails;

              const releaseBuffer = await fs.promises.readFile(
                `./data/release.json`,
                "utf-8",
              );
              const releaseDetails = JSON.parse(releaseBuffer) as {
                versionName: string;
                buildNumber: number;
              };

              let currentVersionName = releaseDetails.versionName;
              let currentBuildNumber = releaseDetails.buildNumber;

              if (
                lastDeploymentVersionName &&
                lastDeploymentBuildNumber &&
                lastDeploymentVersionName === currentVersionName
              ) {
                currentBuildNumber = lastDeploymentBuildNumber + 1;
              }
              const updateQuery =
                target === "android"
                  ? {
                      "androidDeploymentDetails.lastDeploymentDetails.buildNumber":
                        currentBuildNumber,
                      "androidDeploymentDetails.lastDeploymentDetails.versionName":
                        currentVersionName,
                    }
                  : {
                      "iosDeploymentDetails.lastDeploymentDetails.buildNumber":
                        currentBuildNumber,
                      "iosDeploymentDetails.lastDeploymentDetails.versionName":
                        currentVersionName,
                    };

              logger.info(`Updating metadata for hostId: ${hostId}`);
              await Mongo.metadata.updateOne(
                {
                  host: new ObjectId(hostId),
                },
                {
                  $set: {
                    ...updateQuery,
                  },
                },
              );

              logger.info(`Creating Deployment for hostId: ${hostId}`);
              // populating the tasks with name and id
              const tasks = generateDeploymentTasks({
                bundle:
                  target === "android"
                    ? metadata.androidDeploymentDetails.bundleId
                    : metadata.iosDeploymentDetails.bundleId,
                formatedAppName: (target === "android"
                  ? metadata.androidStoreSettings.title
                  : metadata.iosStoreSettings.name
                ).replace(/ /g, ""),
                platform: target,
              });
              // creating a new deployment
              const createdDeployment = await Mongo.deployment.insertOne({
                host: new ObjectId(hostId),
                user: new ObjectId(userId),
                platform: target,
                versionName: currentVersionName,
                buildNumber: currentBuildNumber,
                tasks,
                status: Status.PENDING,
                cancelledBy: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                isFirstDeployment: false,
                generateIAPScreenshot: false,
                redeploymentId: new ObjectId(redeploymentId),
              });

              await buildQueue.add(
                `${createdDeployment.insertedId.toString()}-${target}-${currentVersionName}`,
                {
                  deploymentId: createdDeployment.insertedId.toString(),
                  hostId: hostId,
                  name:
                    (target === "android"
                      ? metadata.androidStoreSettings.title
                      : metadata.iosStoreSettings.name) ?? customhost.appName,
                  appName: customhost.appName,
                  bundle:
                    target === "android"
                      ? metadata.androidDeploymentDetails.bundleId
                      : metadata.iosDeploymentDetails.bundleId,
                  domain: customhost.host,
                  color: customhost.colors.PRIMARY,
                  bgColor: metadata.backgroundStartColor,
                  onesignal_id: customhost.onesignalAppId,
                  platform: target,
                  versionName: currentVersionName,
                  buildNumber: currentBuildNumber,
                  appleId: metadata.iosDeploymentDetails.appleId || "",

                  androidStoreSettings: metadata.androidStoreSettings,

                  iosStoreSettings: metadata.iosStoreSettings,
                  iosInfoSettings: metadata.iosInfoSettings,
                  iosReviewSettings: metadata.iosReviewSettings,

                  generateIAPScreenshot: false,

                  androidDeveloperAccount,
                  iosDeveloperAccount,
                  isFirstDeployment: false,
                },
                {
                  attempts: 0,
                },
              );

              logger.info(`Deployment Created for hostId: ${hostId}`);

              await Mongo.redeployment.updateOne(
                {
                  _id: new ObjectId(redeploymentId),
                },
                {
                  $inc: { "progress.completed": 1 },
                  $push: {
                    "progress.success": new ObjectId(hostId),
                  },
                },
              );
            } catch (error) {
              logger.error(
                `Failed creation of deployment for hostId:${hostId}`,
              );

              await Mongo.redeployment.updateOne(
                {
                  _id: new ObjectId(redeploymentId),
                },
                {
                  $inc: { "progress.completed": 1 },
                  $push: {
                    "progress.failed": {
                      hostId: new ObjectId(hostId),
                      reason: JSON.stringify(error),
                    },
                  },
                },
              );

              logger.info("Deployment Status Changed to Failed");
            }
          }

          await Mongo.redeployment.updateOne(
            {
              _id: new ObjectId(redeploymentId),
            },
            {
              $set: {
                status: "success",
                updatedAt: new Date(),
              },
            },
          );

          logger.info("Deployment Creation Process Completed");
        },
        {
          connection: queueRedisOptions,
          concurrency: 1,
        },
      );

      worker.on("stalled", (job) => {
        logger.error(`Job has been stalled ${job}`);
      });

      logger.info("Worker Started");
    })
    .catch((error) => {
      logger.error(error, "Failed to connect to the database");
    });
})();
