import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";
import path from "path";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../database";
import authenticationMiddleware from "../middleware/authentication";
import { JWTPayloadType } from "../types";
import { AppFormStatus, IAppForm } from "../types/database";
import { base64ToImage } from "../utils/image";
import { Response } from "../utils/statuscode";
import {
  generateFormValuesAISchema,
  rejectFormByIdSchema,
} from "../validations/appForms";
import {
  updateAndroidStoreMetadataSchema,
  updateIosInfoMetadataSchema,
  updateIosStoreMetadataSchema,
  updateMetadataLogoSchema,
} from "../validations/metadata";
import { generateAppFormDescriptions } from "./openai";

const factory = createFactory();

const writeFile = fs.promises.writeFile;

/**
 * GET wl/forms/
 * Get all customhosts whose user is part of enterprise-plan and merge that data with the form data
 * Protected Route
 * Pagination and search is also implemented
 * @param page: number
 * @param limit: number
 * @param search: string
 * @param status: 'not-sent' | 'pending' | 'in-progress' | 'in-review' | 'approved' | 'rejected' | 'deployed'
 * @returns { message: string, result: { customHosts: Array } }
 */
const getAllFormsHandler = factory.createHandlers(async (c) => {
  try {
    const { page, limit, search, status } = c.req.query();
    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 10;
    let SEARCH = search ? (search as string) : "";
    let STATUS = status ? (status as string) : null;

    // Calculate offset for pagination
    const OFFSET = (PAGE - 1) * LIMIT;

    const matchStatus = STATUS
      ? {
          $or: [
            {
              appFormDetails: { $exists: false },
              $expr: { $eq: [STATUS, "not-sent"] },
            },
            {
              appFormDetails: { $exists: true },
              "appFormDetails.status": STATUS,
            },
          ],
        }
      : {};

    const pipeline = [
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
          from: "appforms",
          localField: "_id",
          foreignField: "host",
          as: "appFormDetails",
        },
      },
      {
        $unwind: {
          path: "$appFormDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: matchStatus,
      },
      {
        $addFields: {
          sortField: {
            $ifNull: ["$appFormDetails.updatedAt", "$createdAt"],
          },
        },
      },
      {
        $sort: { sortField: -1 },
      },
      {
        $skip: OFFSET,
      },
      {
        $limit: LIMIT,
      },
    ];

    const customHostsArr = await Mongo.customhost.aggregate(pipeline).toArray();

    const customHosts = customHostsArr.map((customHost: any) => {
      return {
        _id: customHost._id,
        host: customHost.host,
        appName: customHost.appName,
        brandname: customHost.brandname,
        logo: customHost.logo,
        createdAt: customHost.createdAt,
        status: customHost.appFormDetails
          ? customHost.appFormDetails.status
          : "not-sent",
        formId: customHost.appFormDetails
          ? customHost.appFormDetails._id
          : null,
        formUpdatedAt: customHost.appFormDetails
          ? customHost.appFormDetails.updatedAt
          : null,
        isFormSubmitted: customHost.appFormDetails
          ? customHost.appFormDetails.isFormSubmitted ?? false
          : false,
      };
    });

    return c.json(
      {
        message: "All Custom Hosts",
        result: {
          customHosts,
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
 * GET wl/forms/:formId
 * Get the form data by formId
 * Protected Route
 * @param formId: string
 */
const getFormByIdHandler = factory.createHandlers(async (c) => {
  try {
    const { formId } = c.req.param();

    const appForm = await Mongo.app_forms.findOne({
      _id: new ObjectId(formId),
    });
    if (!appForm) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }

    const customHost = await Mongo.customhost.findOne({
      _id: new ObjectId(appForm.host),
    });

    if (!customHost) {
      return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
    }

    let reviewer = null;
    if (appForm.rejectionDetails && appForm.rejectionDetails.reviewer) {
      reviewer = await Mongo.user.findOne({
        _id: new ObjectId(appForm.rejectionDetails.reviewer),
      });

      if (!reviewer) {
        return c.json({ message: "Reviewer not found" }, Response.NOT_FOUND);
      }
    }

    return c.json(
      {
        message: "Form Details",
        result: {
          form: {
            ...appForm,
            rejectionDetails:
              appForm.rejectionDetails && reviewer
                ? {
                    ...appForm.rejectionDetails,
                    reviewer: {
                      _id: reviewer._id,
                      name: reviewer.name,
                      email: reviewer.email,
                    },
                  }
                : appForm.rejectionDetails,
          },
          customHost: {
            _id: customHost._id,
            host: customHost.host,
            appName: customHost.appName,
            brandname: customHost.brandname,
            logo: customHost.logo,
            createdAt: customHost.createdAt,
          },
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
 * GET wl/forms/host/:hostId/overview
 * Get the form overview data by customhostId
 * Protected Route
 * @param hostId: string
 */
const getFormOverviewByHostIdHandler = factory.createHandlers(async (c) => {
  try {
    const { hostId } = c.req.param();

    const customHost = await Mongo.customhost.findOne({
      _id: new ObjectId(hostId),
    });

    if (!customHost) {
      return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
    }

    const appForm = await Mongo.app_forms.findOne({
      host: new ObjectId(hostId),
    });
    if (!appForm) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }

    let reviewer = null;
    if (appForm.rejectionDetails && appForm.rejectionDetails.reviewer) {
      reviewer = await Mongo.user.findOne({
        _id: new ObjectId(appForm.rejectionDetails.reviewer),
      });

      if (!reviewer) {
        return c.json({ message: "Reviewer not found" }, Response.NOT_FOUND);
      }
    }

    return c.json(
      {
        message: "Form Overview",
        result: {
          form: {
            _id: appForm._id,
            status: appForm.status,
            isFormSubmitted: appForm.isFormSubmitted ?? false,
            rejectionDetails:
              appForm.rejectionDetails && reviewer
                ? {
                    ...appForm.rejectionDetails,
                    reviewer: {
                      _id: reviewer._id,
                      name: reviewer.name,
                      email: reviewer.email,
                    },
                  }
                : appForm.rejectionDetails,
            updatedAt: appForm.updatedAt,
          },
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
 * GET wl/forms/host/:hostId
 * Get the form data by customhostId
 * Protected Route
 * @param hostId: string
 */
const getFormByHostIdHandler = factory.createHandlers(async (c) => {
  try {
    const { hostId } = c.req.param();

    const customHost = await Mongo.customhost.findOne({
      _id: new ObjectId(hostId),
    });

    if (!customHost) {
      return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
    }

    const appForm = await Mongo.app_forms.findOne({
      host: new ObjectId(hostId),
    });
    if (!appForm) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }

    let reviewer = null;
    if (appForm.rejectionDetails && appForm.rejectionDetails.reviewer) {
      reviewer = await Mongo.user.findOne({
        _id: new ObjectId(appForm.rejectionDetails.reviewer),
      });

      if (!reviewer) {
        return c.json({ message: "Reviewer not found" }, Response.NOT_FOUND);
      }
    }

    return c.json(
      {
        message: "Form Details",
        result: {
          form: {
            ...appForm,
            rejectionDetails:
              appForm.rejectionDetails && reviewer
                ? {
                    ...appForm.rejectionDetails,
                    reviewer: {
                      _id: reviewer._id,
                      name: reviewer.name,
                      email: reviewer.email,
                    },
                  }
                : appForm.rejectionDetails,
          },
          customHost: {
            _id: customHost._id,
            host: customHost.host,
            appName: customHost.appName,
            brandname: customHost.brandname,
            logo: customHost.logo,
            createdAt: customHost.createdAt,
          },
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
 * POST wl/forms/host/:hostId/request
 * Create a new form request for the customhost with placeholder data
 * Protected Route
 */
const createFormRequestHandler = factory.createHandlers(
  authenticationMiddleware,
  async (c) => {
    try {
      const { hostId } = c.req.param();
      const customHost = await Mongo.customhost.findOne({
        _id: new ObjectId(hostId),
      });
      if (!customHost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }

      const appFormExists = await Mongo.app_forms.findOne({
        host: new ObjectId(hostId),
      });

      if (appFormExists) {
        return c.json(
          { message: "Form request already exists" },
          Response.BAD_REQUEST,
        );
      }

      const appName = customHost.appName || customHost.brandname || "";

      const appForm: IAppForm = {
        host: customHost._id,

        status: AppFormStatus.PENDING,

        logo: "",

        backgroundType: "color",
        backgroundStartColor: "#ffffff",
        backgroundEndColor: "#ffffff",
        backgroundGradientAngle: 45,
        logoPadding: 15,

        androidStoreSettings: {
          title: appName,
          short_description: ``,
          full_description: ``,
          video: "",
        },
        iosStoreSettings: {
          description: ``,
          keywords: "",
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
        androidFeatureGraphic: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await Mongo.app_forms.insertOne(appForm);
      return c.json(
        {
          message: "Form request created successfully",
          result: {
            formId: result.insertedId,
            status: AppFormStatus.PENDING,
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

/**
 * PATCH wl/forms/:formId
 * Update the form data by formId
 * Protected Route
 */
// const patchFormByIdHandler = factory.createHandlers(
//   zValidator("json", patchFormByIdSchema),
//   async (c) => {
//     try {
//       const { formId } = c.req.param();
//       const body = c.req.valid("json");

//       const result = await Mongo.app_forms.updateOne(
//         { _id: new ObjectId(formId) },
//         { $set: { ...body, updatedAt: new Date(), isFormSubmitted: true } },
//       );
//       if (result.modifiedCount === 0) {
//         return c.json({ message: "Form not found" }, Response.NOT_FOUND);
//       }
//       return c.json({ message: "Form updated successfully" }, Response.OK);
//     } catch (error) {
//       return c.json(
//         { message: "Internal Server Error" },
//         Response.INTERNAL_SERVER_ERROR,
//       );
//     }
//   },
// );

/**
 * PATCH wl.forms/:formId/logo/upload
 * Upload the logo for the form by formId
 * Protected Route
 */
const uploadFormLogo = factory.createHandlers(
  zValidator("json", updateMetadataLogoSchema),
  async (c) => {
    try {
      const { formId } = c.req.param();
      const body = c.req.valid("json");

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (
        [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
      ) {
        return c.json(
          { message: "Cannot update logo for approved or deployed form" },
          Response.BAD_REQUEST,
        );
      }

      // saving assets
      const logo = body.logo;
      const icon = body.icon;
      const background = body.background;
      const foreground = body.foreground;

      const logoPath = `./forms/${formId}`;

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

      await Mongo.app_forms.updateOne(
        {
          _id: new ObjectId(formId),
        },
        {
          $set: {
            logo: `logo.png`,
            backgroundType: body.backgroundType,
            backgroundStartColor: body.backgroundStartColor,
            backgroundEndColor: body.backgroundEndColor,
            backgroundGradientAngle: body.backgroundGradientAngle,
            logoPadding: body.logoPadding,
            status: AppFormStatus.IN_PROGRESS,
            updatedAt: new Date(),
          },
        },
      );

      return c.json(
        {
          message: "Logo updated successfully",
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

/**
 * PATCH wl/forms/:formId/android/store
 * Update the android store settings for the form by formId
 * Protected Route
 */
const updateStoreAndroidSettings = factory.createHandlers(
  zValidator("json", updateAndroidStoreMetadataSchema),
  async (c) => {
    try {
      const { formId } = c.req.param();
      const body = c.req.valid("json");

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (
        [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
      ) {
        return c.json(
          {
            message:
              "Cannot update store settings for approved or deployed form",
          },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            androidStoreSettings: body,
            status: AppFormStatus.IN_PROGRESS,
            updatedAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json(
        { message: "Android Store Settings updated successfully" },
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

/**
 * PATCH wl/forms/:formId/android/feature-graphic
 * Upload the android feature graphic for the form by formId
 * Protected Route
 */
const uploadAndroidFeatureGraphic = factory.createHandlers(async (c) => {
  try {
    const { formId } = c.req.param();
    const body = await c.req.parseBody();

    const featureGraphic = body.featureGraphic;

    const form = await Mongo.app_forms.findOne({
      _id: new ObjectId(formId),
    });

    if (!form) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }

    if (
      [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
    ) {
      return c.json(
        {
          message:
            "Cannot update feature graphic for approved or deployed form",
        },
        Response.BAD_REQUEST,
      );
    }

    const fileSavePath = `./forms/${formId}/`;

    // Creating directory if it does not exist
    if (!fs.existsSync(`${fileSavePath}/android`)) {
      fs.mkdirSync(`${fileSavePath}/android`, {
        recursive: true,
      });
    }

    const name = `android/featureGraphic.png`;
    const filePath = path.join(fileSavePath, name);
    const buffer = await (featureGraphic as File).arrayBuffer();
    const file = Buffer.from(buffer);
    await writeFile(filePath, file);

    await Mongo.app_forms.updateOne(
      {
        _id: new ObjectId(formId),
      },
      {
        $set: {
          androidFeatureGraphic: name,
          status: AppFormStatus.IN_PROGRESS,
          updatedAt: new Date(),
        },
      },
    );

    return c.json(
      {
        message: "Feature Graphic updated successfully",
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
 * PATCH wl/forms/:formId/ios/store
 * Update the ios store settings for the form by formId
 * Protected Route
 */
const updateStoreIosSettings = factory.createHandlers(
  zValidator("json", updateIosStoreMetadataSchema),
  async (c) => {
    try {
      const { formId } = c.req.param();
      const body = c.req.valid("json");

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (
        [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
      ) {
        return c.json(
          {
            message:
              "Cannot update store settings for approved or deployed form",
          },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            iosStoreSettings: body,
            status: AppFormStatus.IN_PROGRESS,
            updatedAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json(
        { message: "iOS Store Settings updated successfully" },
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

/**
 * PATCH wl/forms/:formId/ios/info
 * Update the ios info settings for the form by formId
 * Protected Route
 */
const updateInfoIosSettings = factory.createHandlers(
  zValidator("json", updateIosInfoMetadataSchema),
  async (c) => {
    try {
      const { formId } = c.req.param();
      const body = c.req.valid("json");

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (
        [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
      ) {
        return c.json(
          {
            message:
              "Cannot update info settings for approved or deployed form",
          },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            iosInfoSettings: body,
            status: AppFormStatus.IN_PROGRESS,
            updatedAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json(
        { message: "iOS Info Settings updated successfully" },
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

/**
 * PATCH wl/forms/:formId/submit
 * Submit the form request by formId
 * Protected Route
 */
const submitFormHandler = factory.createHandlers(async (c) => {
  try {
    const { formId } = c.req.param();

    const form = await Mongo.app_forms.findOne({
      _id: new ObjectId(formId),
    });

    if (!form) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }

    if (
      [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
    ) {
      return c.json(
        { message: "Cannot submit approved or deployed form" },
        Response.BAD_REQUEST,
      );
    }

    const result = await Mongo.app_forms.updateOne(
      { _id: new ObjectId(formId) },
      {
        $set: {
          status: AppFormStatus.IN_REVIEW,
          isFormSubmitted: true,
          updatedAt: new Date(),
        },
      },
    );
    if (result.modifiedCount === 0) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }
    return c.json({ message: "Form submitted successfully" }, Response.OK);
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * PATCH wl/forms/:formId/approve
 * Approve the form request by formId
 * Protected Route
 */
const approveFormHandler = factory.createHandlers(
  authenticationMiddleware,
  async (c) => {
    try {
      const { formId } = c.req.param();

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (form.status !== AppFormStatus.IN_REVIEW) {
        return c.json(
          { message: "Cannot approve form which is not in review" },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            status: AppFormStatus.APPROVED,
            updatedAt: new Date(),
            rejectionDetails: undefined,
          },
        },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json({ message: "Form approved successfully" }, Response.OK);
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
 * PATCH wl/forms/:formId/reject
 * Reject the form request by formId
 * Protected Route
 */
const rejectFormHandler = factory.createHandlers(
  authenticationMiddleware,
  zValidator("json", rejectFormByIdSchema),
  async (c) => {
    try {
      const { formId } = c.req.param();
      const { reason, errors } = c.req.valid("json");
      const payload: JWTPayloadType = c.get("jwtPayload");

      const user = await Mongo.user.findOne({ _id: new ObjectId(payload.id) });

      if (!user) {
        return c.json({ message: "User not found" }, Response.NOT_FOUND);
      }

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (form.status !== AppFormStatus.IN_REVIEW) {
        return c.json(
          { message: "Cannot reject form which is not in review" },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            status: AppFormStatus.REJECTED,
            rejectionDetails: {
              date: new Date(),
              reviewer: new ObjectId(payload.id),
              reason,
              errors,
            },
          },
        },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json({ message: "Form rejected successfully" }, Response.OK);
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
 * PATCH wl/forms/:formId/mark-deployed
 * Mark the form as deployed by formId
 * Protected Route
 */
const markFormDeployedHandler = factory.createHandlers(
  authenticationMiddleware,
  async (c) => {
    try {
      const { hostId } = c.req.param();

      const customHost = await Mongo.customhost.findOne({
        _id: new ObjectId(hostId),
      });

      if (!customHost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }

      const result = await Mongo.app_forms.updateOne(
        { host: new ObjectId(hostId) },
        { $set: { status: AppFormStatus.DEPLOYED } },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json(
        { message: "Form marked as deployed successfully" },
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

/**
 * DELETE wl/forms/:formId
 * Delete the form by formId
 * Protected Route
 */
const deleteFormByIdHandler = factory.createHandlers(
  authenticationMiddleware,
  async (c) => {
    try {
      const { formId } = c.req.param();

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (
        [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
      ) {
        return c.json(
          { message: "Cannot delete approved or deployed form" },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.deleteOne({
        _id: new ObjectId(formId),
      });
      if (result.deletedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json({ message: "Form deleted successfully" }, Response.OK);
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
 * POST wl/forms/:formId/generate
 * Generate the form values using AI by formId
 */
const generateFormValuesAIHandler = factory.createHandlers(
  zValidator("json", generateFormValuesAISchema),
  async (c) => {
    try {
      const { formId } = c.req.param();
      const body = c.req.valid("json");

      const form = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
      });

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      if (
        [AppFormStatus.APPROVED, AppFormStatus.DEPLOYED].includes(form.status)
      ) {
        return c.json(
          {
            message:
              "Cannot generate form values for approved or deployed form",
          },
          Response.BAD_REQUEST,
        );
      }

      // AI logic here
      const results = await generateAppFormDescriptions({
        name: body.name,
        category: body.category,
        audience: body.audience,
        purpose: body.purpose,
      });

      return c.json(
        {
          message: "Form values generated successfully",
          result: results.reduce((acc, curr) => {
            return {
              ...acc,
              [curr.type]: curr.text,
            };
          }, {}),
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
  approveFormHandler,
  createFormRequestHandler,
  deleteFormByIdHandler,
  generateFormValuesAIHandler,
  getAllFormsHandler,
  getFormByHostIdHandler,
  getFormByIdHandler,
  getFormOverviewByHostIdHandler,
  markFormDeployedHandler,
  rejectFormHandler,
  submitFormHandler,
  updateInfoIosSettings,
  updateStoreAndroidSettings,
  updateStoreIosSettings,
  uploadAndroidFeatureGraphic,
  uploadFormLogo,
};