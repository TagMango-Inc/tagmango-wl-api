import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../../src/database";
import { patchCustomHostByIdSchema } from "../../src/validations/customhost";
import { AppFormStatus } from "../types/database";
import { Response } from "../utils/statuscode";

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

    const searchedCustomhostsArray = await Mongo.customhost
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
            preserveNullAndEmptyArrays: true,
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

    return c.json(
      {
        message: "All Custom Hosts",
        result: {
          customHosts: searchedCustomhostsArray,
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
      return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
    }
    return c.json(
      { message: "Fetched Custom Host", result: customHost },
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
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
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

      // if the updatedCustomHost contains iosShareLink
      // then extract and update appleId from that link
      if (updatedCustomHost && updatedCustomHost.iosShareLink) {
        const matches = updatedCustomHost.iosShareLink.match(/id(\d+)/i);
        if (matches && matches?.length > 0) {
          const appleId = matches[0].split("id").join("");
          if (appleId) {
            await Mongo.metadata.findOneAndUpdate(
              {
                host: new ObjectId(id),
              },
              {
                $set: {
                  "iosDeploymentDetails.appleId": appleId,
                },
              },
            );
          }
        }
      }

      // if the updatedCustomHost contains both androidShareLink and iosShareLink
      // then find the app_form and update the status of the app_form to DEPLOYED if it is not already DEPLOYED
      if (
        updatedCustomHost &&
        updatedCustomHost.androidShareLink &&
        updatedCustomHost.iosShareLink
      ) {
        const appForm = await Mongo.app_forms.findOne({
          host: new ObjectId(id),
        });
        if (appForm && appForm.status !== AppFormStatus.DEPLOYED) {
          await Mongo.app_forms.findOneAndUpdate(
            {
              host: new ObjectId(id),
            },
            {
              $set: {
                status: AppFormStatus.DEPLOYED,
                updatedAt: new Date(),
              },
            },
          );
        }
      }

      return c.json(
        { message: "Custom Host Updated", result: updatedCustomHost },
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

export {
  getAllCustomHostsHandler,
  getCustomHostByIdHandler,
  patchCustomHostByIdHandler,
};
