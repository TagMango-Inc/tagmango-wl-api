import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";
import { CURRENT_VERSION_NAME, CURRENT_VERSION_NUMBER } from "src/constants";
import Mongo from "src/database";
import { buildQueue } from "src/job/config";
import { JWTPayloadType } from "src/types";
import { Status } from "src/types/database";
import { generateDeploymentTasks } from "src/utils/generateTaskDetails";
import { Response } from "src/utils/statuscode";
import { createNewDeploymentSchema } from "src/validations/customhost";

import { zValidator } from "@hono/zod-validator";

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
        { status: 404, statusText: "Not Found" },
      );
    }

    const deploymentDetail = deploymentDetails[0];
    let currentVersionName = CURRENT_VERSION_NAME;
    let currentBuildNumber = CURRENT_VERSION_NUMBER;

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
      { status: 200, statusText: "OK" },
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
    );
  }
});

/**
 DEPLOYMENTS HANDLERS
*/

const getAllDeploymentsHandler = factory.createHandlers(async (c) => {
  try {
    const { id: appId } = c.req.param();
    const { page, limit, search } = c.req.query();

    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 10;
    let SEARCH = search ? (search as string) : "";

    const totalDeployments = await Mongo.deployment
      .find({ host: new ObjectId(appId) })
      .toArray();

    const deployments = await Mongo.deployment
      .aggregate([
        {
          $match: {
            host: new ObjectId(appId),
          },
        },
        {
          $match: {
            $or: [{ versionName: { $regex: new RegExp(SEARCH, "i") } }],
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
            "user._id": 1,
            "user.name": 1,
            // "user.customhostDashboardAccess": 1,
            // host: 1,
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
      ])
      .toArray();

    const totalSearchResults = await Mongo.deployment
      .find({
        _id: new ObjectId(appId),
        $or: [{ versionName: { $regex: new RegExp(SEARCH, "i") } }],
      })
      .toArray();

    const hasNextPage = totalSearchResults.length > PAGE * LIMIT;

    return c.json(
      {
        message: "All Deployments for Custom Host",
        result: {
          deployments,
          totalDeployments: totalDeployments.length,
          totalSearchResults: totalSearchResults.length,
          currentPage: PAGE,
          nextPage: hasNextPage ? PAGE + 1 : -1,
          limit: LIMIT,
          hasNext: hasNextPage,
        },
      },
      {
        status: 200,
        statusText: "OK",
      },
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
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
      // let updatedBuildNumber = lastDeploymentBuildNumber;
      let currentVersionName = CURRENT_VERSION_NAME;
      let currentBuildNumber = CURRENT_VERSION_NUMBER;
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
      await Mongo.metadata.findOneAndUpdate(
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
        formatedAppName: metadata.appName.replace(/ /g, ""),
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
      });

      // TODO: can't create another job if the job already exists and processing
      // creating a new job for deployment

      await buildQueue.add(
        `${createdDeployment.insertedId._id.toString()}-${target}-${currentVersionName}`,
        {
          deploymentId: createdDeployment.insertedId._id.toString(),
          hostId: customHostId,
          name: metadata.appName ?? customhost.appName,
          bundle:
            target === "android"
              ? metadata.androidDeploymentDetails.bundleId
              : metadata.iosDeploymentDetails.bundleId,
          domain: customhost.host,
          color: customhost.colors.PRIMARY,
          bgColor: metadata.backgroundStartColor,
          onesignal_id: customhost.onesignalAppId || "",
          platform: target,
          buildNumber: currentBuildNumber,
        },
        {
          attempts: 0,
        },
      );
      return c.json(
        {
          message: "Created New Deployment and added new job",
          result: {
            _id: createdDeployment.insertedId._id.toString(),
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

    return c.json(
      { message: "Fetched Deployment Details", result: deployment },
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

    await job.remove();

    const deployment = await Mongo.deployment.findOneAndUpdate(
      {
        _id: new ObjectId(deploymentId),
      },
      {
        status: "cancelled",
        cancelledBy: new ObjectId(payload.id),
      },
    );

    if (!deployment) {
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

export {
  cancelDeploymentJobByDeploymentId,
  createNewDeploymentHandler,
  getAllDeploymentsHandler,
  getDeploymentDetails,
  getDeploymentDetailsById,
  getDeploymentTaskLogsByTaskId,
  getRecentDeploymentsHandler,
};
