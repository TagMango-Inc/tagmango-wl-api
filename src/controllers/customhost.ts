import fs from "fs";
import { createFactory } from "hono/factory";
import CustomHostModel from "src/models/customHost.model";
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

export {
  getAllCustomHostsHandler,
  getCustomHostByIdHandler,
  patchCustomHostByIdHandler,
  uploadAssetHandler,
};
