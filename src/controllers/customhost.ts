import fs from "fs";
import { createFactory } from "hono/factory";
import { streamSSE } from "hono/streaming";
import mongoose from "mongoose";
import CustomHostModel from "src/models/customHost.model";
import DeploymentModel from "src/models/deployment.model";
import { JWTPayloadType } from "src/types";
import { createNewDeploymentSchema } from "src/validations/customhost";

import { zValidator } from "@hono/zod-validator";

import executeCommands from "../utils/executeCommands";

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
    /wl/apps/{:id}/deploy/{:target}
    GET
    Deploy custom host for android | ios
    Protected Route
    target = android | ios
*/

const deployCustomHostHandler = factory.createHandlers(async (c) => {
  const { id, target } = c.req.param();
  const customHosts = await CustomHostModel.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    {
      $project: {
        colors: 1,
        onesignalAppId: 1,
        appName: 1,
        deploymentDetails: 1,
        host: 1,
        androidBundleId: "$androidDeepLinkConfig.target.package_name",
        iosBundleId: "$iosDeepLinkConfig.applinks.details.appID",
      },
    },
  ]);

  if (customHosts.length === 0) {
    return c.json(
      { message: "Custom Host not found" },
      { status: 404, statusText: "Not Found" },
    );
  }

  const customHost = customHosts[0];
  const {
    colors,
    onesignalAppId,
    appName,
    deploymentDetails,
    host,
    androidBundleId,
    iosBundleId,
  } = customHost;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: `${JSON.stringify(customHost)}`,
    });

    await stream.writeSSE({
      data: "__________________________ INSTALLING DEPENDENCIES __________________________",
    }); // Send output to client

    await executeCommands(
      ["cd deployments", "npm install"],
      "Install Dependencies",
      stream,
    );

    // Start npm run build process
    await stream.writeSSE({
      data: "__________________________ BUILDING __________________________",
    }); // Send output to client
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

      const results = await CustomHostModel.aggregate([
        {
          $match: {
            _id: new mongoose.Types.ObjectId(customHostId),
          },
        },
        {
          $project: {
            deploymentSettings: {
              $cond: {
                if: {
                  $eq: [target, "android"],
                },
                then: "$androidDeploymentDetails",
                else: "$iosDeploymentDetails",
              },
            },
          },
        },
      ]);

      if (results.length === 0) {
        return c.json(
          { message: "Deployment details not found" },
          { status: 404, statusText: "Not Found" },
        );
      }

      const result = results[0];

      let updatedCustomHost = null;

      // if we are deploying the same version name, then increament the last deployment version name by 1
      if (
        result.deploymentSettings.versionName ===
        result.deploymentSettings.lastDeploymentDetails.versionName
      ) {
        const updateBuildNumberProperty =
          target === "android"
            ? {
                "androidDeploymentDetails.lastDeploymentDetails.buildNumber": 1,
              }
            : { "iosDeploymentDetails.lastDeploymentDetails.buildNumber": 1 };

        updatedCustomHost = await CustomHostModel.findOneAndUpdate(
          {
            _id: new mongoose.Types.ObjectId(customHostId),
          },
          {
            $inc: updateBuildNumberProperty,
          },
          {
            new: true,
          },
        );
      }

      const updatedBuildNumber =
        target === "android"
          ? updatedCustomHost?.androidDeploymentDetails.lastDeploymentDetails
              .buildNumber
          : updatedCustomHost?.iosDeploymentDetails.lastDeploymentDetails
              .buildNumber;

      const createdDeployment = await DeploymentModel.create({
        host: new mongoose.Types.ObjectId(customHostId),
        user: new mongoose.Types.ObjectId(payload.id),
        platform: target,
        versionName: result.deploymentSettings.versionName,
        buildNumber: updatedBuildNumber
          ? updatedBuildNumber
          : result.deploymentSettings.buildNumber,
        status: "processing",
        tasks: [],
      });

      // populating the user details
      await createdDeployment.populate({
        path: "user",
        select: "name",
      });

      const { user, platform, versionName, buildNumber, status } =
        createdDeployment;

      return c.json(
        {
          message: "Create New Deployment",
          result: {
            _id: createdDeployment._id,
            user,
            platform,
            versionName,
            buildNumber,
            status,
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
      console.log(error);
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
  uploadAssetHandler,
};
