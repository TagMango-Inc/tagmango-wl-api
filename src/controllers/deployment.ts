import { createFactory } from "hono/factory";
import mongoose from "mongoose";
import { CURRENT_VERSION_NAME, CURRENT_VERSION_NUMBER } from "src/constants";
import { buildQueue } from "src/job/config";
import CustomHostModel from "src/models/customHost.model";
import DeploymentModel from "src/models/deployment.model";
import MetadataModel from "src/models/metadata.model";
import { JWTPayloadType } from "src/types";
import { generateDeploymentTasks } from "src/utils/generateTaskDetails";
import { Response } from "src/utils/statuscode";
import { createNewDeploymentSchema } from "src/validations/customhost";

import { zValidator } from "@hono/zod-validator";

const factory = createFactory();

const getDeploymentDetails = factory.createHandlers(async (c) => {
  try {
    const { id, target } = c.req.param();
    const deploymentDetails = await MetadataModel.aggregate([
      {
        $match: {
          host: new mongoose.Types.ObjectId(id),
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
    ]);

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
    const { id } = c.req.param();
    const { page, limit, search } = c.req.query();

    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 10;
    let SEARCH = search ? (search as string) : "";

    const totalDeployments =
      await DeploymentModel.findById(id).countDocuments();

    const deployments = await DeploymentModel.aggregate([
      {
        $match: {
          host: new mongoose.Types.ObjectId(id),
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
    ]);

    const totalSearchResults = await DeploymentModel.find({
      _id: new mongoose.Types.ObjectId(id),
      $or: [{ versionName: { $regex: new RegExp(SEARCH, "i") } }],
    }).countDocuments();

    const hasNextPage = totalSearchResults > PAGE * LIMIT;

    return c.json(
      {
        message: "All Deployments for Custom Host",
        result: {
          deployments,
          totalDeployments,
          totalSearchResults,
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
      const customhost = await CustomHostModel.findById(customHostId);
      const metadata = await MetadataModel.findOne({
        host: new mongoose.Types.ObjectId(customHostId),
      });
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
      await MetadataModel.findOneAndUpdate(
        {
          host: new mongoose.Types.ObjectId(customHostId),
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
      const createdDeployment = await DeploymentModel.create({
        host: new mongoose.Types.ObjectId(customHostId),
        user: new mongoose.Types.ObjectId(payload.id),
        platform: target,
        versionName: currentVersionName,
        buildNumber: currentBuildNumber,
        tasks,
      });
      // populating the user details
      await createdDeployment.populate({
        path: "user",
        select: "name",
      });
      // TODO: can't create another job if the job already exists and processing
      // creating a new job for deployment
      await buildQueue.add(
        `${createdDeployment._id}-${target}-${currentVersionName}`,
        {
          deploymentId: createdDeployment._id.toString(),
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
        },
        {
          attempts: 0,
        },
      );
      return c.json(
        {
          message: "Created New Deployment and added new job",
          result: {
            _id: createdDeployment._id,
            user: createdDeployment.user,
            platform: target,
            versionName: createdDeployment.versionName,
            buildNumber: createdDeployment.buildNumber,
            status: createdDeployment.status,
            createdAt: (createdDeployment as any).createdAt,
            updatedAt: (createdDeployment as any).updatedAt,
          },
        },
        {
          status: 201,
          statusText: "Created",
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
  },
);

const getDeploymentDetailsById = factory.createHandlers(async (c) => {
  try {
    const { id, deploymentId } = c.req.param();
    const deployments = await DeploymentModel.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(deploymentId),
          host: new mongoose.Types.ObjectId(id),
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
    ]);

    const deployment = deployments[0];

    if (!deployment) {
      return c.json(
        { message: "Deployment not found" },
        { status: 404, statusText: "Not Found" },
      );
    }

    return c.json(
      { message: "Fetched Deployment Details", result: deployment },
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

const getDeploymentTaskLogsByTaskId = factory.createHandlers(async (c) => {
  try {
    const { deploymentId, taskId } = c.req.param();
    const deploymentLogs = await DeploymentModel.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(deploymentId),
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
    ]);

    const logs = deploymentLogs[0];

    if (!logs) {
      return c.json(
        { message: "Deployment logs not found" },
        { status: 404, statusText: "Not Found" },
      );
    }

    return c.json(
      { message: "Fetched Deployment logs", result: logs },
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

const cancelDeploymentJobByDeploymentId = factory.createHandlers(async (c) => {
  try {
    const { deploymentId, target, version } = c.req.param();

    const jobNameTobeDeleted = `${deploymentId}-${target}-${version}`;

    const allJobs = await buildQueue.getJobs(["waiting", "active"]);

    const job = allJobs.find((job) => job.name === jobNameTobeDeleted);

    const payload: JWTPayloadType = c.get("jwtPayload");

    if (!job) {
      return c.json(
        { message: "Job not found" },
        { status: 404, statusText: "Not Found" },
      );
    }

    await job.remove();

    const deployment = await DeploymentModel.findByIdAndUpdate(deploymentId, {
      status: "cancelled",
      cancelledBy: new mongoose.Types.ObjectId(payload.id),
    });

    if (!deployment) {
      return c.json(
        { message: "Deployment not found" },
        { status: 404, statusText: "Not Found" },
      );
    }

    return c.json(
      { message: "Job removed successfully" },
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

export {
  cancelDeploymentJobByDeploymentId,
  createNewDeploymentHandler,
  getAllDeploymentsHandler,
  getDeploymentDetails,
  getDeploymentDetailsById,
  getDeploymentTaskLogsByTaskId,
};
