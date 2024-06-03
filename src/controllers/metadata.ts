import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";
import path from "path";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../../src/database";
import { Response } from "../../src/utils/statuscode";
import {
  deleteAndroidScreenshotsSchema,
  deleteIosScreenshotsSchema,
  reorderAndroidScreenshotsSchema,
  reorderIosScreenshotsSchema,
  updateAndroidDeploymentAccountSchema,
  updateAndroidDeploymentDetailsSchema,
  updateAndroidStoreMetadataSchema,
  updateIosDeploymentDetailsSchema,
  updateIosInfoMetadataSchema,
  updateIosReviewMetadataSchema,
  updateIosStoreMetadataSchema,
  updateMetadataLogoSchema,
} from "../../src/validations/metadata";
import { IIosScreenshots } from "../types/database";

const factory = createFactory();

const writeFile = fs.promises.writeFile;

async function base64ToImage(base64Str: string, path: string) {
  // Remove header
  const base64Data = base64Str.replace(/^data:image\/png;base64,/, "");

  // Write file
  await writeFile(path, base64Data, "base64");
}

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

    const appName = customhost.appName ?? customhost.brandname ?? "";
    const formattedName = appName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

    const result = await Mongo.metadata.insertOne({
      host: new ObjectId(appId),
      logo: "",
      backgroundType: "color",
      backgroundStartColor: "#ffffff",
      backgroundEndColor: "#ffffff",
      backgroundGradientAngle: 45,
      logoPadding: 15,
      iosDeploymentDetails: {
        bundleId: `com.tagmango.${formattedName}`,
        lastDeploymentDetails: {
          versionName: "3.0.7",
          buildNumber: 450,
        },
        isUnderReview: false,
      },
      androidDeploymentDetails: {
        bundleId: `com.tagmango.${formattedName}`,
        lastDeploymentDetails: {
          versionName: "3.0.7",
          buildNumber: 450,
        },
        isUnderReview: false,
      },
      androidStoreSettings: {
        title: appName,
        short_description: `Get access to all premium content by ${appName}!`,
        full_description: `Get access to all premium content in ${appName}. Access pre-recorded courses, enrol for live workshops, get certified and a lot more! Be a part of the awesome community that you always wanted to be in!`,
        video: "",
      },
      iosStoreSettings: {
        description: `Get access to all premium content in ${appName}. Access pre-recorded courses, enrol for live workshops, get certified and a lot more! Be a part of the awesome community that you always wanted to be in!`,
        keywords: "EdTech, Education",
        marketing_url: "",
        name: appName,
        privacy_url: "",
        promotional_text: `Get access to all premium content by ${appName}!`,
        subtitle: "",
        support_url: "https://help.tagmango.com",
      },
      iosInfoSettings: {
        copyright: "©2021 TagMango, Inc.",
        primary_category: "Education",
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

      await Promise.all([
        logo && base64ToImage(logo, `${logoPath}/logo.png`),
        base64ToImage(icon, `${logoPath}/icon.png`),
        base64ToImage(background, `${logoPath}/background.png`),
        base64ToImage(foreground, `${logoPath}/foreground.png`),
      ]);

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

const uploadAndroidFeatureGraphic = factory.createHandlers(async (c) => {
  try {
    const { appId } = c.req.param();
    const body = await c.req.parseBody();

    const featureGraphic = body.featureGraphic;

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(appId),
    });

    if (!metadata) {
      return c.json({ message: "Metadata not found" }, 404);
    }

    const fileSavePath = `./assets/${appId}/`;

    // Creating directory if it does not exist
    if (!fs.existsSync(fileSavePath)) {
      fs.mkdirSync(fileSavePath, {
        recursive: true,
      });
    }

    const name = `android/featureGraphic.png`;
    const filePath = path.join(fileSavePath, name);
    const buffer = await (featureGraphic as File).arrayBuffer();
    const file = Buffer.from(buffer);
    await writeFile(filePath, file);

    // Update metadata
    await Mongo.metadata.updateOne(
      { host: new ObjectId(appId) },
      { $set: { androidFeatureGraphic: name } },
    );

    return c.json(
      {
        message: "Feature Graphic uploaded successfully",
        result: {
          featureGraphic: name,
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

    const paths: string[] = [];
    const fileSavePath = `./assets/${appId}/android/screenshots`;
    const fileInnerPath = `android/screenshots`;

    // Creating directory if it does not exist
    if (!fs.existsSync(fileSavePath)) {
      fs.mkdirSync(fileSavePath, {
        recursive: true,
      });
    }

    if (Array.isArray(screenshots)) {
      await Promise.all(
        screenshots.map(async (screenshot) =>
          processScreenshot(
            screenshot as File,
            fileSavePath,
            fileInnerPath,
            paths,
          ),
        ),
      );
    } else {
      await processScreenshot(
        screenshots as File,
        fileSavePath,
        fileInnerPath,
        paths,
      );
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

const uploadIosScreenshots = factory.createHandlers(async (c) => {
  try {
    const { appId } = c.req.param();
    const body = await c.req.parseBody({ all: true });

    const screenshots = body.screenshots;
    const type = body.type as keyof IIosScreenshots;

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(appId),
    });

    if (!metadata) {
      return c.json({ message: "Metadata not found" }, 404);
    }

    const paths: string[] = [];
    const fileRootPath = `./assets/${appId}/`;
    const fileInnerPath = `ios/screenshots/${type}`;
    const fileSavePath = path.join(fileRootPath, fileInnerPath);

    // Creating directory if it does not exist
    if (!fs.existsSync(fileSavePath)) {
      fs.mkdirSync(fileSavePath, {
        recursive: true,
      });
    }

    if (Array.isArray(screenshots)) {
      await Promise.all(
        screenshots.map(async (screenshot) =>
          processScreenshot(
            screenshot as File,
            fileSavePath,
            fileInnerPath,
            paths,
          ),
        ),
      );
    } else {
      await processScreenshot(
        screenshots as File,
        fileSavePath,
        fileInnerPath,
        paths,
      );
    }

    // Update metadata
    await Mongo.metadata.updateOne(
      { host: new ObjectId(appId) },
      {
        $push: {
          [`iosScreenshots.${type}`]: { $each: paths },
        },
      },
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

const deleteIosScreenshots = factory.createHandlers(
  zValidator("json", deleteIosScreenshotsSchema),
  async (c) => {
    try {
      const { appId } = c.req.param();
      const { screenshots, type } = c.req.valid("json");

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(appId),
      });

      console.log(metadata?._id, screenshots, type);

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      // Delete screenshots
      screenshots.forEach((screenshot) => {
        fs.unlinkSync(`./assets/${appId}/${screenshot}`);
      });

      await Mongo.metadata.updateOne(
        { host: new ObjectId(appId) },
        { $pull: { [`iosScreenshots.${type}`]: { $in: screenshots } } },
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

export {
  createMetadata,
  deleteAndroidScreenshots,
  deleteIosScreenshots,
  getAppMetadata,
  reorderAndroidScreenshots,
  reorderIosScreenshots,
  updateAndroidDeveloperAccountForApp,
  updateBuildMetadataAndroidSettings,
  updateBuildMetadataIosSettings,
  updateInfoMetadataIosSettings,
  updateReviewMetadataIosSettings,
  updateStoreMetadataAndroidSettings,
  updateStoreMetadataIosSettings,
  uploadAndroidFeatureGraphic,
  uploadAndroidScreenshots,
  uploadIosScreenshots,
  uploadMetadataLogo,
};
