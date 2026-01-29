import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../database";
import { updateDeploymentRequestStatusSchema } from "../validations/deploymentRequest";
import { Response } from "../utils/statuscode";

const factory = createFactory();

/**
 * GET /deployment-requests
 * List all deployment requests with pagination, search, and filtering
 */
const listDeploymentRequestsHandler = factory.createHandlers(async (c) => {
  try {
    const { page, limit, search, status, platform } = c.req.query();

    const PAGE = page ? parseInt(page) : 1;
    const LIMIT = limit ? parseInt(limit) : 20;
    const SEARCH = search || "";

    // Build match conditions
    const matchConditions: any = {};

    // Filter by platform - check if platform field exists
    if (platform && platform !== "all") {
      matchConditions[platform] = { $exists: true };
    }

    // Filter by status
    if (status && status !== "all") {
      if (platform && platform !== "all") {
        matchConditions[`${platform}.status`] = status;
      } else {
        // Match if either platform has this status
        matchConditions.$or = [
          { "android.status": status },
          { "ios.status": status },
        ];
      }
    }

    const pipeline: any[] = [
      // Join with customhosts to get app details
      {
        $lookup: {
          from: "customhosts",
          localField: "host",
          foreignField: "_id",
          as: "hostDetails",
        },
      },
      { $unwind: "$hostDetails" },
      // Search by app name or host
      ...(SEARCH
        ? [
            {
              $match: {
                $or: [
                  { "hostDetails.appName": { $regex: new RegExp(SEARCH, "i") } },
                  { "hostDetails.host": { $regex: new RegExp(SEARCH, "i") } },
                  {
                    "hostDetails.brandname": { $regex: new RegExp(SEARCH, "i") },
                  },
                ],
              },
            },
          ]
        : []),
      // Apply filters
      ...(Object.keys(matchConditions).length > 0
        ? [{ $match: matchConditions }]
        : []),
      // Sort by most recent first
      { $sort: { createdAt: -1 } },
      // Pagination
      { $skip: (PAGE - 1) * LIMIT },
      { $limit: LIMIT },
      // Project final shape
      {
        $project: {
          _id: 1,
          host: 1,
          android: 1,
          ios: 1,
          createdAt: 1,
          updatedAt: 1,
          appName: "$hostDetails.appName",
          brandname: "$hostDetails.brandname",
          hostUrl: "$hostDetails.host",
          logo: "$hostDetails.logo",
        },
      },
    ];

    const deploymentRequests = await Mongo.deployment_requests
      .aggregate(pipeline)
      .toArray();

    // Get total count for pagination
    const countPipeline: any[] = [
      {
        $lookup: {
          from: "customhosts",
          localField: "host",
          foreignField: "_id",
          as: "hostDetails",
        },
      },
      { $unwind: "$hostDetails" },
      ...(SEARCH
        ? [
            {
              $match: {
                $or: [
                  { "hostDetails.appName": { $regex: new RegExp(SEARCH, "i") } },
                  { "hostDetails.host": { $regex: new RegExp(SEARCH, "i") } },
                  {
                    "hostDetails.brandname": { $regex: new RegExp(SEARCH, "i") },
                  },
                ],
              },
            },
          ]
        : []),
      ...(Object.keys(matchConditions).length > 0
        ? [{ $match: matchConditions }]
        : []),
      { $count: "total" },
    ];

    const countResult = await Mongo.deployment_requests
      .aggregate(countPipeline)
      .toArray();
    const total = countResult[0]?.total || 0;

    return c.json(
      {
        message: "Deployment requests fetched successfully",
        result: {
          deploymentRequests,
          pagination: {
            page: PAGE,
            limit: LIMIT,
            total,
            hasMore: PAGE * LIMIT < total,
          },
        },
      },
      Response.OK,
    );
  } catch (error) {
    console.error("Error fetching deployment requests:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * GET /deployment-requests/:id
 * Get single deployment request by ID
 */
const getDeploymentRequestHandler = factory.createHandlers(async (c) => {
  try {
    const { id } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "Invalid request ID" }, Response.BAD_REQUEST);
    }

    const pipeline = [
      { $match: { _id: new ObjectId(id) } },
      {
        $lookup: {
          from: "customhosts",
          localField: "host",
          foreignField: "_id",
          as: "hostDetails",
        },
      },
      { $unwind: "$hostDetails" },
      {
        $project: {
          _id: 1,
          host: 1,
          android: 1,
          ios: 1,
          createdAt: 1,
          updatedAt: 1,
          appName: "$hostDetails.appName",
          brandname: "$hostDetails.brandname",
          hostUrl: "$hostDetails.host",
          logo: "$hostDetails.logo",
        },
      },
    ];

    const results = await Mongo.deployment_requests
      .aggregate(pipeline)
      .toArray();

    if (results.length === 0) {
      return c.json(
        { message: "Deployment request not found" },
        Response.NOT_FOUND,
      );
    }

    return c.json(
      {
        message: "Deployment request fetched successfully",
        result: results[0],
      },
      Response.OK,
    );
  } catch (error) {
    console.error("Error fetching deployment request:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * PATCH /deployment-requests/:id/status
 * Update deployment request status for a specific platform
 */
const updateDeploymentRequestStatusHandler = factory.createHandlers(
  zValidator("json", updateDeploymentRequestStatusSchema),
  async (c) => {
    try {
      const { id } = c.req.param();
      const { platform, status } = c.req.valid("json");

      if (!ObjectId.isValid(id)) {
        return c.json({ message: "Invalid request ID" }, Response.BAD_REQUEST);
      }

      // Check if deployment request exists
      const existingRequest = await Mongo.deployment_requests.findOne({
        _id: new ObjectId(id),
      });

      if (!existingRequest) {
        return c.json(
          { message: "Deployment request not found" },
          Response.NOT_FOUND,
        );
      }

      // Check if the platform exists in the request
      if (!existingRequest[platform]) {
        return c.json(
          { message: `No ${platform} deployment request found` },
          Response.BAD_REQUEST,
        );
      }

      // Update the status
      const updateResult = await Mongo.deployment_requests.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            [`${platform}.status`]: status,
            updatedAt: new Date(),
          },
        },
      );

      if (!updateResult.acknowledged) {
        return c.json(
          { message: "Failed to update deployment request" },
          Response.INTERNAL_SERVER_ERROR,
        );
      }

      return c.json(
        {
          message: `${platform} deployment request status updated to ${status}`,
          result: { platform, status },
        },
        Response.OK,
      );
    } catch (error) {
      console.error("Error updating deployment request status:", error);
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
 * DELETE /deployment-requests/:id
 * Delete a deployment request
 */
const deleteDeploymentRequestHandler = factory.createHandlers(async (c) => {
  try {
    const { id } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "Invalid request ID" }, Response.BAD_REQUEST);
    }

    const deleteResult = await Mongo.deployment_requests.deleteOne({
      _id: new ObjectId(id),
    });

    if (deleteResult.deletedCount === 0) {
      return c.json(
        { message: "Deployment request not found" },
        Response.NOT_FOUND,
      );
    }

    return c.json(
      { message: "Deployment request deleted successfully" },
      Response.OK,
    );
  } catch (error) {
    console.error("Error deleting deployment request:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * DELETE /deployment-requests/:id/:platform
 * Delete a specific platform from deployment request
 */
const deleteDeploymentRequestPlatformHandler = factory.createHandlers(
  async (c) => {
    try {
      const { id, platform } = c.req.param();

      if (!ObjectId.isValid(id)) {
        return c.json({ message: "Invalid request ID" }, Response.BAD_REQUEST);
      }

      if (!["android", "ios"].includes(platform)) {
        return c.json({ message: "Invalid platform" }, Response.BAD_REQUEST);
      }

      // Check if this is the only platform - if so, delete the whole record
      const existingRequest = await Mongo.deployment_requests.findOne({
        _id: new ObjectId(id),
      });

      if (!existingRequest) {
        return c.json(
          { message: "Deployment request not found" },
          Response.NOT_FOUND,
        );
      }

      const otherPlatform = platform === "android" ? "ios" : "android";
      const hasOtherPlatform =
        !!existingRequest[otherPlatform as "android" | "ios"];

      if (!hasOtherPlatform) {
        // Delete the whole record
        await Mongo.deployment_requests.deleteOne({ _id: new ObjectId(id) });
      } else {
        // Just unset the platform
        await Mongo.deployment_requests.updateOne(
          { _id: new ObjectId(id) },
          {
            $unset: { [platform]: "" },
            $set: { updatedAt: new Date() },
          },
        );
      }

      return c.json(
        { message: `${platform} deployment request deleted successfully` },
        Response.OK,
      );
    } catch (error) {
      console.error("Error deleting platform deployment request:", error);
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
 * GET /deployment-requests/stats
 * Get counts by status for dashboard
 */
const getDeploymentRequestStatsHandler = factory.createHandlers(async (c) => {
  try {
    const stats = await Mongo.deployment_requests
      .aggregate([
        {
          $facet: {
            androidPending: [
              { $match: { "android.status": "pending" } },
              { $count: "count" },
            ],
            androidProcessing: [
              { $match: { "android.status": "processing" } },
              { $count: "count" },
            ],
            iosPending: [
              { $match: { "ios.status": "pending" } },
              { $count: "count" },
            ],
            iosProcessing: [
              { $match: { "ios.status": "processing" } },
              { $count: "count" },
            ],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const result = stats[0];

    return c.json(
      {
        message: "Stats fetched successfully",
        result: {
          android: {
            pending: result.androidPending[0]?.count || 0,
            processing: result.androidProcessing[0]?.count || 0,
          },
          ios: {
            pending: result.iosPending[0]?.count || 0,
            processing: result.iosProcessing[0]?.count || 0,
          },
          total: result.total[0]?.count || 0,
        },
      },
      Response.OK,
    );
  } catch (error) {
    console.error("Error fetching deployment request stats:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

export {
  listDeploymentRequestsHandler,
  getDeploymentRequestHandler,
  updateDeploymentRequestStatusHandler,
  deleteDeploymentRequestHandler,
  deleteDeploymentRequestPlatformHandler,
  getDeploymentRequestStatsHandler,
};
