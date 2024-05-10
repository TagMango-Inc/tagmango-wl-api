import fs from "fs";
import { createFactory } from "hono/factory";
import mongoose from "mongoose";
import CustomHostModel from "src/models/customHost.model";
import MetadataModel from "src/models/metadata.model";
import { Response } from "src/utils/statuscode";
import {
  createMetadataSchema,
  updateAndroidDeploymentDetailsSchema,
  updateIosDeploymentDetailsSchema,
  updateMetadataLogoSchema,
  updateMetadataSettingsSchema,
} from "src/validations/metadata";

import { zValidator } from "@hono/zod-validator";

const factory = createFactory();

function base64ToImage(base64Str: string, path: string) {
  // Remove header
  const base64Data = base64Str.replace(/^data:image\/png;base64,/, "");

  // Write file
  fs.writeFile(path, base64Data, "base64", (err) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log("File created successfully.");
  });
}

const createMetadata = factory.createHandlers(
  zValidator("json", createMetadataSchema),
  async (c) => {
    try {
      const { appName } = c.req.valid("json");
      const { appId } = c.req.param();

      const metadata = await MetadataModel.findOne({
        host: new mongoose.Types.ObjectId(appId),
      });

      if (metadata) {
        return c.json(
          { message: "Metadata already exists" },
          Response.CONFLICT,
        );
      }

      const newMetadata = await MetadataModel.create({
        host: new mongoose.Types.ObjectId(appId),
        appName,
      });

      await CustomHostModel.findByIdAndUpdate(appId, {
        deploymentMetadata: newMetadata._id,
      });

      return c.json(
        { message: "Metadata created successfully", result: newMetadata._id },
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

const getAppMetadata = factory.createHandlers(async (c) => {
  try {
    const { appId } = c.req.param();

    const metadata = await MetadataModel.findOne({
      host: new mongoose.Types.ObjectId(appId),
    });

    if (!metadata) {
      return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
    }

    return c.json(
      { message: "Metadata fetched successfully", result: metadata },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const uploadMetadataLogo = factory.createHandlers(
  zValidator("json", updateMetadataLogoSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await MetadataModel.findOne({
        host: new mongoose.Types.ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      // saving assets
      const logo = body.logo;
      const icon = body.icon;
      const background = body.background;
      const foreground = body.foreground;

      const logoPath = `./assets/${appId}`;

      // creating directory if not exists
      if (!fs.existsSync(logoPath)) {
        fs.mkdirSync(logoPath, {
          recursive: true,
        });
      }

      if (logo) {
        base64ToImage(logo, `${logoPath}/logo.png`);
      }
      base64ToImage(icon, `${logoPath}/icon.png`);
      base64ToImage(background, `${logoPath}/background.png`);
      base64ToImage(foreground, `${logoPath}/foreground.png`);

      const updatedMetadata = await MetadataModel.findOneAndUpdate(
        {
          host: new mongoose.Types.ObjectId(appId),
        },
        {
          $set: {
            logo: `logo.png`,
            backgroundType: body.backgroundType,
            backgroundStartColor: body.backgroundStartColor,
            backgroundEndColor: body.backgroundEndColor,
            backgroundGradientAngle: body.backgroundGradientAngle,
            logoPadding: body.logoPadding,
          },
        },
        {
          new: true,
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
          result: updatedMetadata?._id,
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

const updateMetadataAndroidSettings = factory.createHandlers(
  zValidator("json", updateAndroidDeploymentDetailsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await MetadataModel.findOne({
        host: new mongoose.Types.ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      const updatedMetadata = await MetadataModel.findOneAndUpdate(
        {
          host: new mongoose.Types.ObjectId(appId),
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
          result: updatedMetadata?._id,
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

const updateMetadataIosSettings = factory.createHandlers(
  zValidator("json", updateIosDeploymentDetailsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await MetadataModel.findOne({
        host: new mongoose.Types.ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      const updatedMetadata = await MetadataModel.findOneAndUpdate(
        {
          host: new mongoose.Types.ObjectId(appId),
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
          result: updatedMetadata?._id,
        },
        Response.OK,
      );
    } catch (error) {
      console.log(error);
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

const updateMetadataSettings = factory.createHandlers(
  zValidator("json", updateMetadataSettingsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const body = c.req.valid("json");

      const metadata = await MetadataModel.findOne({
        host: new mongoose.Types.ObjectId(appId),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      const updatedMetadata = await MetadataModel.findOneAndUpdate(
        {
          host: new mongoose.Types.ObjectId(appId),
        },
        {
          $set: body,
        },
      );

      return c.json(
        {
          message: "Metadata updated successfully",
          result: updatedMetadata?._id,
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

export {
  createMetadata,
  getAppMetadata,
  updateMetadataAndroidSettings,
  updateMetadataIosSettings,
  updateMetadataSettings,
  uploadMetadataLogo,
};
