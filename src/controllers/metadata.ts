import fs from "fs";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";
import path from "path";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../../src/database";
import { Response } from "../../src/utils/statuscode";
import {
  deleteAndroidScreenshotsSchema,
  reorderAndroidScreenshotsSchema,
  updateAndroidDeploymentDetailsSchema,
  updateAndroidStoreMetadataSchema,
  updateIosDeploymentDetailsSchema,
  updateIosInfoMetadataSchema,
  updateIosReviewMetadataSchema,
  updateIosStoreMetadataSchema,
  updateMetadataLogoSchema,
} from "../../src/validations/metadata";

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

const getAppMetadata = factory.createHandlers(async (c) => {
  try {
    const { appId } = c.req.param();

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(appId),
    });

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

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
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

      await Mongo.metadata.updateOne(
        {
          host: new ObjectId(appId),
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

// const updateMetadataSettings = factory.createHandlers(
//   zValidator("json", updateMetadataSettingsSchema),
//   async (c) => {
//     try {
//       const { appId } = c.req.param();
//       const body = c.req.valid("json");

//       const metadata = await Mongo.metadata.findOne({
//         host: new ObjectId(appId),
//       });

//       if (!metadata) {
//         return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
//       }

//       await Mongo.metadata.updateOne(
//         {
//           host: new ObjectId(appId),
//         },
//         {
//           $set: body,
//         },
//       );

//       return c.json(
//         {
//           message: "Metadata updated successfully",
//         },
//         Response.OK,
//       );
//     } catch (error) {
//       return c.json(
//         { message: "Internal Server Error" },
//         Response.INTERNAL_SERVER_ERROR,
//       );
//     }
//   },
// );

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

const uploadAndroidScreenshots = factory.createHandlers(async (c) => {
  try {
    const { appId } = c.req.param();
    const body = await c.req.parseBody({ all: true });

    const screenshots = body.screenshots;

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(appId),
    });

    if (!metadata) {
      return c.json({ message: "Metadata not found" }, 404);
    }

    const paths = [];
    const fileSavePath = `./assets/${appId}/android/screenshots`;

    // Creating directory if it does not exist
    if (!fs.existsSync(fileSavePath)) {
      fs.mkdirSync(fileSavePath, {
        recursive: true,
      });
    }

    if (Array.isArray(screenshots)) {
      for (const screenshot of screenshots) {
        const name = `${new ObjectId()}.png`;
        const filePath = path.join(fileSavePath, name);
        paths.push(`android/screenshots/${name}`);
        const buffer = await (screenshot as File).arrayBuffer();
        const file = Buffer.from(buffer);
        fs.writeFileSync(filePath, file);
      }
    } else {
      const name = `${new ObjectId()}.png`;
      const filePath = path.join(fileSavePath, name);
      paths.push(`android/screenshots/${name}`);
      const buffer = await (screenshots as File).arrayBuffer();
      const file = Buffer.from(buffer);
      fs.writeFileSync(filePath, file);
    }

    // Update metadata
    await Mongo.metadata.updateOne(
      { host: new ObjectId(appId) },
      { $push: { androidScreenshots: { $each: paths } } },
    );

    return c.json(
      {
        message: "Screenshots uploaded successfully",
        result: {
          screenshots: paths,
        },
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
});

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

const deleteAndroidScreenshots = factory.createHandlers(
  zValidator("json", deleteAndroidScreenshotsSchema),
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

      // Delete screenshots
      body.screenshots.forEach((screenshot) => {
        fs.unlinkSync(`./assets/${appId}/${screenshot}`);
      });

      await Mongo.metadata.updateOne(
        { host: new ObjectId(appId) },
        { $pull: { androidScreenshots: { $in: body.screenshots } } },
      );

      return c.json(
        {
          message: "Screenshots deleted successfully",
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

export {
  deleteAndroidScreenshots,
  getAppMetadata,
  reorderAndroidScreenshots,
  updateBuildMetadataAndroidSettings,
  updateBuildMetadataIosSettings,
  updateInfoMetadataIosSettings,
  updateReviewMetadataIosSettings,
  updateStoreMetadataAndroidSettings,
  updateStoreMetadataIosSettings,
  uploadAndroidScreenshots,
  uploadMetadataLogo,
};
