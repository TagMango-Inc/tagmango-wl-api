import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../database";
import authenticationMiddleware from "../middleware/authentication";
import { JWTPayloadType } from "../types";
import { AppFormStatus } from "../types/database";
import { AWSService } from "../utils/aws";
import { getLiveAppsOnOldVersionCSV } from "../utils/csv";
import { Response } from "../utils/statuscode";
import {
  rejectFormByIdSchema,
  toggleIsExternalDevAccountSchema,
} from "../validations/appForms";

const factory = createFactory();
const awsService = new AWSService();

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
        isEditForm: customHost.appFormDetails.parentForm ? true : false,
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
        externalDevAccount: {
          android:
            (customHost?.metadataDetails.length > 0 &&
              customHost?.metadataDetails[0]?.androidDeploymentDetails
                ?.isInExternalDevAccount) ??
            false,
          ios:
            (customHost?.metadataDetails.length > 0 &&
              customHost?.metadataDetails[0]?.iosDeploymentDetails
                ?.isInExternalDevAccount) ??
            false,
        },
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

      await awsService.enqueueMessage(
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
 * PATCH wl/forms/:formId/mark-unpublished
 * Mark the form as unpublished by formId id
 * Protected Route
 */
const markFormUnpublished = factory.createHandlers(
  authenticationMiddleware,
  async (c) => {
    try {
      const { formId } = c.req.param();

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
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
 * PATCH wl/forms/:formId/mark-in-store-review
 * Mark the form as in-store-review by formId id
 * Protected Route
 */
const markFormInStoreReviewHandler = factory.createHandlers(
  authenticationMiddleware,
  async (c) => {
    try {
      const { formId } = c.req.param();

      const result = await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
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
 * PATCH wl/forms/:formId/mark-approved
 * Mark the form as deployed by formId id
 * Used when app is in progress and reviewer wants to approve bypassing review
 * Protected Route
 */
const markFormApprovedHandler = factory.createHandlers(
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

      const customHost = await Mongo.customhost.findOne({
        _id: new ObjectId(form.host),
      });

      if (!customHost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }

      const metadata = await Mongo.metadata.findOne({
        host: new ObjectId(form.host),
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
        { _id: new ObjectId(formId) },
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
 * PATCH wl/forms/:formId/mark-deployed
 * Mark the form as deployed by formId id
 * Protected Route
 */
const markFormDeployedHandler = factory.createHandlers(
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

      const customHost = await Mongo.customhost.findOne({
        _id: new ObjectId(form.host),
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

      if (form.parentForm) {
        // delete the old parent form
        const res = await Mongo.app_forms.deleteOne({
          _id: new ObjectId(form.parentForm),
        });

        if (res.deletedCount === 0) {
          return c.json(
            { message: "Parent form not found" },
            Response.NOT_FOUND,
          );
        }

        // remove parentForm from this form
        const result = await Mongo.app_forms.updateOne(
          { _id: new ObjectId(formId) },
          {
            $unset: { parentForm: "" },
            $set: { updatedAt: new Date(), status: AppFormStatus.DEPLOYED },
          },
        );

        if (result.modifiedCount === 0) {
          return c.json({ message: "Form not found" }, Response.NOT_FOUND);
        }

        // TODO(rohan): remove assets of old form from s3
      } else {
        // update this form
        const result = await Mongo.app_forms.updateOne(
          { _id: new ObjectId(formId) },
          { $set: { status: AppFormStatus.DEPLOYED, updatedAt: new Date() } },
        );
        if (result.modifiedCount === 0) {
          return c.json({ message: "Form not found" }, Response.NOT_FOUND);
        }
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

// get all hosts that have deployed forms but are not on the latest version
const getLiveAppsOnOldVersion = factory.createHandlers(async (c) => {
  const { latestVersion, target, format } = c.req.query();

  if (!latestVersion || !target) {
    return c.json(
      { message: "latestVersion and target are required" },
      {
        status: 400,
        statusText: "Bad Request",
      },
    );
  }

  // If format is csv, return CSV data
  if (format === "csv") {
    return getLiveAppsOnOldVersionCSV(
      c,
      latestVersion as string,
      target as string,
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
            isPreReqCompleted: "$metadata.isPreReqCompleted",
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

const toggleIsExternalDevAccount = factory.createHandlers(
  zValidator("json", toggleIsExternalDevAccountSchema),
  async (c) => {
    const { hostId } = c.req.param();

    const { platform } = c.req.valid("json");

    if (!hostId || !platform) {
      return c.json(
        { message: "hostId and platform are required" },
        { status: 400, statusText: "Bad Request" },
      );
    }

    const metadata = await Mongo.metadata.findOne({
      host: new ObjectId(hostId),
    });

    if (!metadata) {
      return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
    }

    if (platform === "android") {
      metadata.androidDeploymentDetails = {
        ...metadata.androidDeploymentDetails,
        isInExternalDevAccount:
          !metadata.androidDeploymentDetails?.isInExternalDevAccount,
      };
    } else {
      metadata.iosDeploymentDetails = {
        ...metadata.iosDeploymentDetails,
        isInExternalDevAccount:
          !metadata.iosDeploymentDetails.isInExternalDevAccount,
        isDeploymentBlocked:
          !metadata.iosDeploymentDetails.isInExternalDevAccount,
        deploymentBlockReason: !metadata.iosDeploymentDetails
          .isInExternalDevAccount
          ? "This app is in external dev account"
          : "",
      };
    }

    await Mongo.metadata.updateOne(
      { host: new ObjectId(hostId) },
      { $set: metadata },
    );

    return c.json(
      { message: "Toggled successfully" },
      {
        status: 200,
        statusText: "OK",
      },
    );
  },
);

const releaseEditAppForm = factory.createHandlers(
  authenticationMiddleware,
  async (c) => {
    try {
      const { formId, hostId } = c.req.param();

      const parentForm = await Mongo.app_forms.findOne({
        _id: new ObjectId(formId),
        host: new ObjectId(hostId),
      });

      if (!parentForm) {
        return c.json(
          { message: "App form not found for host" },
          Response.NOT_FOUND,
        );
      }

      if (parentForm.status !== AppFormStatus.DEPLOYED) {
        return c.json(
          { message: "Cannot release edit form for non-deployed app" },
          Response.BAD_REQUEST,
        );
      }

      const newForm = await Mongo.app_forms.insertOne({
        host: new ObjectId(hostId),
        status: AppFormStatus.IN_PROGRESS,
        parentForm: new ObjectId(parentForm._id),
        createdAt: new Date(),
        updatedAt: new Date(),
        logo: "",
        customOneSignalIcon: "",
        backgroundType: parentForm.backgroundType,
        backgroundStartColor: parentForm.backgroundStartColor,
        backgroundEndColor: parentForm.backgroundEndColor,
        backgroundGradientAngle: parentForm.backgroundGradientAngle,
        logoPadding: parentForm.logoPadding,
        iosLogoPadding: parentForm.iosLogoPadding,
        androidStoreSettings: parentForm.androidStoreSettings,
        iosStoreSettings: parentForm.iosStoreSettings,
        iosInfoSettings: parentForm.iosInfoSettings,
      });

      return c.json(
        {
          message: "App form released successfully",
          formId: newForm.insertedId.toString(),
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
  deleteFormByIdHandler,
  getAllFormsCount,
  getAllFormsHandler,
  getFormByIdHandler,
  getLiveAppsOnOldVersion,
  markFormApprovedHandler,
  markFormDeployedHandler,
  markFormInStoreReviewHandler,
  markFormUnpublished,
  rejectFormHandler,
  releaseEditAppForm,
  toggleIsExternalDevAccount,
};
