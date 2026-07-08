import fs from "fs-extra";
import { google } from "googleapis";
import { createFactory } from "hono/factory";
import jwt from "jsonwebtoken";
import { ObjectId, WithId } from "mongodb";
import path from "path";

import { zValidator } from "@hono/zod-validator";

import {
  DEFAULT_IOS_DEVELOPER_ACCOUNT_ID,
  DEPLOYMENT_REQUIREMENTS,
} from "../../src/constants";
import Mongo from "../../src/database";
import { publishDeploymentCancel } from "../../src/job/cancellation";
import { buildQueue, redeploymentQueue } from "../../src/job/config";
import { JWTPayloadType } from "../../src/types";
import {
  IDeveloperAccountAndroid,
  IDeveloperAccountIos,
  PlatformValues,
  Status,
  StatusValues,
} from "../../src/types/database";
import { generateDeploymentTasks } from "../../src/utils/generateTaskDetails";
import { escapeRegExp } from "../utils/regex";
import { Response } from "../../src/utils/statuscode";
import {
  createBulkReDeploymentSchema,
  createNewDeploymentSchema,
} from "../../src/validations/customhost";
import { updateFailedAndroidDeploymentSchema } from "../validations/deployment";

const { readFile } = fs.promises;

const factory = createFactory();

