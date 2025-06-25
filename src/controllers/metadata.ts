import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";
import path from "path";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../../src/database";
import { getAppsByVersionCSV } from "../../src/utils/csv";
import { Response } from "../../src/utils/statuscode";
import {
  reorderAndroidScreenshotsSchema,
  reorderIosScreenshotsSchema,
  updateAndroidDeploymentAccountSchema,
  updateAndroidDeploymentDetailsSchema,
  updateAndroidStoreMetadataSchema,
  updateIosAppleIdSchema,
  updateIosDeploymentDetailsSchema,
  updateIosInfoMetadataSchema,
  updateIosReviewMetadataSchema,
  updateIosStoreMetadataSchema,
} from "../../src/validations/metadata";
import { AppFormStatus } from "../types/database";

const factory = createFactory();

const writeFile = fs.promises.writeFile;

async function processScreenshot(
  screenshot: File,
  fileSavePath: string,
  fileInnerPath: string,
  paths: string[],
) {
  const name = `${new ObjectId()}.png`;
  const filePath = path.join(fileSavePath, name);
  paths.push(`${fileInnerPath}/${name}`);
  const buffer = await screenshot.arrayBuffer();
  const file = Buffer.from(buffer);
  await writeFile(filePath, file);
}

const createMetadata = factory.createHandlers(async (c) => {
  try {
    const { appId } = c.req.param();

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(appId),
    });

    if (metadata) {
      return c.json(
        { message: "Metadata already exists", result: metadata },
        Response.OK,
      );
    }

    const customhost = await Mongo.customhost.findOne({
      _id: new ObjectId(appId),
    });

    if (!customhost) {
      return c.json({ message: "App not found" }, Response.NOT_FOUND);
    }

    const appName = customhost.appName ?? "";
    const formattedName = appName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

    const result = await Mongo.metadata.insertOne({
      host: new ObjectId(appId),
      logo: "",
      backgroundType: "color",
      backgroundStartColor: "#ffffff",
      backgroundEndColor: "#ffffff",
      backgroundGradientAngle: 45,
      logoPadding: 15,
      iosLogoPadding: 15,
      iosDeploymentDetails: {
        bundleId: `com.tagmango.${formattedName}`,
        lastDeploymentDetails: {
          versionName: "",
          buildNumber: 400,
        },
        isUnderReview: false,
      },
      androidDeploymentDetails: {
        bundleId: `com.tagmango.${formattedName}`,
        lastDeploymentDetails: {
          versionName: "",
          buildNumber: 450,
        },
        isUnderReview: false,
      },
      androidStoreSettings: {
        title: appName,
        short_description: "",
        full_description: "",
        video: "",
      },
      iosStoreSettings: {
        description: "",
        keywords: "EdTech, Education",
        marketing_url: "",
        name: appName,
        privacy_url: "",
        promotional_text: ``,
        subtitle: "",
        support_url: "https://help.tagmango.com",
      },
      iosInfoSettings: {
        copyright: "©2021 TagMango, Inc.",
        primary_category: "EDUCATION",
      },
      iosReviewSettings: {
        demo_password: "123456",
        demo_user: "1223334444",
        email_address: "hasan@tagmango.com",
        first_name: "Mohammad",
        last_name: "Hasan",
        notes:
          'The App requires OTP to login. Please use the password as OTP to login.\n\nIf the app is expecting email id to login please use below credentials:\nemail:\ntest.review@tagmango.com\npassword(OTP):\n123456\n\nIf on entering the OTP it shows "Login Limit Exceeded" on a modal press on "Continue" button to enter the app.',
        phone_number: "+919748286867",
      },

      isFormImported: false,
    } as any);

    const newMetadata = await Mongo.metadata.findOne({
      _id: result.insertedId,
    });

    return c.json(
      {
        message: "Metadata created successfully",
        result: newMetadata,
      },
      Response.CREATED,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const getAppMetadata = factory.createHandlers(async (c) => {
  try {
    const { appId } = c.req.param();

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(appId),
    });

    const form = await Mongo.app_forms.findOne({
      host: new ObjectId(appId),
      parentForm: { $exists: false },
    });

    return c.json(
      {
        message: "Metadata fetched successfully",
        result: {
          ...metadata,
          isFormAvailableForImport: Boolean(
            form?.status === AppFormStatus.APPROVED &&
              form?.isFormSubmitted &&
              !metadata?.isFormImported,
          ),
          isMetadataCreated: Boolean(metadata),
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

const updateBuildMetadataAndroidSettings = factory.createHandlers(
  zValidator("json", updateAndroidDeploymentDetailsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
        },
        {
          $set: {
            "androidDeploymentDetails.bundleId": body.bundleId,
            "androidDeploymentDetails.lastDeploymentDetails.versionName":
              body.versionName,
            "androidDeploymentDetails.lastDeploymentDetails.buildNumber":
              body.buildNumber,
          },
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
        },
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

const updateStoreMetadataAndroidSettings = factory.createHandlers(
  zValidator("json", updateAndroidStoreMetadataSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
        },
        {
          $set: {
            androidStoreSettings: body,
          },
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
        },
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

const reorderAndroidScreenshots = factory.createHandlers(
  zValidator("json", reorderAndroidScreenshotsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        { host: new ObjectId(appId) },
        { $set: { androidScreenshots: body.screenshots } },
      );

      return c.json(
        {
          message: "Screenshots reordered successfully",
          result: {
            screenshots: body.screenshots,
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
  },
);

const updateAndroidDeveloperAccountForApp = factory.createHandlers(
  zValidator("json", updateAndroidDeploymentAccountSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const { developerAccountId } = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        { host: new ObjectId(appId) },
        {
          $set: {
            androidDeveloperAccount: new ObjectId(developerAccountId),
          },
        },
      );

      return c.json(
        {
          message: "Developer Account updated successfully",
        },
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

const updateIosAppleId = factory.createHandlers(
  zValidator("json", updateIosAppleIdSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
        },
        {
          $set: {
            "iosDeploymentDetails.appleId": body.appleId,
          },
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
          result: body.appleId,
        },
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

const updateBuildMetadataIosSettings = factory.createHandlers(
  zValidator("json", updateIosDeploymentDetailsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
        },
        {
          $set: {
            "iosDeploymentDetails.bundleId": body.bundleId,
            "iosDeploymentDetails.lastDeploymentDetails.versionName":
              body.versionName,
            "iosDeploymentDetails.lastDeploymentDetails.buildNumber":
              body.buildNumber,
            "iosDeploymentDetails.isUnderReview": body.isUnderReview,
          },
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
        },
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

const updateStoreMetadataIosSettings = factory.createHandlers(
  zValidator("json", updateIosStoreMetadataSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
        },
        {
          $set: {
            iosStoreSettings: body,
          },
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
        },
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

const updateInfoMetadataIosSettings = factory.createHandlers(
  zValidator("json", updateIosInfoMetadataSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
        },
        {
          $set: {
            iosInfoSettings: body,
          },
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
        },
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

const updateReviewMetadataIosSettings = factory.createHandlers(
  zValidator("json", updateIosReviewMetadataSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
        },
        {
          $set: {
            iosReviewSettings: body,
          },
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
        },
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

const reorderIosScreenshots = factory.createHandlers(
  zValidator("json", reorderIosScreenshotsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const { screenshots, type } = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      await Mongo.metadata.updateOne(
        { host: new ObjectId(appId) },
        {
          $set: {
            [`iosScreenshots.${type}`]: screenshots,
          },
        },
      );

      return c.json(
        {
          message: "Screenshots reordered successfully",
          result: {
            screenshots: screenshots,
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
  },
);

// get all the apps that are deployed with the specific version
const getAppsCountByVersion = factory.createHandlers(async (c) => {
  try {
    const { version: targetVersion } = c.req.param();
    const { format, platform } = c.req.query();

    // If format is csv, return CSV data
    if (format === "csv") {
      if (!platform) {
        return c.json(
          { message: "Platform is required" },
          Response.BAD_REQUEST,
        );
      }

      if (!targetVersion) {
        return c.json({ message: "Version is required" }, Response.BAD_REQUEST);
      }

      return getAppsByVersionCSV(c, targetVersion, platform);
    }

    const result = await Mongo.customhost
      .aggregate([
        {
          $match: {
            platformSuspended: { $ne: true },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "creator",
            foreignField: "_id",
            as: "creatorDetails",
          },
        },
        {
          $match: {
            "creatorDetails.whitelabelPlanType": "enterprise-plan",
          },
        },
        {
          $lookup: {
            from: "customhostmetadatas",
            localField: "_id",
            foreignField: "host",
            as: "metadata",
          },
        },
        {
          $unwind: "$metadata",
        },
        {
          $facet: {
            androidCount: [
              {
                $match: {
                  androidShareLink: { $type: "string", $ne: "" },
                  "metadata.androidDeploymentDetails.versionName":
                    targetVersion,
                },
              },
              { $count: "count" },
            ],
            iosCount: [
              {
                $match: {
                  iosShareLink: { $type: "string", $ne: "" },
                  "metadata.iosDeploymentDetails.versionName": targetVersion,
                },
              },
              { $count: "count" },
            ],
          },
        },
        {
          $project: {
            android: {
              $ifNull: [{ $arrayElemAt: ["$androidCount.count", 0] }, 0],
            },
            ios: { $ifNull: [{ $arrayElemAt: ["$iosCount.count", 0] }, 0] },
          },
        },
      ])
      .toArray();

    return c.json(
      {
        message: "Apps count fetched successfully",
        result: result[0],
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
  createMetadata,
  getAppMetadata,
  getAppsCountByVersion,
  reorderAndroidScreenshots,
  reorderIosScreenshots,
  updateAndroidDeveloperAccountForApp,
  updateBuildMetadataAndroidSettings,
  updateBuildMetadataIosSettings,
  updateInfoMetadataIosSettings,
  updateIosAppleId,
  updateReviewMetadataIosSettings,
  updateStoreMetadataAndroidSettings,
  updateStoreMetadataIosSettings,
};
