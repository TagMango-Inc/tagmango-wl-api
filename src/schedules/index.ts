import { exec } from "child_process";
import fs from "fs-extra";
import jwt from "jsonwebtoken";
import cron from "node-cron";
import util from "util";

import { Types } from "mongoose";
import {
  CLEANUP_DEPLOYMENT_FOLDERS_CRON,
  CLEANUP_DEPLOYMENT_REQUESTS_CRON,
  DEPLOYMENT_REQUEST_RETENTION_DAYS,
  UPDATE_ANDROID_PLAY_STORE_STATUS_CRON,
  UPDATE_IOS_REVIEW_STATUS_CRON,
  UPDATE_PRE_REQ_CRON,
} from "../constants";
import Mongo from "../database";
import { getEnterpriseHosts } from "../utils/enterpriseHostsCache";
import { cleanupDeploymentFolders } from "./cleanup-deployment-folders";
import { updatePlayStoreStatus } from "./play-store-status";
import { scheduleRemoveBundles } from "./remove-bundle";

const execAsync = util.promisify(exec);

const { readFile, writeFile } = fs.promises;

// list all the cron jobs to be run here

// pm2 runs this file as a cluster; every instance would run every job (two
// ASC/Play status sweeps, two cleanups racing on the same folders). Only the
// first instance schedules anything.
const isPrimaryInstance = (process.env.NODE_APP_INSTANCE ?? "0") === "0";
if (!isPrimaryInstance) {
  console.log(`cron instance ${process.env.NODE_APP_INSTANCE}: idle, instance 0 runs the schedules`);
  // stay up so pm2 doesn't restart it in a loop
  setInterval(() => {}, 1 << 30);
}