const getDeploymentDetails = factory.createHandlers(async (c) => {
  try {
    const { id, target } = c.req.param();
    const deploymentDetails = await Mongo.metadata
      .aggregate([
        {
          $match: {
            host: new ObjectId(id),
          },
        },
        {
          $project: {
            bundleId: {
              $cond: {
                if: {
                  $eq: [target, "android"],
                },
                then: "$androidDeploymentDetails.bundleId",
                else: "$iosDeploymentDetails.bundleId",
              },
            },
            versionName: {
              $cond: {
                if: {
                  $eq: [target, "android"],
                },
                then: "$androidDeploymentDetails.lastDeploymentDetails.versionName",
                else: "$iosDeploymentDetails.lastDeploymentDetails.versionName",
              },
            },
            buildNumber: {
              $cond: {
                if: {
                  $eq: [target, "android"],
                },
                then: "$androidDeploymentDetails.lastDeploymentDetails.buildNumber",
                else: "$iosDeploymentDetails.lastDeploymentDetails.buildNumber",
              },
            },
          },
        },
      ])
      .toArray();

    if (deploymentDetails.length === 0) {
      return c.json(
        { message: "Deployment details not found" },
        Response.NOT_FOUND,
      );
    }

    const releaseBuffer = await fs.promises.readFile(
      `./data/release.json`,
      "utf-8",
    );
    const releaseDetails = JSON.parse(releaseBuffer) as {
      versionName: string;
      buildNumber: number;
    };

    const deploymentDetail = deploymentDetails[0];
    let currentVersionName = releaseDetails.versionName;
    let currentBuildNumber = releaseDetails.buildNumber;

    if (
      deploymentDetail.versionName &&
      deploymentDetail.buildNumber &&
      deploymentDetail.versionName === currentVersionName
    ) {
      currentBuildNumber = deploymentDetail.buildNumber + 1;
    }

    return c.json(
      {
        message: "Fetched Deployment Details",
        result: {
          bundleId: deploymentDetail.bundleId,
          versionName: currentVersionName,
          buildNumber: currentBuildNumber,
        },
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 DEPLOYMENTS HANDLERS
*/

// get all deployments across all hosts

const getAllDeployments = factory.createHandlers(async (c) => {
  try {
    const { page, limit, search, platform, status, iosAppStoreStatus } =
      c.req.query();

    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 30;
    let SEARCH = search ? (search as string) : "";

    const matchStage = {
      $and: [
        ...(SEARCH
          ? [{ versionName: { $regex: new RegExp(escapeRegExp(SEARCH), "i") } }]
          : []),
        {
          platform: platform ?? { $in: PlatformValues },
        },
        {
          status: status ?? { $in: StatusValues },
        },
      ],
    };

    // deployment.host IS the customhost id, so metadata (keyed by the same id)
    // can be joined directly — the old pipeline joined customhosts first and
    // ran both lookups for EVERY matching deployment, in BOTH facet branches.
    // The metadata-based filter only constrains results when iosAppStoreStatus
    // is passed; otherwise sort/paginate first and join only the page.
    const displayStages = [
      {
        $lookup: {
          from: "customhosts",
          localField: "host",
          foreignField: "_id",
          as: "host",
          pipeline: [{ $project: { appName: 1, logo: 1 } }],
        },
      },
      { $unwind: "$host" },
      {
        $lookup: {
          from: "adminusers",
          localField: "user",
          foreignField: "_id",
          as: "user",
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "adminusers",
          let: { cancelledById: "$cancelledBy" },
          pipeline: [
            { $match: { $expr: { $ne: ["$$cancelledById", null] } } },
            { $match: { $expr: { $eq: ["$_id", "$$cancelledById"] } } },
            { $project: { _id: 1, name: 1 } },
          ],
          as: "cancelled_by_user",
        },
      },
      {
        $unwind: {
          path: "$cancelled_by_user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          "user._id": 1,
          "user.name": 1,
          "cancelled_by_user._id": 1,
          "cancelled_by_user.name": 1,
          host: "$host._id",
          platform: 1,
          versionName: 1,
          buildNumber: 1,
          status: 1,
          updatedAt: 1,
          createdAt: 1,
          appName: "$host.appName",
          appId: "$host._id",
          logo: "$host.logo",
          iosAppStore: {
            $cond: {
              if: { $eq: ["$platform", "ios"] },
              then: {
                status: "$metadata.iosDeploymentDetails.appStore.status",
                version: "$metadata.iosDeploymentDetails.appStore.versionName",
              },
              else: null,
            },
          },
        },
      },
    ];

    const metadataLookupStages = [
      {
        $lookup: {
          from: "customhostmetadatas",
          localField: "host",
          foreignField: "host",
          as: "metadata",
          pipeline: [
            {
              $project: {
                "iosDeploymentDetails.appStore.status": 1,
                "iosDeploymentDetails.appStore.versionName": 1,
              },
            },
          ],
        },
      },
      {
        $unwind: {
          path: "$metadata",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    const pipeline = iosAppStoreStatus
      ? [
          // status filter depends on metadata: join (projected) before paging
          { $match: matchStage },
          ...metadataLookupStages,
          {
            $match: {
              $or: [
                { platform: { $ne: "ios" } },
                {
                  $and: [
                    { platform: "ios" },
                    {
                      "metadata.iosDeploymentDetails.appStore.status":
                        iosAppStoreStatus,
                    },
                  ],
                },
              ],
            },
          },
          {
            $facet: {
              totalSearchResults: [{ $count: "count" }],
              deployments: [
                { $sort: { updatedAt: -1 } },
                { $skip: (PAGE - 1) * LIMIT },
                { $limit: LIMIT },
                ...displayStages,
              ],
            },
          },
        ]
      : [
          // no metadata filter: paginate on indexed fields, join only the page
          { $match: matchStage },
          {
            $facet: {
              totalSearchResults: [{ $count: "count" }],
              deployments: [
                { $sort: { updatedAt: -1 } },
                { $skip: (PAGE - 1) * LIMIT },
                { $limit: LIMIT },
                ...metadataLookupStages,
                ...displayStages,
              ],
            },
          },
        ];

    const searchedDeployments = await Mongo.deployment
      .aggregate([
        ...pipeline,
        {
          $unwind: {
            path: "$totalSearchResults",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            deployments: 1,
            totalDeployments: { $ifNull: ["$totalSearchResults.count", 0] },
          },
        },
      ])
      .toArray();

    const results =
      searchedDeployments.length > 0 && searchedDeployments[0].deployments
        ? searchedDeployments[0].deployments
        : [];

    const hasNextPage = searchedDeployments[0]?.totalDeployments > PAGE * LIMIT;

    return c.json(
      {
        message: "All Deployments for Custom Host",
        result: {
          deployments: results,
          totalDeployments: 0, //! no need for this
          totalSearchResults: searchedDeployments[0]?.totalDeployments,
          currentPage: PAGE,
          nextPage: hasNextPage ? PAGE + 1 : -1,
          limit: LIMIT,
          hasNext: hasNextPage,
        },
      },
      Response.OK,
    );
  } catch (error) {
    console.log(error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

// get all deployments for a host
const getAllDeploymentsHandler = factory.createHandlers(async (c) => {
  try {
    const { id: appId } = c.req.param();
    const { page, limit, search, platform, status } = c.req.query();

    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 30;
    let SEARCH = search ? (search as string) : "";

    const searchedDeployments = await Mongo.deployment
      .aggregate([
        {
          $match: {
            host: new ObjectId(appId),
            ...(SEARCH
              ? {
                  versionName: {
                    $regex: new RegExp(escapeRegExp(SEARCH), "i"),
                  },
                }
              : {}),
            platform: platform ?? { $in: PlatformValues },
            status: status ?? { $in: StatusValues },
          },
        },
        {
          $facet: {
            totalSearchResults: [
              {
                $count: "count",
              },
            ],
            deployments: [
              // paginate first — the adminusers joins then run for ≤LIMIT
              // rows instead of every deployment of the host
              {
                $sort: { updatedAt: -1 },
              },
              {
                $skip: (PAGE - 1) * LIMIT,
              },
              {
                $limit: LIMIT,
              },
              {
                $lookup: {
                  from: "adminusers",
                  localField: "user",
                  foreignField: "_id",
                  as: "user",
                  pipeline: [{ $project: { name: 1 } }],
                },
              },
              {
                $unwind: {
                  path: "$user",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "adminusers",
                  let: { cancelledById: "$cancelledBy" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $ne: ["$$cancelledById", null] },
                      },
                    },
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$cancelledById"] },
                      },
                    },
                    {
                      $project: { _id: 1, name: 1 },
                    },
                  ],
                  as: "cancelled_by_user",
                },
              },
              {
                $unwind: {
                  path: "$cancelled_by_user",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  "user._id": 1,
                  "user.name": 1,
                  "cancelled_by_user._id": 1,
                  "cancelled_by_user.name": 1,
                  host: 1,
                  platform: 1,
                  versionName: 1,
                  buildNumber: 1,
                  status: 1,
                  updatedAt: 1,
                  createdAt: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$totalSearchResults",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            deployments: 1,
            totalDeployments: { $ifNull: ["$totalSearchResults.count", 0] },
          },
        },
      ])
      .toArray();

    let parsedAndroidAABDetails = {} as Record<
      string,
      { versionName: string; buildNumber: number }
    >;
    try {
      const androidAABDetails = await readFile(
        "./data/android-aab.json",
        "utf-8",
      );
      parsedAndroidAABDetails = JSON.parse(androidAABDetails);
    } catch (error) {
      console.log(error);
    }

    const modifiedResults =
      searchedDeployments.length > 0 && searchedDeployments[0].deployments
        ? searchedDeployments[0].deployments.map((deployment: any) => {
            const aabDetails = parsedAndroidAABDetails[deployment.host];
            const isAndroidBundleAvailable =
              aabDetails &&
              aabDetails.versionName === deployment.versionName &&
              aabDetails.buildNumber === deployment.buildNumber
                ? true
                : false;
            return {
              ...deployment,
              isAndroidBundleAvailable,
            };
          })
        : [];

    const hasNextPage = searchedDeployments[0]?.totalDeployments > PAGE * LIMIT;

    return c.json(
      {
        message: "All Deployments for Custom Host",
        result: {
          deployments: modifiedResults,
          totalDeployments: 0, //! no need for this
          totalSearchResults: searchedDeployments[0]?.totalDeployments,
          currentPage: PAGE,
          nextPage: hasNextPage ? PAGE + 1 : -1,
          limit: LIMIT,
          hasNext: hasNextPage,
        },
      },
      Response.OK,
    );
  } catch (error) {
    console.log(error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const createNewDeploymentHandler = factory.createHandlers(
  zValidator("json", createNewDeploymentSchema),
  async (c) => {
    try {
      const { id: customHostId } = c.req.param();
      const { target, generateIAPScreenshot } = c.req.valid("json");
      const payload: JWTPayloadType = c.get("jwtPayload");

      if (!target) {
        return c.json(
          { message: "Deployment target is required" },
          Response.BAD_REQUEST,
        );
      }

      // pending or processing
      const recentActiveDeployment = await Mongo.deployment.findOne({
        host: new ObjectId(customHostId),
        status: { $in: [Status.PENDING, Status.PROCESSING] },
        platform: target,
      });

      if (recentActiveDeployment) {
        // deterministic job ids: direct lookup instead of a full queue scan
        const job = await buildQueue.getJob(
          recentActiveDeployment._id.toString(),
        );
        if (job) {
          const jobStatus = await job.getState();
          if (jobStatus === "active" || jobStatus === "waiting") {
            return c.json(
              { message: "Deployment job already exists" },
              Response.CONFLICT,
            );
          }
        }
      }

      const [user, customhost, metadata] = await Promise.all([
        Mongo.user.findOne(
          {
            _id: new ObjectId(payload.id),
          },
          { projection: { name: 1 } },
        ),
        Mongo.customhost.findOne({
          _id: new ObjectId(customHostId),
        }),
        Mongo.metadata.findOne({
          host: new ObjectId(customHostId),
        }),
      ]);

      if (!user) {
        return c.json({ message: "User not found" }, Response.NOT_FOUND);
      }
      if (!customhost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }
      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      if (
        target === "ios" &&
        metadata.iosDeploymentDetails.isDeploymentBlocked
      ) {
        return c.json(
          { message: metadata.iosDeploymentDetails.deploymentBlockReason },
          Response.BAD_REQUEST,
        );
      }

      if (
        target === "android" &&
        metadata.androidDeploymentDetails.isDeploymentBlocked
      ) {
        return c.json(
          { message: metadata.androidDeploymentDetails.deploymentBlockReason },
          Response.BAD_REQUEST,
        );
      }

      if (target === "ios" && !metadata.iosDeploymentDetails.bundleId) {
        return c.json(
          { message: "Bundle ID for iOS is required" },
          Response.BAD_REQUEST,
        );
      }

      if (target === "android" && !metadata.androidDeploymentDetails.bundleId) {
        return c.json(
          { message: "Bundle ID for Android is required" },
          Response.BAD_REQUEST,
        );
      }

      let androidDeveloperAccount: WithId<IDeveloperAccountAndroid> | null =
        null;
      let iosDeveloperAccount: WithId<IDeveloperAccountIos> | null = null;

      if (target === "android" && metadata.androidDeveloperAccount) {
        androidDeveloperAccount =
          await Mongo.developer_accounts_android.findOne({
            _id: metadata.androidDeveloperAccount,
          });
      } else if (target === "ios") {
        // NOTE: After migrations, all the metadata were linked to old developer account
        // for new metadatas, we need to link to default ios developer account and save

        if (metadata.iosDeveloperAccount) {
          iosDeveloperAccount = await Mongo.developer_accounts_ios.findOne({
            _id: metadata.iosDeveloperAccount,
          });
        } else {
          iosDeveloperAccount = await Mongo.developer_accounts_ios.findOne({
            _id: new ObjectId(DEFAULT_IOS_DEVELOPER_ACCOUNT_ID), // default ios developer account id
          });

          // save the default ios developer account id to the metadata
          await Mongo.metadata.updateOne(
            { host: new ObjectId(customHostId) },
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
        return c.json(
          { message: "iOS Developer Account not found" },
          Response.BAD_REQUEST,
        );
      }

      // update deep links for platform
      if (target === "android") {
        await Mongo.customhost.findOneAndUpdate(
          { _id: metadata.host }, // Filter to find the document
          {
            $set: {
              androidDeepLinkConfig: {
                relation: ["delegate_permission/common.handle_all_urls"],
                target: {
                  namespace: "android_app",
                  package_name: metadata.androidDeploymentDetails.bundleId,
                  sha256_cert_fingerprints: [
                    "72:2C:BF:A9:80:A7:53:ED:BF:10:39:6C:27:72:24:99:33:F9:DC:7B:5D:64:08:99:04:02:58:EA:07:C8:2F:54",
                    "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
                    "26:5D:F6:40:FD:0A:53:11:A2:5A:34:34:11:68:EE:B1:ED:20:59:08:8A:09:5B:A5:57:66:21:89:AC:31:93:3D",
                  ],
                },
              },
            },
          },
          { upsert: true }, // Enable upsert
        );
      } else if (target === "ios") {
        await Mongo.customhost.findOneAndUpdate(
          { _id: metadata.host }, // Filter to find the document
          {
            $set: {
              iosDeepLinkConfig: {
                applinks: {
                  apps: [],
                  details: [
                    {
                      appID: `${iosDeveloperAccount?.teamId}.${metadata.iosDeploymentDetails.bundleId}`,
                      paths: ["NOT /zoom*", "*"],
                    },
                  ],
                },
              },
            },
          },
          { upsert: true }, // Enable upsert
        );
      }

      if (!customhost.appName) {
        return c.json(
          { message: "Platform name is required" },
          Response.BAD_REQUEST,
        );
      }

      let newOneSignalId = "";
      if (!customhost.onesignalAppId) {
        let body = {
          name: customhost.appName,
          organization_id: process.env.ONESIGNAL_ORG_ID,
        } as Record<string, string>;

        if (target === "ios") {
          const apns_path = path.resolve(
            `./developer_accounts/ios/${iosDeveloperAccount?._id}/apns.p8`,
          );
          const isApnExist = await fs.pathExists(apns_path);

          if (!isApnExist) {
            return c.json(
              { message: "APN file not found for one-signal creation" },
              Response.BAD_REQUEST,
            );
          }
          const apns_p8 = await fs.readFile(apns_path, "base64");

          body = {
            ...body,
            apns_p8: apns_p8,
            apns_bundle_id: metadata.iosDeploymentDetails.bundleId,
            apns_team_id: iosDeveloperAccount?.teamId as string,
            apns_key_id: iosDeveloperAccount?.apnsKeyId as string,
            apns_env: "production",
          };
        } else if (target === "android") {
          const fcm_path = path.resolve("./fcm.json");
          const isFcmExist = await fs.pathExists(fcm_path);
          if (!isFcmExist) {
            return c.json(
              { message: "FCM file not found for one-signal creation" },
              Response.BAD_REQUEST,
            );
          }
          const fcm_v1_service_account_json = await fs.readFile(
            fcm_path,
            "base64",
          );
          body = {
            ...body,
            fcm_v1_service_account_json,
          };
        }

        // Make the request to OneSignal API to create an app
        const response = await fetch("https://api.onesignal.com/apps", {
          method: "POST",
          headers: {
            Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!data.id) {
          return c.json({ message: "Failed to create app", data }, 400);
        }

        newOneSignalId = data.id;

        // OneSignal no longer returns `basic_auth_key` from the create-app API.
        // Create a dedicated API key (token) for the new app and persist its
        // `formatted_token` — this is the REST API key used by tagmango-backend
        // to send notifications, and OneSignal returns it in plaintext only once.
        const tokenResponse = await fetch(
          `https://api.onesignal.com/apps/${data.id}/auth/tokens`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: customhost.appName }),
          },
        );

        const tokenData = await tokenResponse.json();

        if (!tokenData.formatted_token) {
          return c.json(
            { message: "Failed to create OneSignal API key", tokenData },
            Response.BAD_REQUEST,
          );
        }

        await Mongo.customhost.updateOne(
          {
            _id: new ObjectId(customHostId),
          },
          {
            $set: {
              onesignalAppId: data.id,
              customOneSignalApiKey: tokenData.formatted_token,
            },
          },
        );
      } else if (customhost.onesignalAppId) {
        const response = await fetch(
          `https://api.onesignal.com/apps/${customhost.onesignalAppId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
              "Content-Type": "application/json",
            },
          },
        );

        const data = await response.json();

        if ("errors" in data) {
          return c.json(
            { message: "Failed to fetch app details from OneSignal", data },
            Response.BAD_REQUEST,
          );
        }

        if (
          !data.apns_p8 ||
          !data.fcm_v1_service_account_json ||
          data.name !== customhost.appName
        ) {
          // on or the other platform setup is missing for the onesignal app

          let body = {} as Record<string, string>;

          if (!data.apns_p8 && target === "ios") {
            const apns_path = path.resolve(
              `./developer_accounts/ios/${iosDeveloperAccount?._id}/apns.p8`,
            );
            const isApnExist = await fs.pathExists(apns_path);

            if (!isApnExist) {
              return c.json(
                { message: "APN file not found for one-signal update" },
                Response.BAD_REQUEST,
              );
            }

            const apns_p8 = await fs.readFile(apns_path, "base64");

            body = {
              ...body,
              apns_p8,
              apns_bundle_id: metadata.iosDeploymentDetails.bundleId,
              apns_team_id: iosDeveloperAccount?.teamId as string,
              apns_key_id: iosDeveloperAccount?.apnsKeyId as string,
              apns_env: "production",
            };
          }

          if (!data.fcm_v1_service_account_json && target === "android") {
            const fcm_path = path.resolve("./fcm.json");
            const isFcmExist = await fs.pathExists(fcm_path);
            if (!isFcmExist) {
              return c.json(
                { message: "FCM file not found for one-signal update" },
                Response.BAD_REQUEST,
              );
            }
            const fcm_v1_service_account_json = await fs.readFile(
              fcm_path,
              "base64",
            );
            body = {
              ...body,
              fcm_v1_service_account_json,
            };
          }

          if (data.name !== customhost.appName) {
            body = {
              ...body,
              name: customhost.appName,
            };
          }

          const updateResponse = await fetch(
            `https://api.onesignal.com/apps/${customhost.onesignalAppId}`,
            {
              method: "PUT",
              headers: {
                Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            },
          );

          const newData = await updateResponse.json();

          if (!newData.id || "errors" in newData) {
            return c.json(
              { message: "Failed to update app", newData },
              Response.BAD_REQUEST,
            );
          }
        }
      }

      // check if there is either old or new one signal id present before deployment
      if (!customhost.onesignalAppId && !newOneSignalId) {
        return c.json(
          { message: "OneSignal App ID is required" },
          Response.BAD_REQUEST,
        );
      }

      let isFirstDeployment = false; // this same variable is used separately for both android and ios
      if (target === "ios") {
        // find if the current ios deployment is first or not
        // by searching for apple id through app store connect api
        // if apple id is not present then it is first deployment
        // apple id is created and saved during deployment process if not present
        const iosDeploymentDetails = metadata.iosDeploymentDetails;
        if (!iosDeploymentDetails.appleId) {
          let appleId = "";
          const privateKey = await fs.readFile(
            path.resolve(
              `./developer_accounts/ios/${iosDeveloperAccount?._id}/asc_api_pk.p8`,
            ),
            "utf-8",
          );

          let token = jwt.sign({}, privateKey, {
            algorithm: "ES256",
            expiresIn: "5m",
            issuer: iosDeveloperAccount?.ascApiKeyIssuer as string,
            audience: "appstoreconnect-v1",
            keyid: iosDeveloperAccount?.ascApiKeyId as string,
          });

          const appleRes = await fetch(
            `https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=${metadata.iosDeploymentDetails.bundleId}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            },
          );

          const appleResData = await appleRes.json();

          if (appleResData?.data?.length) {
            appleId = appleResData.data[0].id;
          }

          if (appleId) {
            await Mongo.metadata.updateOne(
              {
                host: new ObjectId(customHostId),
              },
              {
                $set: {
                  "iosDeploymentDetails.appleId": appleId,
                },
              },
            );
          } else {
            // apple id is not found even on apple servers
            // so it is first deployment, and new apple id will be created during deployment process
            isFirstDeployment = true;
          }
        }
      } else if (target === "android") {
        // check if the android deployment is first or not
        const serviceAccountFilePath = path.resolve(
          "./android_service_account.json",
        );
        const serviceAccount = await fs.readFile(
          serviceAccountFilePath,
          "utf-8",
        );

        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(serviceAccount),
          scopes: ["https://www.googleapis.com/auth/androidpublisher"],
        });
        const client = await auth.getClient();

        const play = google.androidpublisher({
          version: "v3",
          auth: client as any,
        });

        try {
          await play.edits.insert({
            packageName: metadata.androidDeploymentDetails.bundleId,
            requestBody: {},
          });
        } catch (error: any) {
          if (error?.response?.data?.error?.code === 404) {
            isFirstDeployment = true;
          }
        }
      }

      const { versionName: productionVersionName, lastDeploymentDetails } =
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
      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(customHostId),
        },
        {
          $set: {
            ...updateQuery,
          },
        },
      );
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
        host: new ObjectId(customHostId),
        user: new ObjectId(payload.id),
        platform: target,
        versionName: currentVersionName,
        buildNumber: currentBuildNumber,
        tasks,
        status: Status.PENDING,
        cancelledBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        isFirstDeployment,
        generateIAPScreenshot: generateIAPScreenshot || false,
      });

      // TODO: can't create another job if the job already exists and processing
      // creating a new job for deployment

      await buildQueue.add(
        `${createdDeployment.insertedId.toString()}-${target}-${currentVersionName}`,
        {
          deploymentId: createdDeployment.insertedId.toString(),
          hostId: customHostId,
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
          onesignal_id: newOneSignalId
            ? newOneSignalId
            : customhost.onesignalAppId || "",
          platform: target,
          versionName: currentVersionName,
          buildNumber: currentBuildNumber,
          appleId: metadata.iosDeploymentDetails.appleId || "",

          androidStoreSettings: metadata.androidStoreSettings,

          iosStoreSettings: metadata.iosStoreSettings,
          iosInfoSettings: metadata.iosInfoSettings,
          iosReviewSettings: metadata.iosReviewSettings,

          generateIAPScreenshot: generateIAPScreenshot || false,

          androidDeveloperAccount,
          iosDeveloperAccount,
          isFirstDeployment,
        },
        {
          attempts: 0,
          lifo: true,
          // deterministic id: lets SSE/cancel/dup-checks use getJob(id)
          // instead of scanning the whole queue
          jobId: createdDeployment.insertedId.toString(),
        },
      );
      return c.json(
        {
          message: "Created new deployment job",
          result: {
            _id: createdDeployment.insertedId.toString(),
            user,
            platform: target,
            versionName: currentVersionName,
            buildNumber: currentBuildNumber,
            status: Status.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        Response.CREATED,
      );
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

const createBulkReDeploymentHandler = factory.createHandlers(
  zValidator("json", createBulkReDeploymentSchema),
  async (c) => {
    try {
      const { target, customHostIds } = c.req.valid("json");
      const payload: JWTPayloadType = c.get("jwtPayload");

      if (!target) {
        return c.json(
          { message: "Deployment target is required" },
          Response.BAD_REQUEST,
        );
      }

      if (!customHostIds.length) {
        return c.json(
          { message: "Custom Host IDs are required" },
          Response.BAD_REQUEST,
        );
      }

      // pending or processing
      const recentActiveDeployment = await Mongo.redeployment.findOne({
        status: { $in: [Status.PENDING, Status.PROCESSING] },
        platform: target,
      });

      if (recentActiveDeployment) {
        // deterministic job ids: direct lookup instead of a full queue scan
        const job = await redeploymentQueue.getJob(
          recentActiveDeployment._id.toString(),
        );
        if (job) {
          const jobStatus = await job.getState();
          if (jobStatus === "active" || jobStatus === "waiting") {
            return c.json(
              { message: "Deployment job already exists" },
              Response.CONFLICT,
            );
          }
        }
      }

      const user = await Mongo.user.findOne(
        {
          _id: new ObjectId(payload.id),
        },
        { projection: { name: 1 } },
      );

      if (!user) {
        return c.json({ message: "User not found" }, Response.NOT_FOUND);
      }

      const releaseBuffer = await fs.promises.readFile(
        `./data/release.json`,
        "utf-8",
      );

      const releaseDetails = JSON.parse(releaseBuffer) as {
        versionName: string;
        buildNumber: number;
      };

      let currentVersionName = releaseDetails.versionName;

      // creating a new re-deployment
      const createdReDeployment = await Mongo.redeployment.insertOne({
        createdAt: new Date(),
        updatedAt: new Date(),
        user: new ObjectId(payload.id),
        platform: target,
        versionName: currentVersionName,
        hosts: customHostIds.map((id: string) => new ObjectId(id)),
        status: Status.PENDING,
        progress: {
          completed: 0,
          total: customHostIds.length,
          failed: [],
          succeeded: [],
        },
      });

      await redeploymentQueue.add(
        `${createdReDeployment.insertedId.toString()}-${target}-${currentVersionName}`,
        {
          hostIds: customHostIds,
          platform: target,
          redeploymentId: createdReDeployment.insertedId.toString(),
          userId: payload.id,
        },
        {
          attempts: 0,
          jobId: createdReDeployment.insertedId.toString(),
        },
      );

      return c.json(
        {
          message: "Created new re-deployment job",
          result: {
            _id: createdReDeployment.insertedId.toString(),
            user,
            platform: target,
            versionName: currentVersionName,
            status: Status.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        Response.CREATED,
      );
    } catch (error) {
      console.log(error);
      return c.json(
        { message: "Internal Server Error", error },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

const getLatestRedeploymentDetailsById = factory.createHandlers(async (c) => {
  try {
    const redeployment = await Mongo.redeployment.findOne(
      {},
      {
        sort: { createdAt: -1 },
        projection: {
          user: 1,
          platform: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          versionName: 1,
          hosts: 1,
          progress: 1,
        },
      },
    );

    return c.json(
      {
        message: "Fetched ReDeployment Details",
        result: redeployment
          ? redeployment
          : {
              status: Status.SUCCESS,
            },
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const getDeploymentDetailsById = factory.createHandlers(async (c) => {
  try {
    const { id, deploymentId } = c.req.param();
    const deployments = await Mongo.deployment
      .aggregate([
        {
          $match: {
            _id: new ObjectId(deploymentId),
            host: new ObjectId(id),
          },
        },
        {
          $lookup: {
            from: "adminusers",
            localField: "user",
            foreignField: "_id",
            as: "user",
          },
        },
        {
          $unwind: "$user",
        },
        {
          $project: {
            "user.name": 1,
            platform: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            versionName: 1,
            buildNumber: 1,
            host: 1,
            tasks: {
              $map: {
                input: "$tasks",
                as: "task",
                in: {
                  id: "$$task.id",
                  name: "$$task.name",
                  status: "$$task.status",
                  duration: "$$task.duration",
                },
              },
            },
          },
        },
      ])
      .toArray();

    const deployment = deployments[0];

    if (!deployment) {
      return c.json({ message: "Deployment not found" }, Response.NOT_FOUND);
    }

    let isAndroidBundleAvailable = false;
    if (deployment.platform === "android") {
      const androidAABDetails = await readFile(
        "./data/android-aab.json",
        "utf-8",
      );
      const parsedAndroidAABDetails = JSON.parse(androidAABDetails);
      isAndroidBundleAvailable = parsedAndroidAABDetails[deployment.host]
        ? true
        : false;
    }

    return c.json(
      {
        message: "Fetched Deployment Details",
        result: { ...deployment, isAndroidBundleAvailable },
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const getDeploymentTaskLogsByTaskId = factory.createHandlers(async (c) => {
  try {
    const { deploymentId, taskId } = c.req.param();
    const deploymentLogs = await Mongo.deployment
      .aggregate([
        {
          $match: {
            _id: new ObjectId(deploymentId),
          },
        },
        {
          $unwind: {
            path: "$tasks",
          },
        },
        {
          $match: {
            "tasks.id": taskId,
          },
        },
        {
          $project: {
            _id: 0,
            logs: "$tasks.logs",
          },
        },
      ])
      .toArray();

    const logs = deploymentLogs[0];

    if (!logs) {
      return c.json(
        { message: "Deployment logs not found" },
        Response.NOT_FOUND,
      );
    }

    return c.json(
      { message: "Fetched Deployment logs", result: logs },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const restartDeploymentTaskByDeploymentId = factory.createHandlers(
  async (c) => {
    try {
      const { deploymentId } = c.req.param();

      const deployment = await Mongo.deployment.findOne({
        _id: new ObjectId(deploymentId),
      });

      if (!deployment) {
        return c.json({ message: "Deployment not found" }, Response.NOT_FOUND);
      }

      const customhost = await Mongo.customhost.findOne({
        _id: deployment?.host,
      });

      const metadata = await Mongo.metadata.findOne({
        host: deployment?.host,
      });

      if (!customhost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }
      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      if (
        deployment.platform === "android" &&
        metadata.androidDeploymentDetails.isDeploymentBlocked
      ) {
        return c.json(
          {
            message: metadata.androidDeploymentDetails.deploymentBlockReason,
          },
          Response.BAD_REQUEST,
        );
      } else if (
        deployment.platform === "ios" &&
        metadata.iosDeploymentDetails.isDeploymentBlocked
      ) {
        return c.json(
          {
            message: metadata.iosDeploymentDetails.deploymentBlockReason,
          },
          Response.BAD_REQUEST,
        );
      }

      const releaseBuffer = await fs.promises.readFile(
        `./data/release.json`,
        "utf-8",
      );
      const releaseDetails = JSON.parse(releaseBuffer) as {
        versionName: string;
        buildNumber: number;
      };

      let androidDeveloperAccount: WithId<IDeveloperAccountAndroid> | null =
        null;
      let iosDeveloperAccount: WithId<IDeveloperAccountIos> | null = null;

      if (
        deployment.platform === "android" &&
        metadata.androidDeveloperAccount
      ) {
        androidDeveloperAccount =
          await Mongo.developer_accounts_android.findOne({
            _id: metadata.androidDeveloperAccount,
          });
      } else if (deployment.platform === "ios") {
        // NOTE: After migrations, all the metadata were linked to old developer account
        // for new metadatas, we need to link to default ios developer account and save
        if (metadata.iosDeveloperAccount) {
          iosDeveloperAccount = await Mongo.developer_accounts_ios.findOne({
            _id: metadata.iosDeveloperAccount,
          });
        } else {
          iosDeveloperAccount = await Mongo.developer_accounts_ios.findOne({
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

      if (deployment.platform === "ios" && !iosDeveloperAccount) {
        return c.json(
          { message: "iOS Developer Account not found" },
          Response.BAD_REQUEST,
        );
      }
      // change status of deployment to pending
      await Mongo.deployment.updateOne(
        {
          _id: new ObjectId(deploymentId),
        },
        {
          $set: {
            status: Status.PENDING,
            updatedAt: new Date(),
          },
        },
      );

      await buildQueue.add(
        `${deploymentId}-${deployment.platform}-${releaseDetails.versionName}`,
        {
          deploymentId,
          hostId: deployment.host.toString(),
          name:
            (deployment.platform === "android"
              ? metadata.androidStoreSettings.title
              : metadata.iosStoreSettings.name) ?? customhost.appName,
          appName: customhost.appName || customhost.brandname,
          bundle:
            deployment.platform === "android"
              ? metadata.androidDeploymentDetails.bundleId
              : metadata.iosDeploymentDetails.bundleId,
          domain: customhost.host,
          color: customhost.colors.PRIMARY,
          bgColor: metadata.backgroundStartColor,
          onesignal_id: customhost.onesignalAppId || "",
          platform: deployment.platform,
          versionName: releaseDetails.versionName,
          buildNumber: releaseDetails.buildNumber,
          appleId: metadata.iosDeploymentDetails.appleId || "",

          androidStoreSettings: metadata.androidStoreSettings,

          iosStoreSettings: metadata.iosStoreSettings,
          iosInfoSettings: metadata.iosInfoSettings,
          iosReviewSettings: metadata.iosReviewSettings,

          generateIAPScreenshot: deployment.generateIAPScreenshot || false,

          androidDeveloperAccount,
          iosDeveloperAccount,
          isFirstDeployment: deployment.isFirstDeployment || false,
        },
        {
          attempts: 0,
          lifo: true,
          jobId: deploymentId,
        },
      );
      return c.json(
        {
          message: "Restarted deployment job with last failed task",
          result: {},
        },
        Response.OK,
      );
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

const cancelDeploymentJobByDeploymentId = factory.createHandlers(async (c) => {
  try {
    const { deploymentId, target, version } = c.req.param();

    const payload: JWTPayloadType = c.get("jwtPayload");

    // deterministic job ids: direct lookup instead of a full queue scan
    const job = await buildQueue.getJob(deploymentId);

    if (!job) {
      return c.json({ message: "Job not found" }, Response.NOT_FOUND);
    }
    const jobStatus = await job.getState();

    if (jobStatus === "active") {
      // an active job is a live child process inside the worker — ask the
      // worker (over Redis pub/sub) to kill its process group; the doc is
      // marked cancelled below and the worker's writes are $ne-guarded
      await publishDeploymentCancel(deploymentId);
    } else {
      await job.remove();
    }

    const deployment = await Mongo.deployment.updateOne(
      {
        _id: new ObjectId(deploymentId),
      },
      {
        $set: {
          status: "cancelled",
          cancelledBy: new ObjectId(payload.id),
          updatedAt: new Date(),
        },
      },
    );

    // acknowledged is true even when nothing matched — matchedCount is the
    // actual "was it found" signal
    if (deployment.matchedCount === 0) {
      return c.json({ message: "Deployment not found" }, Response.NOT_FOUND);
    }

    return c.json(
      {
        message:
          jobStatus === "active"
            ? "Cancellation requested"
            : "Job removed successfully",
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const getRecentDeploymentsHandler = factory.createHandlers(async (c) => {
  try {
    const { target, status } = c.req.query();
    const deployments = await Mongo.deployment
      .aggregate([
        {
          $match: {
            platform: target ?? { $in: ["android", "ios"] },
            status: status ?? { $ne: "cancelled" },
          },
        },
        {
          $sort: { updatedAt: -1 },
        },
        {
          $limit: 10,
        },
        {
          $lookup: {
            from: "customhosts",
            localField: "host",
            foreignField: "_id",
            as: "host",
            pipeline: [{ $project: { appName: 1, logo: 1 } }],
          },
        },
        {
          $unwind: "$host",
        },
        {
          $project: {
            platform: 1,
            appName: "$host.appName",
            appId: "$host._id",
            logo: "$host.logo",
            versionName: 1,
            buildNumber: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ])
      .toArray();
    return c.json(
      {
        message: "Recent Deployments",
        result: deployments,
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const updateFailedAndroidDeploymentStatus = factory.createHandlers(
  zValidator("json", updateFailedAndroidDeploymentSchema),
  async (c) => {
    try {
      const { deploymentId } = c.req.valid("json");

      // update status and read version/build in one round trip
      const deploymentDetails = await Mongo.deployment.findOneAndUpdate(
        {
          _id: new ObjectId(deploymentId),
        },
        {
          $set: {
            status: Status.SUCCESS,
            updatedAt: new Date(),
          },
        },
        {
          returnDocument: "after",
          projection: {
            versionName: 1,
            buildNumber: 1,
            host: 1,
          },
        },
      );

      if (!deploymentDetails) {
        return c.json({ message: "Deployment not found" }, Response.NOT_FOUND);
      }

      const metadata = await Mongo.metadata.findOne(
        { host: new ObjectId(deploymentDetails.host) },
        { projection: { "androidDeploymentDetails.bundleId": 1 } },
      );

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      fs.remove(`./deployments/${metadata.androidDeploymentDetails.bundleId}`);

      // updating the metadata with the new version name and build number
      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(deploymentDetails.host),
        },
        {
          $set: {
            "androidDeploymentDetails.versionName":
              deploymentDetails.versionName,
            "androidDeploymentDetails.buildNumber":
              deploymentDetails.buildNumber,
          },
        },
      );

      return c.json(
        { message: "Updated Deployment Status to Success" },
        Response.OK,
      );
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

const getDeploymentRequirementsChecklist = factory.createHandlers(async (c) => {
  try {
    const { id: appId, creatorId } = c.req.param();

    // all three are pure existence checks — project _id only (the customhost
    // fetch that used to sit at index 2 was never read; it is dropped)
    const [storeSettingsDone, logoDone, iapMango] = await Promise.all([
      Mongo.metadata.findOne(
        {
          host: new ObjectId(appId),
          "androidStoreSettings.title": {
            $exists: true,
            $ne: "",
          },
          "iosStoreSettings.name": {
            $exists: true,
            $ne: "",
          },
        },
        { projection: { _id: 1 } },
      ),
      Mongo.metadata.findOne(
        {
          host: new ObjectId(appId),
          logo: {
            $exists: true,
            $ne: "",
          },
        },
        { projection: { _id: 1 } },
      ),
      Mongo.mango.findOne(
        {
          creator: new ObjectId(creatorId),
          isHidden: { $ne: true },
          isStopTakingPayment: { $ne: true },
          $or: [{ end: { $gte: new Date() } }, { end: undefined }],
          isPublic: { $ne: true },
          isDeleted: { $ne: true },
          iapProductId: { $exists: true },
        },
        { projection: { _id: 1 } },
      ),
    ]);

    return c.json(
      {
        message: "Fetched Deployment Requirements Checklist",
        result: [
          {
            name: DEPLOYMENT_REQUIREMENTS[0],
            isCompleted: storeSettingsDone ? true : false,
          },
          {
            name: DEPLOYMENT_REQUIREMENTS[1],
            isCompleted: logoDone ? true : false,
          },
          {
            name: DEPLOYMENT_REQUIREMENTS[3],
            isCompleted: iapMango ? true : false,
          },
        ],
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

export {
  cancelDeploymentJobByDeploymentId,
  createBulkReDeploymentHandler,
  createNewDeploymentHandler,
  getAllDeployments,
  getAllDeploymentsHandler,
  getDeploymentDetails,
  getDeploymentDetailsById,
  getDeploymentRequirementsChecklist,
  getDeploymentTaskLogsByTaskId,
  getLatestRedeploymentDetailsById,
  getRecentDeploymentsHandler,
  restartDeploymentTaskByDeploymentId,
  updateFailedAndroidDeploymentStatus,
};
