import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";
import Mongo from "src/database";
import { patchCustomHostByIdSchema } from "src/validations/customhost";

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
    const totalCustomHosts = await Mongo.customhost.countDocuments();
    const customHosts = await Mongo.customhost
      .aggregate([
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
          $lookup: {
            from: "customhostmetadatas",
            localField: "deploymentMetadata",
            foreignField: "_id",
            as: "deploymentDetails",
          },
        },
        {
          $unwind: {
            path: "$deploymentDetails",
          },
        },
        {
          $project: {
            appName: 1,
            host: 1,
            logo: 1,
            createdAt: 1,
            updatedAt: 1,
            androidVersionName:
              "$deploymentDetails.androidDeploymentDetails.versionName",
            iosVersionName:
              "$deploymentDetails.iosDeploymentDetails.versionName",
            iosUnderReview:
              "$deploymentDetails.iosDeploymentDetails.isUnderReview",
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

    const totalSearchResults = await Mongo.customhost
      .find({
        $or: [
          { appName: { $regex: new RegExp(SEARCH, "i") } },
          { host: { $regex: new RegExp(SEARCH, "i") } },
          { brandname: { $regex: new RegExp(SEARCH, "i") } },
        ],
      })
      .toArray();

    const hasNextPage = totalSearchResults.length > PAGE * LIMIT;
    return c.json(
      {
        message: "All Custom Hosts",
        result: {
          customHosts,
          totalSearchResults: totalSearchResults.length,
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
    const customHost = await Mongo.customhost.findOne({
      _id: new ObjectId(id),
    });
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
      const body = c.req.valid("json");
      const customHost = await Mongo.customhost.findOne({
        _id: new ObjectId(id),
      });
      if (!customHost) {
        return c.json(
          { message: "Custom Host not found" },
          { status: 404, statusText: "Not Found" },
        );
      }
      const updatedCustomHost = await Mongo.customhost.findOneAndUpdate(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            ...(body as any),
          },
        },
        {
          returnDocument: "after",
        },
      );
      return c.json(
        { message: "Custom Host Updated", result: updatedCustomHost },
        { status: 200, statusText: "OK" },
      );
    } catch (error) {
      console.log(error);
      return c.json(
        { message: "Internal Server Error" },
        { status: 500, statusText: "Internal Server Error" },
      );
    }
  },
);

export {
  getAllCustomHostsHandler,
  getCustomHostByIdHandler,
  patchCustomHostByIdHandler,
};