// cron to update ios review status
(isPrimaryInstance ? Mongo.connect() : new Promise<never>(() => {})).then(() => {
  scheduleRemoveBundles();

  cron.schedule(UPDATE_IOS_REVIEW_STATUS_CRON, async () => {
    console.log("Running update-ios-review-status schedule");

    const releaseDoc = await Mongo.app_release_versions.findOne({});
    const latestAvailableVersionName = releaseDoc?.versionName;
    if (!latestAvailableVersionName) {
      console.log(
        "No appreleaseversions document found, deployment requests will not auto-complete this run",
      );
    }

    // Check non-suspended enterprise hosts that have an apple id. The status
    // comes from the App Store Connect API, so the App Store link isn't needed
    // (apps in their first review don't have one yet). Skip hosts whose App
    // Store version already matches the global AppZap target and is live; a
    // target version still in review keeps being checked until it goes live.
    // When the target is unknown, check them all.
    const { activeIds } = await getEnterpriseHosts();

    const allMetadatas = await Mongo.metadata
      .find({
        host: { $in: activeIds },
        "iosDeploymentDetails.appleId": { $type: "string", $ne: "" },
        ...(latestAvailableVersionName && {
          $nor: [
            {
              "iosDeploymentDetails.appStore.versionName":
                latestAvailableVersionName,
              "iosDeploymentDetails.appStore.status": {
                $in: ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"],
              },
            },
          ],
        }),
      })
      .toArray();

    console.log(allMetadatas.length, " <- total metadata found");

    let count = 0;

    for (const metadata of allMetadatas) {
      try {
        let appleId = metadata.iosDeploymentDetails.appleId;

        if (!appleId) {
          console.log("apple id not found for bundleId", metadata.host);
          continue;
        }

        const iosDeveloperAccount = await Mongo.developer_accounts_ios.findOne({
          _id: metadata.iosDeveloperAccount,
        });

        if (!iosDeveloperAccount) {
          console.log(
            "ios developer account not found for bundleId",
            metadata.host,
          );
          continue;
        }

        const privateKey = await readFile(
          `./developer_accounts/ios/${iosDeveloperAccount._id}/asc_api_pk.p8`,
          "utf-8",
        );

        let token = jwt.sign({}, privateKey, {
          algorithm: "ES256",
          expiresIn: "5m",
          issuer: iosDeveloperAccount.ascApiKeyIssuer,
          audience: "appstoreconnect-v1",
          keyid: iosDeveloperAccount.ascApiKeyId,
        });

        const res = await fetch(
          `https://api.appstoreconnect.apple.com/v1/apps/${appleId}/appStoreVersions?limit=1`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        let data = await res.json();

        if (data?.data?.length > 0) {
          const appDetails = data.data[0];
          const appVersion = appDetails.attributes.versionString;
          const appVersionState = appDetails.attributes.appVersionState;

          console.log(appVersion, appVersionState);
          await Mongo.metadata.findOneAndUpdate(
            {
              host: metadata.host,
            },
            {
              $set: {
                "iosDeploymentDetails.appStore.versionName": appVersion,
                "iosDeploymentDetails.appStore.status": appVersionState,
              },
            },
          );
          count++;

          // Only flip when the live App Store version matches the latest
          // release AppZap is pushing to all hosts. Versions in review or
          // otherwise non-live are left alone.
          const isLive =
            appVersionState === "READY_FOR_SALE" ||
            appVersionState === "READY_FOR_DISTRIBUTION";

          if (
            latestAvailableVersionName &&
            appVersion === latestAvailableVersionName &&
            isLive
          ) {
            const flipResult = await Mongo.deployment_requests.updateOne(
              { host: metadata.host, "ios.status": "processing" },
              {
                $set: {
                  "ios.status": "success",
                  updatedAt: new Date(),
                },
              },
            );
            if (flipResult.modifiedCount > 0) {
              console.log(
                `Marked ios deployment request as success for host ${metadata.host}`,
              );
            }
          }
        }
      } catch (error) {
        console.log(error);
      }
    }

    console.log("total updated", count);
  });

  cron.schedule(UPDATE_PRE_REQ_CRON, async () => {
    const hosts = await Mongo.customhost
      .aggregate([
        {
          $match: {
            platformSuspended: { $ne: true },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "creator",
            foreignField: "_id",
            as: "creatorDetails",
          },
        },
        {
          $match: {
            "creatorDetails.whitelabelPlanType": "enterprise-plan",
          },
        },
        {
          $project: {
            _id: 1,
            host: 1,
            creator: 1,
            logo: 1,
          },
        },
      ])
      .toArray();

    console.log(hosts.length, " <- total hosts found");

    // Process hosts in batches of 10
    const batchSize = 10;
    for (let i = 0; i < hosts.length; i += batchSize) {
      const batch = hosts.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(hosts.length / batchSize)}`,
      );

      for (const hostDetails of batch) {
        console.log("Running for host id and url -> ", hostDetails._id);

        const creatorMangoes = await Mongo.mango
          .find({
            creator: hostDetails.creator,
            isHidden: {
              $ne: true,
            },
            isStopTakingPayment: {
              $ne: true,
            },
            $or: [
              {
                end: {
                  $gte: new Date(),
                },
              },
              {
                end: undefined,
              },
            ],
            isPublic: {
              $ne: true,
            },
            isDeleted: {
              $ne: true,
            },
            recurringType: "onetime",
            price: { $gt: 0 },
          })
          .toArray();

        const mangoIdArray = creatorMangoes.map((m) => m._id);

        const prerequisites = (isPostCourseAndRoomCreated: boolean) => [
          {
            isCompleted: !!mangoIdArray.length,
          },
          {
            isCompleted: isPostCourseAndRoomCreated,
          },
          {
            isCompleted:
              hostDetails.logo &&
              hostDetails.logo !==
                "https://assets.website-files.com/6302e597fbb6ee54fbee3b8a/630c8a92c693d29110158998_logocirclecolored.png"
                ? true
                : false,
          },
        ];

        const postsByMangoesPromise = await Mongo.post
          .find(
            {
              creator: hostDetails.creator,
              mangoArr: {
                $in: mangoIdArray,
              },
              isDeleted: {
                $ne: true,
              },
            },
            {
              projection: { _id: 1, mangoArr: 1 },
            },
          )
          .toArray();

        const coursesByMangoesPromise = await Mongo.course
          .find(
            {
              creator: hostDetails.creator,
              isPublished: true,
              isDripped: {
                $ne: true,
              },
              mangoArr: {
                $in: mangoIdArray,
              },
            },
            {
              projection: { _id: 1, mangoArr: 1 },
            },
          )
          .toArray();

        const [allPosts, allCourses] = await Promise.all([
          postsByMangoesPromise,
          coursesByMangoesPromise,
        ]);

        let allCoursesByChapterFilter: Types.ObjectId[] = [];

        if (allCourses && allCourses.length) {
          allCoursesByChapterFilter = (await Mongo.chapter.distinct("course", {
            creator: hostDetails.creator,
            course: {
              $in: allCourses.map((c) => c._id),
            },
            contentType: "video",
          })) as unknown as Types.ObjectId[];
        }

        const mangoList = creatorMangoes.map((mango) => {
          const mangoIdString = mango._id.toString();

          const relatedPosts = allPosts
            ? allPosts.reduce<Types.ObjectId[]>((acc, post) => {
                if (post.mangoArr.some((m) => m.toString() === mangoIdString)) {
                  acc.push(post._id);
                }
                return acc;
              }, [])
            : [];

          const allCoursesForThisMango = allCourses.filter((course) =>
            course.mangoArr?.find((m) => m.toString() === mangoIdString),
          );

          const relatedCourses = allCoursesByChapterFilter.length
            ? allCoursesByChapterFilter.map(
                (course) =>
                  allCoursesForThisMango.find(
                    (c) => c._id.toString() === course.toString(),
                  )?._id,
              )
            : [];

          return {
            _id: mango._id,
            title: mango.title,
            relatedPosts: relatedPosts.length > 0,
            relatedRooms: true,
            relatedCourses:
              relatedCourses.length > 0 &&
              relatedCourses.filter(Boolean).length > 0,
          };
        });

        const isPostCourseRoomLinkedWithOneMangoExists =
          mangoList.filter(
            (mango) =>
              mango.relatedPosts && mango.relatedCourses && mango.relatedRooms,
          ).length > 0;

        const pr = prerequisites(isPostCourseRoomLinkedWithOneMangoExists);

        const isPreReqCompleted = pr.every(
          (prerequisite) => prerequisite.isCompleted,
        );

        console.log(isPreReqCompleted, " <- isPreReqCompleted");

        await Mongo.metadata.updateOne(
          {
            host: hostDetails._id,
          },
          {
            $set: {
              isPreReqCompleted: isPreReqCompleted,
            },
          },
        );
      }

      // Wait for 10 seconds before processing the next batch (except for the last batch)
      if (i + batchSize < hosts.length) {
        console.log("Waiting 10 seconds before processing next batch...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  });

  // cron to update android play store status from Google Play
  // (google-play-scraper, see ./play-store-status.ts)
  cron.schedule(UPDATE_ANDROID_PLAY_STORE_STATUS_CRON, updatePlayStoreStatus);

  // Cron to cleanup completed deployment requests older than 7 days
  cron.schedule(CLEANUP_DEPLOYMENT_REQUESTS_CRON, async () => {
    console.log("Running cleanup-deployment-requests schedule");

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DEPLOYMENT_REQUEST_RETENTION_DAYS);

    try {
      // Delete deployment requests where all existing platforms have status "success"
      // and updatedAt is older than cutoff date
      const deleteResult = await Mongo.deployment_requests.deleteMany({
        updatedAt: { $lt: cutoffDate },
        $or: [
          // Both platforms exist and are successful
          {
            "android.status": "success",
            "ios.status": "success",
          },
          // Only android exists and is successful
          {
            "android.status": "success",
            ios: { $exists: false },
          },
          // Only ios exists and is successful
          {
            "ios.status": "success",
            android: { $exists: false },
          },
        ],
      });

      console.log(
        `Deleted ${deleteResult.deletedCount} completed deployment requests older than ${DEPLOYMENT_REQUEST_RETENTION_DAYS} days`,
      );
    } catch (error) {
      console.error("Error cleaning up deployment requests:", error);
    }
  });

  // Cron to remove deployments/<bundle>-<platform> folders older than 48 hours
  cron.schedule(CLEANUP_DEPLOYMENT_FOLDERS_CRON, async () => {
    console.log("Running cleanup-deployment-folders schedule");
    await cleanupDeploymentFolders();
  });
});
