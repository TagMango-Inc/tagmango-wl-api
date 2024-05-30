import fs from 'fs-extra';
import { createFactory } from 'hono/factory';
import { ObjectId } from 'mongodb';

import { zValidator } from '@hono/zod-validator';

import { DEPLOYMENT_REQUIREMENTS } from '../../src/constants';
import Mongo from '../../src/database';
import { buildQueue } from '../../src/job/config';
import { JWTPayloadType } from '../../src/types';
import {
  PlatformValues,
  Status,
  StatusValues,
} from '../../src/types/database';
import { generateDeploymentTasks } from '../../src/utils/generateTaskDetails';
import { Response } from '../../src/utils/statuscode';
import { createNewDeploymentSchema } from '../../src/validations/customhost';
import { updateFailedAndroidDeploymentSchema } from '../validations/deployment';

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
            $or: [{ versionName: { $regex: new RegExp(SEARCH, "i") } }],
            platform: platform ?? { $in: PlatformValues },
            status: status ?? {
              $in: StatusValues,
            },
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
                },
              },
              {
                $project: {
                  "user._id": 1,
                  "user.name": 1,
                  // "user.customhostDashboardAccess": 1,
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
              {
                $sort: { updatedAt: -1 },
              },
              {
                $skip: (PAGE - 1) * LIMIT,
              },
              {
                $limit: LIMIT,
              },
            ],
          },
        },
        {
          $unwind: "$totalSearchResults",
        },
        {
          $project: {
            deployments: 1,
            totalDeployments: "$totalSearchResults.count",
          },
        },
      ])
      .toArray();

    const androidAABDetails = await readFile(
      "./data/android-aab.json",
      "utf-8",
    );
    const parsedAndroidAABDetails = JSON.parse(androidAABDetails);

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
      const { target } = c.req.valid("json");
      const payload: JWTPayloadType = c.get("jwtPayload");

      // pending or processing
      const recentActiveDeployment = await Mongo.deployment.findOne({
        host: new ObjectId(customHostId),
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

      const customhost = await Mongo.customhost.findOne({
        _id: new ObjectId(customHostId),
      });

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(customHostId),
      });

      if (!user) {
        return c.json({ message: "User not found" }, Response.NOT_FOUND);
      }
      if (!customhost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }
      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
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
          bundle:
            target === "android"
              ? metadata.androidDeploymentDetails.bundleId
              : metadata.iosDeploymentDetails.bundleId,
          domain: customhost.host,
          color: customhost.colors.PRIMARY,
          bgColor: metadata.backgroundStartColor,
          onesignal_id: customhost.onesignalAppId || "",
          platform: target,
          versionName: currentVersionName,
          buildNumber: currentBuildNumber,

          androidStoreSettings: metadata.androidStoreSettings,
          androidScreenshots: metadata.androidScreenshots,
          androidFeatureGraphic: metadata.androidFeatureGraphic,

          iosStoreSettings: metadata.iosStoreSettings,
          iosInfoSettings: metadata.iosInfoSettings,
          iosReviewSettings: metadata.iosReviewSettings,
          iosScreenshots: metadata.iosScreenshots,
        },
        {
          attempts: 0,
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

    const androidAABDetails = await readFile(
      "./data/android-aab.json",
      "utf-8",
    );
    const parsedAndroidAABDetails = JSON.parse(androidAABDetails);

    const isAndroidBundleAvailable = parsedAndroidAABDetails[deployment.host]
      ? true
      : false;

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

const cancelDeploymentJobByDeploymentId = factory.createHandlers(async (c) => {
  try {
    const { deploymentId, target, version } = c.req.param();

    const jobNameTobeDeleted = `${deploymentId}-${target}-${version}`;

    const allJobs = await buildQueue.getJobs(["waiting", "active"]);

    const job = allJobs.find((job) => job.name === jobNameTobeDeleted);

    const payload: JWTPayloadType = c.get("jwtPayload");

    if (!job) {
      return c.json({ message: "Job not found" }, Response.NOT_FOUND);
    }
    const jobStatus = await job.getState();

    if (jobStatus !== "active") {
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

    if (!deployment.acknowledged) {
      return c.json({ message: "Deployment not found" }, Response.NOT_FOUND);
    }

    return c.json({ message: "Job removed successfully" }, Response.OK);
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

      // updating the deployment status to success
      await Mongo.deployment.updateOne(
        {
          _id: new ObjectId(deploymentId),
        },
        {
          $set: {
            status: Status.SUCCESS,
            updatedAt: new Date(),
          },
        },
      );

      // picking version name and bunild number from the deployment
      const deploymentDetails = await Mongo.deployment.findOne(
        {
          _id: new ObjectId(deploymentId),
        },
        {
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

    const data = await Promise.all([
      Mongo.metadata.findOne({
        host: new ObjectId(appId),
        "androidStoreSettings.title": {
          $exists: true,
        },
        "iosStoreSettings.name": {
          $exists: true,
        },
      }),
      Mongo.metadata.findOne({
        logo: {
          $exists: true,
        },
      }),
      Mongo.customhost.findOne({
        _id: new ObjectId(appId),
        onesignalAppId: {
          $exists: true,
        },
      }),
      Mongo.mango.findOne({
        creator: new ObjectId(creatorId),
        isHidden: { $ne: true },
        isStopTakingPayment: { $ne: true },
        $or: [{ end: { $gte: new Date() } }, { end: undefined }],
        isPublic: { $ne: true },
        isDeleted: { $ne: true },
        iapProductId: { $exists: true },
      }),
    ]);

    return c.json(
      {
        message: "Fetched Deployment Requirements Checklist",
        result: [
          {
            name: DEPLOYMENT_REQUIREMENTS[0],
            isCompleted: data[0] ? true : false,
          },
          {
            name: DEPLOYMENT_REQUIREMENTS[1],
            isCompleted: data[1] ? true : false,
          },
          {
            name: DEPLOYMENT_REQUIREMENTS[2],
            isCompleted: data[2] ? true : false,
          },
          {
            name: DEPLOYMENT_REQUIREMENTS[3],
            isCompleted: data[3] ? true : false,
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
  createNewDeploymentHandler,
  getAllDeploymentsHandler,
  getDeploymentDetails,
  getDeploymentDetailsById,
  getDeploymentRequirementsChecklist,
  getDeploymentTaskLogsByTaskId,
  getRecentDeploymentsHandler,
  updateFailedAndroidDeploymentStatus,
};
