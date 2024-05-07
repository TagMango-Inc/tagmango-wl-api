import { Job } from "bullmq";
import { createFactory } from "hono/factory";
import { SSEStreamingApi, streamSSE } from "hono/streaming";
import mongoose from "mongoose";
import { buildQueue, buildQueueEvents } from "src/job/config";
import CustomHostModel from "src/models/customHost.model";
import DeploymentModel from "src/models/deployment.model";
import { JobProgressType, JWTPayloadType } from "src/types";
import { generateDeploymentTasks } from "src/utils/generateTaskDetails";
import { createNewDeploymentSchema } from "src/validations/customhost";

import { zValidator } from "@hono/zod-validator";

const factory = createFactory();

const getDeploymentDetails = factory.createHandlers(async (c) => {
  try {
    const { id, target } = c.req.param();
    const deploymentDetails = await CustomHostModel.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(id),
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
              then: "$androidDeploymentDetails.versionName",
              else: "$iosDeploymentDetails.versionName",
            },
          },
          buildNumber: {
            $cond: {
              if: {
                $eq: [target, "android"],
              },
              then: "$androidDeploymentDetails.buildNumber",
              else: "$iosDeploymentDetails.buildNumber",
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

    return c.json(
      { message: "Fetched Deployment Details", result: deploymentDetail },
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

      if (!customhost) {
        return c.json(
          { message: "Custom Host not found" },
          { status: 404, statusText: "Not Found" },
        );
      }

      const { versionName: productionVersionName, lastDeploymentDetails } =
        target === "android"
          ? customhost.androidDeploymentDetails
          : customhost.iosDeploymentDetails;

      const {
        versionName: lastDeploymentVersionName,
        buildNumber: lastDeploymentBuildNumber,
      } = lastDeploymentDetails;

      let updatedBuildNumber = lastDeploymentBuildNumber;

      if (productionVersionName === lastDeploymentVersionName) {
        // increment the build number
        await CustomHostModel.findOneAndUpdate(
          {
            _id: new mongoose.Types.ObjectId(customHostId),
          },
          {
            $inc: {
              "androidDeploymentDetails.lastDeploymentDetails.buildNumber":
                target === "android" ? 1 : 0,
              "iosDeploymentDetails.lastDeploymentDetails.buildNumber":
                target === "ios" ? 1 : 0,
            },
          },
        );

        updatedBuildNumber = lastDeploymentBuildNumber + 1;
      }

      // populating the tasks with name and id
      const tasks = generateDeploymentTasks({
        bundle:
          target === "android"
            ? customhost.androidDeploymentDetails.bundleId
            : customhost.iosDeploymentDetails.bundleId,
        formatedAppName: customhost.appName.replace(/ /g, ""),
        platform: target,
      });
      // creating a new deployment
      const createdDeployment = await DeploymentModel.create({
        host: new mongoose.Types.ObjectId(customHostId),
        user: new mongoose.Types.ObjectId(payload.id),
        platform: target,
        versionName: lastDeploymentVersionName,
        buildNumber: updatedBuildNumber,
        tasks,
      });

      // populating the user details
      await createdDeployment.populate({
        path: "user",
        select: "name",
      });

      // creating a new job for deployment
      await buildQueue.add(
        `${createdDeployment._id}-${target}-${lastDeploymentVersionName}`,
        {
          deploymentId: createdDeployment._id.toString(),
          hostId: customHostId,
          name: customhost.appName,
          bundle:
            target === "android"
              ? customhost.androidDeploymentDetails.bundleId
              : customhost.iosDeploymentDetails.bundleId,
          domain: customhost.host,
          color: customhost.colors.PRIMARY,
          bgColor: customhost.colors.LAUNCH_BG,
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

const getDeploymentTaskStatusSSE = factory.createHandlers(async (c) => {
  const { deploymentId: deploymentIdFromParam } = c.req.param();

  const jobCompletePromise = async (stream: SSEStreamingApi) => {
    return new Promise<void>((resolve) => {
      buildQueueEvents.on("completed", async (job) => {
        console.log(`Job ${job.jobId} completed`, JSON.stringify(job, null, 2));
        if (job.jobId) {
          resolve();
        }
      });
    });
  };

  return streamSSE(c, async (stream) => {
    buildQueueEvents.on("progress", async (job) => {
      const jobDetails = await Job.fromId(buildQueue, job.jobId);

      if (!jobDetails) return;

      const jobName = jobDetails.name;

      const [deploymentId, targetPlatform, lastDeploymentVersionName] =
        jobName.split("-");

      if (deploymentId === deploymentIdFromParam) {
        const { task } = job.data as JobProgressType;
        const message = {
          data: `${JSON.stringify({
            id: task.id,
            type: task.type,
            name: task.name,
            duration: task.duration,
          })}`,
        };
        await stream.writeSSE(message);
      } else {
        stream.close();
      }
    });

    await jobCompletePromise(stream);
  });
});

export {
  createNewDeploymentHandler,
  getAllDeploymentsHandler,
  getDeploymentDetails,
  getDeploymentDetailsById,
  getDeploymentTaskLogsByTaskId,
  getDeploymentTaskStatusSSE,
};
