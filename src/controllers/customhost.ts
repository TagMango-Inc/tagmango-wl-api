import { Job } from "bullmq";
import fs from "fs";
import { createFactory } from "hono/factory";
import { streamSSE } from "hono/streaming";
import mongoose from "mongoose";
import { buildQueue, buildQueueEvents } from "src/job/config";
import CustomHostModel from "src/models/customHost.model";
import DeploymentModel from "src/models/deployment.model";
import { JobProgressType, JWTPayloadType } from "src/types";
import {
  createNewDeploymentSchema,
  patchCustomHostByIdSchema,
} from "src/validations/customhost";

import { zValidator } from "@hono/zod-validator";

const factory = createFactory();

/**
    /wl/apps/
    GET
    Get all custom hosts
    Protected Route
    Accepted Query Params: page, limit, search
    Default: page = 1, limit = 10, search = ''
*/
const getAllCustomHostsHandler = factory.createHandlers(async (c) => {
  try {
    const { page, limit, search } = c.req.query();
    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 10;
    let SEARCH = search ? (search as string) : "";

    const totalCustomHosts = await CustomHostModel.countDocuments();
    const customHosts = await CustomHostModel.aggregate([
      {
        $match: {
          $or: [
            { appName: { $regex: new RegExp(SEARCH, "i") } },
            { host: { $regex: new RegExp(SEARCH, "i") } },
            { brandname: { $regex: new RegExp(SEARCH, "i") } },
          ],
          whitelableStatus: { $ne: "drafted" },
        },
      },
      {
        $project: {
          appName: 1,
          host: 1,
          logo: 1,
          createdAt: 1,
          updatedAt: 1,
          deploymentDetails: 1,
          androidVersionName: "$androidDeploymentDetails.versionName",
          iosVersionName: "$iosDeploymentDetails.versionName",
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

    const totalSearchResults = await CustomHostModel.find({
      $or: [
        { appName: { $regex: new RegExp(SEARCH, "i") } },
        { host: { $regex: new RegExp(SEARCH, "i") } },
        { brandname: { $regex: new RegExp(SEARCH, "i") } },
      ],
    }).countDocuments();

    const hasNextPage = totalSearchResults > PAGE * LIMIT;

    return c.json(
      {
        message: "All Custom Hosts",
        result: {
          customHosts,
          totalSearchResults,
          totalCustomHosts,
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

/**
    /wl/apps/{:id
    GET
    Get custom host by id
    Protected Route
*/
const getCustomHostByIdHandler = factory.createHandlers(async (c) => {
  try {
    const { id } = c.req.param();
    const customHost = await CustomHostModel.findById(id);
    if (!customHost) {
      return c.json(
        { message: "Custom Host not found" },
        { status: 404, statusText: "Not Found" },
      );
    }
    return c.json(
      { message: "Fetched Custom Host", result: customHost },
      { status: 200, statusText: "OK" },
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      { status: 500, statusText: "Internal Server Error" },
    );
  }
});

/**
 * /wl/apps/{:id}
 * PATCH
 * Update custom host by id
 * Protected Route
 * Not accepted fields: _id, domain
 * All other fields are accepted
 */
const patchCustomHostByIdHandler = factory.createHandlers(
  zValidator("json", patchCustomHostByIdSchema),
  async (c) => {
    try {
      const { id } = c.req.param();
      const { domain, ...update } = c.req.valid("json");

      const customHost = await CustomHostModel.findById(id);
      if (!customHost) {
        return c.json(
          { message: "Custom Host not found" },
          { status: 404, statusText: "Not Found" },
        );
      }

      const updatedCustomHost = await CustomHostModel.findByIdAndUpdate(
        id,
        update,
        {
          new: true,
        },
      );

      return c.json(
        { message: "Custom Host Updated", result: updatedCustomHost },
        { status: 200, statusText: "OK" },
      );
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        { status: 500, statusText: "Internal Server Error" },
      );
    }
  },
);

/**
    /wl/apps/{:id}/deploy/{:target}
    GET
    Deploy custom host for android | ios
    Protected Route
    target = android | ios
*/

const deployCustomHostHandler = factory.createHandlers(async (c) => {
  const { id, target } = c.req.param();

  const jobCompletePromise = new Promise<void>((resolve) => {
    // Set up event listener for job completion
    buildQueueEvents.on("completed", async (job) => {
      console.log(`Job ${job.jobId} completed`, JSON.stringify(job, null, 2));
      if (job.jobId) {
        // Assuming jobId is set elsewhere
        resolve();
      }
    });
  });

  const message = (
    data: object | string,
    stage: "initial" | "finished" = "initial",
  ) => {
    if (typeof data === "string") {
      return {
        data: `${JSON.stringify({
          task: {
            id: stage === "initial" ? "0" : "-1",
            name:
              stage === "initial"
                ? "Initialising execution"
                : "completed execution",
          },
          message: data,
          type: stage === "initial" ? "initialized" : "success",
          timestamp: Date.now(),
        } as JobProgressType)}`,
      };
    }
    return {
      data: `${JSON.stringify(data)}`,
    };
  };

  return streamSSE(c, async (stream) => {
    await stream.writeSSE(
      message(" ************* Starting Deployment ************* ", "initial"),
    );

    // listen to the progress of the job (set by job.updateProgress() in worker.ts
    buildQueueEvents.on("progress", async (job) => {
      const jobDetails = await Job.fromId(buildQueue, job.jobId);

      if (!jobDetails) return;

      const jobName = jobDetails.name;

      const [deploymentId, targetPlatform, lastDeploymentVersionName] =
        jobName.split("-");

      if (deploymentId !== id || targetPlatform !== target) {
        await stream.writeSSE(
          message(" ************* Job not found ************* ", "finished"),
        );
        stream.close();
      }

      if (typeof job.data === "object") {
        const jobData = job.data as JobProgressType;
        await stream.writeSSE(message(jobData));
      }
    });

    // Wait for job to complete before closing the stream
    await jobCompletePromise;

    await stream.writeSSE(
      message(" ************* Deployment Completed ************* ", "finished"),
    );
  });
});

/**
    /wl/apps/{:id}/upload/asset
    POST
    Protected Route
*/

const uploadAssetHandler = factory.createHandlers(async (c) => {
  try {
    const body = await c.req.parseBody({
      all: true,
    });
    const file = body["file"];
    const uploadPath = "./uploads";
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, {
        recursive: true,
      });
    }

    if (file instanceof File) {
      const filePath = `${uploadPath}/${file.name}`;
      const buffer = await file.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(buffer));
      return c.json(
        {
          message: "File uploaded successfully",
          result: {
            path: filePath,
          },
        },
        {
          status: 200,
          statusText: "OK",
        },
      );
    } else {
      return c.json(
        {
          message: "Invalid file",
          result: null,
        },
        {
          status: 400,
          statusText: "Bad Request",
        },
      );
    }
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

      const createdDeployment = await DeploymentModel.create({
        host: new mongoose.Types.ObjectId(customHostId),
        user: new mongoose.Types.ObjectId(payload.id),
        platform: target,
        versionName: lastDeploymentVersionName,
        buildNumber: updatedBuildNumber,
        tasks: [],
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

export {
  createNewDeploymentHandler,
  deployCustomHostHandler,
  getAllCustomHostsHandler,
  getAllDeploymentsHandler,
  getCustomHostByIdHandler,
  getDeploymentDetails,
  patchCustomHostByIdHandler,
  uploadAssetHandler,
};
