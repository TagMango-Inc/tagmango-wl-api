import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../database";
import authenticationMiddleware from "../middleware/authentication";
import { JWTPayloadType } from "../types";
import { AppFormStatus } from "../types/database";
import { base64ToImage } from "../utils/image";
import { enqueueMessage } from "../utils/sqs";
import { Response } from "../utils/statuscode";
import {
  generateFormValuesAISchema,
  rejectFormByIdSchema,
  updatAppFormLogoSchema,
} from "../validations/appForms";
import {
  updateAndroidStoreMetadataSchema,
  updateIosStoreMetadataSchema,
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
 * @param status: 'in-progress' | 'in-review' | 'approved' | 'rejected' | 'in-store-review' |  'deployed'
 * @param isSuspended: boolean
 * @param sortByApprovedAt: 1 | -1 | 0
 * @returns { message: string, result: { customHosts: Array } }
 */
const getAllFormsHandler = factory.createHandlers(async (c) => {
  try {
    const { page, limit, search, status, isSuspended, sortByApprovedAt } =
      c.req.query();
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
              $expr: { $eq: [STATUS, AppFormStatus.IN_PROGRESS] },
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
          ...(isSuspended
            ? { platformSuspended: true }
            : { platformSuspended: { $ne: true } }),
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
        },
      },
      {
        $match: matchStatus,
      },
      {
        $addFields: {
          sortField: {
            $ifNull: sortByApprovedAt
              ? ["$appFormDetails.approvedAt", "$createdAt"]
              : ["$appFormDetails.updatedAt", "$createdAt"],
          },
        },
      },
      {
        $lookup: {
          from: "customhostmetadatas",
          localField: "_id",
          foreignField: "host",
          as: "metadataDetails",
        },
      },
      {
        $sort: {
          sortField: Number(sortByApprovedAt) ? Number(sortByApprovedAt) : -1,
        },
      },
      {
        $facet: {
          data: [{ $skip: OFFSET }, { $limit: LIMIT }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const customHostsArr = await Mongo.customhost.aggregate(pipeline).toArray();

    const customHostsData = customHostsArr[0]?.data ?? [];

    const customHosts = customHostsData.map((customHost: any) => {
      return {
        _id: customHost._id,
        host: customHost.host,
        appName: customHost.appName,
        brandname: customHost.brandname,
        logo: customHost.logo,
        createdAt: customHost.createdAt,
        status: customHost.appFormDetails
          ? customHost.appFormDetails.status
          : AppFormStatus.IN_PROGRESS,
        formId: customHost.appFormDetails
          ? customHost.appFormDetails._id
          : null,
        formUpdatedAt: customHost.appFormDetails
          ? customHost.appFormDetails.updatedAt
          : null,
        formSubmittedAt:
          customHost.appFormDetails && customHost.appFormDetails.submittedAt
            ? customHost.appFormDetails.submittedAt
            : null,
        formApprovedAt:
          customHost.appFormDetails && customHost.appFormDetails.approvedAt
            ? customHost.appFormDetails.approvedAt
            : null,
        isFormSubmitted: customHost.appFormDetails
          ? customHost.appFormDetails.isFormSubmitted ?? false
          : false,
        store: {
          playStoreLink: customHost.androidShareLink || "",
          appStoreLink: customHost.iosShareLink || "",
        },
        platformSuspended: customHost.platformSuspended,
        appStoreStatus:
          (customHost?.metadataDetails.length > 0 &&
            customHost?.metadataDetails[0]?.iosDeploymentDetails?.appStore
              ?.status) ||
          "",
      };
    });

    return c.json(
      {
        message: "All Custom Hosts",
        result: {
          customHosts,
          totalCount: customHostsArr[0]?.totalCount[0]?.count ?? 0,
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

const getAllFormsCount = factory.createHandlers(async (c) => {
  try {
    const allStatusCountsPromise = Mongo.app_forms
      .aggregate([
        {
          $lookup: {
            from: "customhosts",
            localField: "host",
            foreignField: "_id",
            as: "hostDetails",
          },
        },
        {
          $match: {
            "hostDetails.platformSuspended": { $ne: true },
          },
        },
        {
          $group: {
            _id: "$status", // Group by the 'status' field
            count: { $sum: 1 }, // Count each occurrence
          },
        },
        {
          $group: {
            _id: null,
            statuses: {
              $push: { k: "$_id", v: "$count" }, // Create key-value pairs
            },
          },
        },
        {
          $project: {
            _id: 0,
            statuses: { $arrayToObject: "$statuses" }, // Convert the array to an object
          },
        },
      ])
      .toArray();

    const allIosReviewStatusPromise = Mongo.app_forms
      .aggregate([
        {
          $lookup: {
            from: "customhosts",
            localField: "host",
            foreignField: "_id",
            as: "hostDetails",
          },
        },
        {
          $match: {
            "hostDetails.platformSuspended": { $ne: true },
          },
        },
        {
          $lookup: {
            from: "customhostmetadatas",
            localField: "host",
            foreignField: "host",
            as: "metadataDetails",
          },
        },
        {
          $unwind: {
            path: "$metadataDetails",
          },
        },
        {
          $match: {
            $and: [
              {
                "metadataDetails.iosDeploymentDetails.appStore.status": {
                  $exists: true,
                },
              },
              {
                "metadataDetails.iosDeploymentDetails.appStore.status": {
                  $ne: "",
                },
              },
              {
                status: AppFormStatus.IN_STORE_REVIEW,
              },
            ],
          },
        },
        {
          $group: {
            _id: "$metadataDetails.iosDeploymentDetails.appStore.status", // Group by the 'status' field
            count: { $sum: 1 }, // Count each occurrence
          },
        },
        {
          $group: {
            _id: null,
            statuses: {
              $push: { k: "$_id", v: "$count" }, // Create key-value pairs
            },
          },
        },
        {
          $project: {
            _id: 0,
            statuses: { $arrayToObject: "$statuses" }, // Convert the array to an object
          },
        },
      ])
      .toArray();

    const customHostsPromise = Mongo.customhost
      .aggregate([
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
            platformSuspended: true,
          },
        },
        {
          $count: "suspendedPlatformCount",
        },
      ])
      .toArray();

    const iosAndAndroidCountsPromise = Mongo.customhost
      .aggregate([
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
            platformSuspended: { $ne: true },
          },
        },
        {
          $project: {
            androidShareLinkCount: {
              $cond: {
                if: {
                  $and: [
                    { $ifNull: ["$androidShareLink", false] },
                    { $ne: ["$androidShareLink", ""] },
                  ],
                },
                then: 1,
                else: 0,
              },
            },
            iosShareLinkCount: {
              $cond: {
                if: {
                  $and: [
                    { $ifNull: ["$iosShareLink", false] },
                    { $ne: ["$iosShareLink", ""] },
                  ],
                },
                then: 1,
                else: 0,
              },
            },
          },
        },
        {
          $group: {
            _id: null, // We only want the total count, so we don't need to group by a specific field
            totalAndroidShareLinks: { $sum: "$androidShareLinkCount" },
            totalIosShareLinks: { $sum: "$iosShareLinkCount" },
          },
        },
      ])
      .toArray();

    const [
      allStatusCounts,
      customHosts,
      iosAndAndroidCounts,
      allIosReviewStatusCount,
    ] = await Promise.all([
      allStatusCountsPromise,
      customHostsPromise,
      iosAndAndroidCountsPromise,
      allIosReviewStatusPromise,
    ]);

    return c.json(
      {
        message: "All forms count",
        result: {
          count: {
            ...(allStatusCounts.length > 0
              ? allStatusCounts[0].statuses
              : {
                  [AppFormStatus.IN_PROGRESS]: 0,
                  [AppFormStatus.IN_REVIEW]: 0,
                  [AppFormStatus.APPROVED]: 0,
                  [AppFormStatus.REJECTED]: 0,
                  [AppFormStatus.IN_STORE_REVIEW]: 0,
                  [AppFormStatus.DEPLOYED]: 0,
                }),
            ...(allIosReviewStatusCount.length > 0 &&
              allIosReviewStatusCount[0].statuses),
            total: Object.values(allStatusCounts[0].statuses).reduce(
              (acc: any, curr: any) => acc + curr,
              0,
            ),
            suspended:
              customHosts?.length > 0
                ? customHosts[0].suspendedPlatformCount
                : 0,
            ios:
              iosAndAndroidCounts?.length > 0
                ? iosAndAndroidCounts[0].totalIosShareLinks
                : 0,
            android:
              iosAndAndroidCounts?.length > 0
                ? iosAndAndroidCounts[0].totalAndroidShareLinks
                : 0,
          },
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
            store: {
              playStoreLink: customHost.androidShareLink,
              appStoreLink: customHost.iosShareLink,
            },
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
            store: {
              playStoreLink: customHost.androidShareLink || "",
              appStoreLink: customHost.iosShareLink || "",
            },
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
            submittedAt: appForm.submittedAt || null,
            approvedAt: appForm.approvedAt || null,
            showAppsLiveBannerToCreator: appForm.showAppsLiveBannerToCreator,
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
 * PATCH wl/forms/:hostId/mark-apps-live-banner-seen
 * Mark the Apps Live Banner as seen by the creator
 * Protected Route
 */
const markAppsLiveBannerSeenHandler = factory.createHandlers(async (c) => {
  try {
    const { hostId } = c.req.param();

    const appForm = await Mongo.app_forms.findOne({
      host: new ObjectId(hostId),
    });

    if (!appForm) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }

    await Mongo.app_forms.updateOne(
      { host: new ObjectId(hostId) },
      {
        $set: {
          showAppsLiveBannerToCreator: false,
        },
      },
    );

    return c.json({ message: "Apps Live Banner marked as seen" }, Response.OK);
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
            store: {
              playStoreLink: customHost.androidShareLink,
              appStoreLink: customHost.iosShareLink,
            },
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
 * PATCH wl.forms/:formId/logo/upload
 * Upload the logo for the form by formId
 * Protected Route
 */
const uploadFormLogo = factory.createHandlers(
  zValidator("json", updatAppFormLogoSchema),
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
        ![AppFormStatus.IN_PROGRESS, AppFormStatus.REJECTED].includes(
          form.status,
        )
      ) {
        return c.json(
          {
            message: "Cannot update info settings for this form",
          },
          Response.BAD_REQUEST,
        );
      }

      // saving assets
      const logo = body.logo;
      const customOneSignalIcon = body.customOneSignalIcon;
      const icon = body.icon;
      const background = body.background;
      const foreground = body.foreground;
      const iosIcon = body.iosIcon;

      const logoPath = `./forms/${formId}`;

      // creating directory if not exists
      if (!fs.existsSync(logoPath)) {
        fs.mkdirSync(logoPath, {
          recursive: true,
        });
      }

      await Promise.all([
        logo && base64ToImage(logo, `${logoPath}/logo.png`),
        customOneSignalIcon &&
          base64ToImage(
            customOneSignalIcon,
            `${logoPath}/customOneSignalIcon.png`,
          ),
        base64ToImage(icon, `${logoPath}/icon.png`),
        base64ToImage(background, `${logoPath}/background.png`),
        base64ToImage(foreground, `${logoPath}/foreground.png`),
        base64ToImage(iosIcon, `${logoPath}/iosIcon.png`),
      ]);

      await Mongo.app_forms.updateOne(
        {
          _id: new ObjectId(formId),
        },
        {
          $set: {
            logo: form.logo ? form.logo : logo ? `logo.png` : "",
            customOneSignalIcon: form.customOneSignalIcon
              ? form.customOneSignalIcon
              : customOneSignalIcon
                ? `customOneSignalIcon.png`
                : "",
            backgroundType: body.backgroundType || form.backgroundType,
            backgroundStartColor:
              body.backgroundStartColor || form.backgroundStartColor,
            backgroundEndColor:
              body.backgroundEndColor || form.backgroundEndColor,
            backgroundGradientAngle:
              body.backgroundGradientAngle || form.backgroundGradientAngle,
            logoPadding: body.logoPadding || form.logoPadding,
            iosLogoPadding: body.iosLogoPadding || form.iosLogoPadding,
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
        ![AppFormStatus.IN_PROGRESS, AppFormStatus.REJECTED].includes(
          form.status,
        )
      ) {
        return c.json(
          {
            message: "Cannot update info settings for this form",
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

      const customHost = await Mongo.customhost.findOne({
        _id: new ObjectId(form.host),
      });

      if (!customHost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }

      if (
        ![AppFormStatus.IN_PROGRESS, AppFormStatus.REJECTED].includes(
          form.status,
        )
      ) {
        return c.json(
          {
            message: "Cannot update info settings for this form",
          },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            iosStoreSettings: {
              name: body.name,
              description: body.description,
              keywords: "Edtech, Education",
              marketing_url: form?.iosStoreSettings?.marketing_url || "",
              privacy_url: `https://${customHost.host}/privacy`,
              support_url: "https://help.tagmango.com",
              promotional_text: form?.iosStoreSettings?.promotional_text || "",
              subtitle: form?.iosStoreSettings?.subtitle || "",
            },
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

    if (form.status !== AppFormStatus.IN_PROGRESS) {
      return c.json(
        { message: "Cannot submit this form!" },
        Response.BAD_REQUEST,
      );
    }

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(form.host),
    });

    if (!metadata) {
      const customhost = await Mongo.customhost.findOne({
        _id: new ObjectId(form.host),
      });

      if (!customhost) {
        return c.json(
          { message: "Cannot submit form, contact support" },
          Response.NOT_FOUND,
        );
      }

      const appName = customhost.appName ?? "";
      const formattedName = appName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      // create metadata if not exists
      await Mongo.metadata.insertOne({
        host: new ObjectId(form.host),
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
          title: "",
          short_description: "",
          full_description: "",
          video: "",
        },
        iosStoreSettings: {
          description: "",
          keywords: "EdTech, Education",
          marketing_url: "",
          name: "",
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
    }

    const result = await Mongo.app_forms.updateOne(
      { _id: new ObjectId(formId) },
      {
        $set: {
          status: AppFormStatus.IN_REVIEW,
          isFormSubmitted: true,
          submittedAt: new Date(),
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

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(form.host),
      });

      if (!metadata) {
        return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
      }

      const currentLogoPath = `./forms/${form._id}`;
      const newLogoPath = `./assets/${form.host}`;

      // create directory if not exists
      if (!fs.existsSync(newLogoPath)) {
        fs.mkdirSync(newLogoPath, {
          recursive: true,
        });
      }

      const files = [
        "logo.png",
        "customOneSignalIcon.png",
        "icon.png",
        "background.png",
        "foreground.png",
        "iosIcon.png",
      ];

      let allImageFilesExists = true;
      files.forEach(async (file) => {
        if (fs.existsSync(`${currentLogoPath}/${file}`)) {
          fs.copyFileSync(
            `${currentLogoPath}/${file}`,
            `${newLogoPath}/${file}`,
          );
        } else {
          allImageFilesExists = false;
        }
      });

      if (!allImageFilesExists) {
        return c.json(
          { message: "Some app logo files are not found" },
          Response.BAD_REQUEST,
        );
      }

      const newMetadata = await Mongo.metadata.updateOne(
        { host: new ObjectId(form.host) },
        {
          $set: {
            logo: form.logo,
            customOneSignalIcon: form.customOneSignalIcon,
            backgroundType: form.backgroundType,
            backgroundStartColor: form.backgroundStartColor,
            backgroundEndColor: form.backgroundEndColor,
            backgroundGradientAngle: form.backgroundGradientAngle,
            logoPadding: form.logoPadding,
            iosLogoPadding: form.iosLogoPadding,
            androidStoreSettings: form.androidStoreSettings,
            iosStoreSettings: form.iosStoreSettings,
            iosInfoSettings: form.iosInfoSettings,
          },
        },
      );

      if (newMetadata.matchedCount === 0) {
        return c.json(
          { message: "Metadata not updated" },
          Response.INTERNAL_SERVER_ERROR,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            status: AppFormStatus.APPROVED,
            updatedAt: new Date(),
            approvedAt: new Date(),
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
            updatedAt: new Date(),
            rejectionDetails: {
              date: new Date(),
              reviewer: new ObjectId(payload.id),
              reason,
              errors,
            },
          },
        },
      );

      await enqueueMessage(
        "appzap.appform.reject",
        {
          host: form.host.toString(),
          errors,
        },
        {},
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
 * PATCH wl/forms/:appId/mark-unpublished
 * Mark the form as unpublished by app id
 * Protected Route
 */
const markFormUnpublished = factory.createHandlers(
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
        { $set: { status: AppFormStatus.UNPUBLISHED, updatedAt: new Date() } },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json(
        { message: "Form marked as unpublished successfully" },
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
 * PATCH wl/forms/:appId/mark-in-store-review
 * Mark the form as in-store-review by app id
 * Protected Route
 */
const markFormInStoreReviewHandler = factory.createHandlers(
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
        {
          $set: {
            status: AppFormStatus.IN_STORE_REVIEW,
            updatedAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json(
        { message: "Form marked as in-store-review successfully" },
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
 * PATCH wl/forms/:appId/mark-approved
 * Mark the form as deployed by app id
 * Used when app is in progress and reviewer wants to approve bypassing review
 * Protected Route
 */
const markFormApprovedHandler = factory.createHandlers(
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

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(hostId),
      });

      if (
        !metadata ||
        !metadata.logo ||
        !metadata.androidStoreSettings.title ||
        !metadata.androidStoreSettings.short_description ||
        !metadata.androidStoreSettings.full_description ||
        !metadata.iosStoreSettings.name ||
        !metadata.iosStoreSettings.description ||
        !metadata.iosStoreSettings.keywords ||
        !metadata.iosStoreSettings.privacy_url ||
        !metadata.iosStoreSettings.support_url
      ) {
        return c.json(
          {
            message:
              "Metadata is not complete for this form, cannot mark as approved",
          },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { host: new ObjectId(hostId) },
        {
          $set: {
            // Use $set to update the fields
            host: customHost._id,
            status: AppFormStatus.APPROVED,
            logo: metadata.logo,
            customOneSignalIcon: metadata.customOneSignalIcon || "",

            backgroundType: metadata.backgroundType || "color",
            backgroundStartColor: metadata.backgroundStartColor || "#ffffff",
            backgroundEndColor: metadata.backgroundEndColor || "#ffffff",
            backgroundGradientAngle: metadata.backgroundGradientAngle || 45,
            logoPadding: metadata.logoPadding || 15,
            iosLogoPadding: metadata.iosLogoPadding || 15,

            androidStoreSettings: {
              title: metadata.androidStoreSettings?.title || "",
              short_description:
                metadata.androidStoreSettings?.short_description || "",
              full_description:
                metadata.androidStoreSettings?.full_description || "",
              video: "",
            },
            iosStoreSettings: {
              description: metadata.iosStoreSettings?.description || "",
              keywords:
                metadata.iosStoreSettings?.keywords || "Edtech, Education",
              marketing_url: "",
              name: metadata.iosStoreSettings?.name || "",
              privacy_url:
                metadata.iosStoreSettings?.privacy_url ||
                `https://${customHost.host}/privacy`,
              promotional_text:
                metadata.iosStoreSettings?.promotional_text || "",
              subtitle: "",
              support_url: "https://help.tagmango.com",
            },
            iosInfoSettings: {
              copyright: "©2021 TagMango, Inc.",
              primary_category: "EDUCATION",
            },
            isFormSubmitted: true,
            approvedAt: new Date(),
            updatedAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 0) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }
      return c.json(
        { message: "Form marked as approved successfully" },
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
 * PATCH wl/forms/:appId/mark-deployed
 * Mark the form as deployed by app id
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

      if (!customHost.androidShareLink || !customHost.iosShareLink) {
        return c.json(
          {
            message:
              "Both Android and iOS share links are required for this action",
          },
          Response.BAD_REQUEST,
        );
      }

      const result = await Mongo.app_forms.updateOne(
        { host: new ObjectId(hostId) },
        { $set: { status: AppFormStatus.DEPLOYED, updatedAt: new Date() } },
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

const fetchPreRequisitesForApp = factory.createHandlers(async (c) => {
  try {
    const { hostId } = c.req.param();
    if (!hostId)
      return c.json(
        { message: "Host is required" },
        {
          status: 400,
          statusText: "Bad Request",
        },
      );

    const customHost = await Mongo.customhost.findOne({
      _id: new ObjectId(hostId),
    });

    if (!customHost)
      return c.json(
        { message: "Host not found" },
        {
          status: 404,
          statusText: "Not Found",
        },
      );

    const creatorId = customHost.creator;

    const mango = await Mongo.mango.findOne({
      creator: new ObjectId(creatorId),
      isHidden: { $ne: true },
      isStopTakingPayment: { $ne: true },
      $or: [{ end: { $gte: new Date() } }, { end: undefined }],
      isPublic: { $ne: true },
      isDeleted: { $ne: true },
      recurringType: "onetime",
    });

    const mangoAggregation = await Mongo.mango
      .aggregate([
        {
          $match: {
            creator: new ObjectId(creatorId),
            isHidden: {
              $ne: true,
            },
            isStopTakingPayment: {
              $ne: true,
            },
            $or: [
              {
                end: {
                  $gte: new Date(),
                },
              },
              {
                end: undefined,
              },
            ],
            isPublic: {
              $ne: true,
            },
            isDeleted: {
              $ne: true,
            },
            recurringType: "onetime",
          },
        },
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "mangoArr",
            as: "relatedPosts",
          },
        },
        {
          $addFields: {
            relatedPosts: {
              $filter: {
                input: "$relatedPosts",
                as: "post",
                cond: { $ne: ["$$post.isDeleted", true] }, // Check if isDeleted is not true
              },
            },
          },
        },
        {
          $lookup: {
            from: "rooms",
            let: { mangoId: "$_id" }, // Current Mango ID
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$mango", "$$mangoId"] }, // Check if mango matches Mango ID
                      { $in: ["$$mangoId", { $ifNull: ["$mangoArr", []] }] }, // Check if Mango ID is in mangoArr, default to empty array if mangoArr doesn't exist
                    ],
                  },
                },
              },
            ],
            as: "relatedRooms",
          },
        },
        {
          $addFields: {
            relatedRooms: {
              $filter: {
                input: "$relatedRooms",
                as: "room",
                cond: { $ne: ["$$room.isDeleted", true] }, // Check if isDeleted is not true
              },
            },
          },
        },
        {
          $lookup: {
            from: "courses",
            localField: "_id",
            foreignField: "mangoArr",
            as: "relatedCourses",
          },
        },
        {
          $addFields: {
            relatedCourses: {
              $filter: {
                input: "$relatedCourses", // Array of related courses
                as: "course",
                cond: {
                  $and: [
                    { $eq: ["$$course.isPublished", true] },
                    { $ne: ["$$course.isDripped", true] },
                  ],
                },
              },
            },
          },
        },
        {
          $unwind: "$relatedCourses",
        },
        {
          $lookup: {
            from: "chapters",
            localField: "relatedCourses._id", // Use the course ID to lookup chapters
            foreignField: "course", // Assuming each chapter has a `courseId` field to link to the course
            as: "relatedChapters",
          },
        },
        {
          $addFields: {
            relatedCourses: {
              $cond: {
                if: {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: "$relatedChapters", // Array of chapters related to the course
                          as: "chapter",
                          cond: {
                            $eq: ["$$chapter.contentType", "video"], // Check if contentType is video
                          },
                        },
                      },
                    },
                    0,
                  ], // Ensure that at least one chapter with contentType=video exists
                },
                then: "$relatedCourses", // Keep course if at least one video chapter exists
                else: null, // Exclude the course otherwise
              },
            },
          },
        },
        {
          $group: {
            _id: "$_id",
            relatedPosts: { $first: "$relatedPosts" }, // Preserve posts
            relatedCourses: { $push: "$relatedCourses" }, // Collect filtered courses
            relatedRooms: { $first: "$relatedRooms" }, // Preserve rooms
            title: { $first: "$title" },
          },
        },
      ])
      .toArray();

    const isPostCourseRoomLinkedWithOneMangoExists =
      mangoAggregation.filter(
        (mango) =>
          mango.relatedPosts.length > 0 &&
          mango.relatedCourses.length > 0 &&
          mango.relatedCourses.filter(Boolean).length > 0 &&
          mango.relatedRooms.length > 0,
      ).length > 0;

    return c.json(
      {
        message: "Pre-requisites for app fetched successfully",
        result: {
          prerequisites: [
            {
              title: "Create a service",
              description: "You need to create an offering to proceed",
              isCompleted: mango ? true : false,
              url: "/dashboard/mango-overview?newMangoform=true",
            },
            {
              title: "Create a post, course and room in a service",
              description: `Make sure you create alteast one post, one course (which is published, has alteast one video chapter and has drip system disabled) and one room in the same offering you created above`,
              isCompleted: isPostCourseRoomLinkedWithOneMangoExists,
              url: "/activity",
            },
            {
              title: "Update your Platform's Logo",
              description: `Make sure you have uploaded your platform's logo in Settings > Platform Settings`,
              isCompleted: customHost.logo ? true : false,
              url: `/dashboard/platformsettings`,
            },
          ],
          mangoList: mangoAggregation || [],
        },
      },
      {
        status: 200,
        statusText: "OK",
      },
    );
  } catch (err) {
    console.log(err);
    return c.json(
      { message: "Internal Server Error" },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
    );
  }
});

// get all hosts that have deployed forms but are not on the latest version
const getLiveAppsOnOldVersion = factory.createHandlers(async (c) => {
  const { latestVersion, target } = c.req.query();

  if (!latestVersion || !target) {
    return c.json(
      { message: "latestVersion and target are required" },
      {
        status: 400,
        statusText: "Bad Request",
      },
    );
  }

  let latestVersionQuery = "",
    shareLinkQuery = {};
  if (target === "ios") {
    latestVersionQuery = "metadata.iosDeploymentDetails.versionName";
    shareLinkQuery = { iosShareLink: { $type: "string", $ne: "" } };
  } else {
    latestVersionQuery = "metadata.androidDeploymentDetails.versionName";
    shareLinkQuery = { androidShareLink: { $type: "string", $ne: "" } };
  }

  try {
    const result = await Mongo.customhost
      .aggregate([
        {
          $match: {
            platformSuspended: { $ne: true },
            ...shareLinkQuery,
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
          $match: {
            [latestVersionQuery]: { $ne: latestVersion },
          },
        },
        {
          $project: {
            _id: 1,
            host: 1,
            appName: 1,
            brandname: 1,
            logo: 1,
            createdAt: 1,
            "appform.status": 1,
            "metadata.iosDeploymentDetails.versionName": 1,
            "metadata.androidDeploymentDetails.versionName": 1,
          },
        },
      ])
      .toArray();

    return c.json(
      {
        message: "Live apps on old version fetched successfully",
        result: {
          apps: result,
        },
      },
      {
        status: 200,
        statusText: "OK",
      },
    );
  } catch (error) {
    console.log(error);
    return c.json(
      { message: "Internal Server Error", error: error },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
    );
  }
});

export {
  approveFormHandler,
  deleteFormByIdHandler,
  fetchPreRequisitesForApp,
  generateFormValuesAIHandler,
  getAllFormsCount,
  getAllFormsHandler,
  getFormByHostIdHandler,
  getFormByIdHandler,
  getFormOverviewByHostIdHandler,
  getLiveAppsOnOldVersion,
  markAppsLiveBannerSeenHandler,
  markFormApprovedHandler,
  markFormDeployedHandler,
  markFormInStoreReviewHandler,
  markFormUnpublished,
  rejectFormHandler,
  submitFormHandler,
  updateStoreAndroidSettings,
  updateStoreIosSettings,
  uploadFormLogo,
};
