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
import { getEnterpriseHosts } from "../utils/enterpriseHostsCache";
import { escapeRegExp } from "../utils/regex";
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
    const {
      page,
      limit,
      search,
      status,
      isSuspended,
      sortByApprovedAt,
      sortBy,
      sortOrder,
    } = c.req.query();
    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 10;
    let SEARCH = search ? (search as string) : "";
    let STATUS = status ? (status as string) : null;

    // Calculate offset for pagination
    const OFFSET = (PAGE - 1) * LIMIT;

    // sortBy=approvedAt|submittedAt with sortOrder=1|-1 supersedes the
    // legacy sortByApprovedAt=1|-1 param (kept for compatibility)
    const SORT_FIELD =
      sortBy === "submittedAt"
        ? "$submittedAt"
        : sortBy === "approvedAt" || Number(sortByApprovedAt)
          ? "$approvedAt"
          : "$updatedAt";
    const SORT_ORDER =
      Number(sortOrder) === 1 || Number(sortOrder) === -1
        ? Number(sortOrder)
        : Number(sortByApprovedAt)
          ? Number(sortByApprovedAt)
          : -1;

    // The old pipeline drove from customhosts and ran a users-$lookup over
    // ~9k hosts plus an appforms-$lookup over ~3k enterprise hosts on EVERY
    // request (~4.5s). The enterprise-host set is now cached in-process and
    // the pipeline drives from appforms directly (indexed on host), joining
    // customhosts/metadata only for the returned page.
    const enterprise = await getEnterpriseHosts();
    let targetHostIds = isSuspended
      ? enterprise.suspendedIds
      : enterprise.activeIds;

    if (SEARCH) {
      const searchRegex = new RegExp(escapeRegExp(SEARCH), "i");
      const matched = await Mongo.customhost
        .find(
          {
            _id: { $in: targetHostIds },
            $or: [
              { appName: { $regex: searchRegex } },
              { host: { $regex: searchRegex } },
              { brandname: { $regex: searchRegex } },
            ],
          },
          { projection: { _id: 1 } },
        )
        .toArray();
      targetHostIds = matched.map((m) => m._id);
    }

    const pipeline = [
      {
        $match: {
          host: { $in: targetHostIds },
          ...(STATUS ? { status: STATUS } : {}),
        },
      },
      {
        $addFields: {
          sortField: {
            $ifNull: [SORT_FIELD, "$createdAt"],
          },
        },
      },
      {
        $sort: {
          sortField: SORT_ORDER as 1 | -1,
        },
      },
      {
        $facet: {
          data: [
            { $skip: OFFSET },
            { $limit: LIMIT },
            {
              $lookup: {
                from: "customhosts",
                localField: "host",
                foreignField: "_id",
                as: "hostDoc",
                pipeline: [
                  {
                    $project: {
                      host: 1,
                      appName: 1,
                      logo: 1,
                      androidShareLink: 1,
                      iosShareLink: 1,
                      platformSuspended: 1,
                    },
                  },
                ],
              },
            },
            { $unwind: "$hostDoc" },
            {
              $lookup: {
                from: "customhostmetadatas",
                localField: "host",
                foreignField: "host",
                as: "metadataDetails",
                pipeline: [
                  {
                    $project: {
                      "iosDeploymentDetails.appStore.status": 1,
                      "iosDeploymentDetails.isInExternalDevAccount": 1,
                      "androidDeploymentDetails.isInExternalDevAccount": 1,
                    },
                  },
                ],
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const customHostsArr = await Mongo.app_forms.aggregate(pipeline).toArray();

    const customHostsData = customHostsArr[0]?.data ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customHosts = customHostsData.map((form: any) => {
      const customHost = form.hostDoc ?? {};
      // brandname/createdAt/formUpdatedAt/isFormSubmitted dropped — the
      // forms table never rendered them
      return {
        _id: customHost._id,
        host: customHost.host,
        appName: customHost.appName,
        logo: customHost.logo,
        isEditForm: form.parentForm ? true : false,
        status: form.status ?? AppFormStatus.IN_PROGRESS,
        formId: form._id,
        formSubmittedAt: form.submittedAt ?? null,
        formApprovedAt: form.approvedAt ?? null,
        store: {
          playStoreLink: customHost.androidShareLink || "",
          appStoreLink: customHost.iosShareLink || "",
        },
        platformSuspended: customHost.platformSuspended,
        appStoreStatus:
          (form?.metadataDetails?.length > 0 &&
            form?.metadataDetails[0]?.iosDeploymentDetails?.appStore
              ?.status) ||
          "",
        externalDevAccount: {
          android:
            (form?.metadataDetails?.length > 0 &&
              form?.metadataDetails[0]?.androidDeploymentDetails
                ?.isInExternalDevAccount) ??
            false,
          ios:
            (form?.metadataDetails?.length > 0 &&
              form?.metadataDetails[0]?.iosDeploymentDetails
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
    const enterprise = await getEnterpriseHosts();

    const allStatusCountsPromise = Mongo.app_forms
      .aggregate([
        {
          // suspended hosts come from the in-process cache — the old
          // pipeline joined customhosts for every form on every call
          $match: {
            host: { $nin: enterprise.allSuspendedIds },
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
          // native-field filter first: only in-store-review forms need joins;
          // suspension exclusion via the cached id set (no customhosts join)
          $match: {
            status: AppFormStatus.IN_STORE_REVIEW,
            host: { $nin: enterprise.allSuspendedIds },
          },
        },
        {
          $lookup: {
            from: "customhostmetadatas",
            localField: "host",
            foreignField: "host",
            as: "metadataDetails",
            pipeline: [
              { $project: { "iosDeploymentDetails.appStore.status": 1 } },
            ],
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

    // one pass over enterprise hosts (from the cache — no users join)
    // computes the suspended count AND the android/ios live-link counts
    const hostCountsPromise = Mongo.customhost
      .aggregate([
        {
          $match: {
            _id: {
              $in: [...enterprise.activeIds, ...enterprise.suspendedIds],
            },
          },
        },
        {
          $group: {
            _id: null,
            suspendedPlatformCount: {
              $sum: { $cond: [{ $eq: ["$platformSuspended", true] }, 1, 0] },
            },
            totalAndroidShareLinks: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$platformSuspended", true] },
                      { $ifNull: ["$androidShareLink", false] },
                      { $ne: ["$androidShareLink", ""] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalIosShareLinks: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$platformSuspended", true] },
                      { $ifNull: ["$iosShareLink", false] },
                      { $ne: ["$iosShareLink", ""] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    const [allStatusCounts, hostCounts, allIosReviewStatusCount] =
      await Promise.all([
        allStatusCountsPromise,
        hostCountsPromise,
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
            total:
              allStatusCounts.length > 0
                ? Object.values(allStatusCounts[0].statuses).reduce(
                    (acc: any, curr: any) => acc + curr,
                    0,
                  )
                : 0,
            suspended:
              hostCounts?.length > 0 ? hostCounts[0].suspendedPlatformCount : 0,
            ios: hostCounts?.length > 0 ? hostCounts[0].totalIosShareLinks : 0,
            android:
              hostCounts?.length > 0 ? hostCounts[0].totalAndroidShareLinks : 0,
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

    // parentForm / showAppsLiveBannerToCreator are never read by the preview
    const appForm = await Mongo.app_forms.findOne(
      {
        _id: new ObjectId(formId),
      },
      { projection: { parentForm: 0, showAppsLiveBannerToCreator: 0 } },
    );
    if (!appForm) {
      return c.json({ message: "Form not found" }, Response.NOT_FOUND);
    }

    const [customHost, reviewer] = await Promise.all([
      Mongo.customhost.findOne(
        { _id: new ObjectId(appForm.host) },
        {
          projection: {
            host: 1,
            appName: 1,
            brandname: 1,
            logo: 1,
            createdAt: 1,
            androidShareLink: 1,
            iosShareLink: 1,
          },
        },
      ),
      appForm.rejectionDetails && appForm.rejectionDetails.reviewer
        ? Mongo.user.findOne(
            { _id: new ObjectId(appForm.rejectionDetails.reviewer) },
            { projection: { name: 1, email: 1 } },
          )
        : Promise.resolve(null),
    ]);

    if (!customHost) {
      return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
    }

    if (
      appForm.rejectionDetails &&
      appForm.rejectionDetails.reviewer &&
      !reviewer
    ) {
      return c.json({ message: "Reviewer not found" }, Response.NOT_FOUND);
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

      // the auth middleware has already verified the user exists
      const form = await Mongo.app_forms.findOne(
        { _id: new ObjectId(formId) },
        { projection: { status: 1, host: 1 } },
      );

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
 * PATCH wl/forms/host/:formId/mark-in-review
 * Move the form back to in-review status
 * Only allowed for forms with status APPROVED or IN_STORE_REVIEW
 * Protected Route
 */
const markFormInReviewHandler = factory.createHandlers(
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
        form.status !== AppFormStatus.APPROVED &&
        form.status !== AppFormStatus.IN_STORE_REVIEW
      ) {
        return c.json(
          {
            message:
              "Only forms with status APPROVED or IN_STORE_REVIEW can be moved to in-review",
          },
          Response.BAD_REQUEST,
        );
      }

      await Mongo.app_forms.updateOne(
        { _id: new ObjectId(formId) },
        {
          $set: {
            status: AppFormStatus.IN_REVIEW,
            submittedAt: new Date(),
            updatedAt: new Date(),
          },
          $unset: {
            approvedAt: "",
            rejectionDetails: "",
          },
        },
      );

      return c.json(
        { message: "Form moved to in-review successfully" },
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

      const form = await Mongo.app_forms.findOne(
        { _id: new ObjectId(formId) },
        { projection: { host: 1 } },
      );

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      const [customHost, metadata] = await Promise.all([
        Mongo.customhost.findOne(
          { _id: new ObjectId(form.host) },
          { projection: { host: 1 } },
        ),
        Mongo.metadata.findOne(
          { host: new ObjectId(form.host) },
          {
            projection: {
              logo: 1,
              customOneSignalIcon: 1,
              backgroundType: 1,
              backgroundStartColor: 1,
              backgroundEndColor: 1,
              backgroundGradientAngle: 1,
              logoPadding: 1,
              iosLogoPadding: 1,
              androidStoreSettings: 1,
              iosStoreSettings: 1,
            },
          },
        ),
      ]);

      if (!customHost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }

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

      const form = await Mongo.app_forms.findOne(
        { _id: new ObjectId(formId) },
        { projection: { host: 1, parentForm: 1 } },
      );

      if (!form) {
        return c.json({ message: "Form not found" }, Response.NOT_FOUND);
      }

      const customHost = await Mongo.customhost.findOne(
        { _id: new ObjectId(form.host) },
        { projection: { androidShareLink: 1, iosShareLink: 1 } },
      );

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

      const form = await Mongo.app_forms.findOne(
        { _id: new ObjectId(formId) },
        { projection: { status: 1 } },
      );

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

  const versionField =
    target === "ios"
      ? "iosDeploymentDetails.versionName"
      : "androidDeploymentDetails.versionName";
  const shareLinkField = target === "ios" ? "iosShareLink" : "androidShareLink";
  const shareLinkQuery = {
    [shareLinkField]: { $type: "string", $ne: "" },
  } as Record<string, unknown>;

  try {
    // 1. old-version candidates straight from metadata (small collection),
    // 2. intersect with the cached enterprise-active host set,
    // 3. fetch appName + share-link check only for the matching hosts.
    // The old version scanned every customhost, joined full user docs and
    // returned ~2.6MB (mostly base64 logos the dashboard never used); the
    // response now carries only the fields the dialog consumes.
    const [enterprise, oldVersionMetadata] = await Promise.all([
      getEnterpriseHosts(),
      Mongo.metadata
        .find(
          { [versionField]: { $ne: latestVersion } },
          {
            projection: {
              host: 1,
              isPreReqCompleted: 1,
              "iosDeploymentDetails.versionName": 1,
              "androidDeploymentDetails.versionName": 1,
            },
          },
        )
        .toArray(),
    ]);

    const activeIdSet = new Set(enterprise.activeIds.map((id) => String(id)));
    const candidates = oldVersionMetadata.filter((m) =>
      activeIdSet.has(String(m.host)),
    );

    const liveHosts = await Mongo.customhost
      .find(
        {
          _id: { $in: candidates.map((m) => m.host) },
          ...shareLinkQuery,
        },
        { projection: { appName: 1 } },
      )
      .toArray();
    const liveHostNames = new Map(
      liveHosts.map((h) => [String(h._id), h.appName]),
    );

    const result = candidates
      .filter((m) => liveHostNames.has(String(m.host)))
      .map((m) => ({
        _id: m.host,
        appName: liveHostNames.get(String(m.host)),
        isPreReqCompleted: m.isPreReqCompleted,
        metadata: {
          iosDeploymentDetails: {
            versionName: m.iosDeploymentDetails?.versionName,
          },
          androidDeploymentDetails: {
            versionName: m.androidDeploymentDetails?.versionName,
          },
        },
      }));

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

    const metadata = await Mongo.metadata.findOne(
      { host: new ObjectId(hostId) },
      {
        projection: {
          "androidDeploymentDetails.isInExternalDevAccount": 1,
          "iosDeploymentDetails.isInExternalDevAccount": 1,
        },
      },
    );

    if (!metadata) {
      return c.json({ message: "Metadata not found" }, Response.NOT_FOUND);
    }

    // $set only the toggled nested fields — writing the whole document back
    // (previous behavior) races with concurrent settings saves
    const update =
      platform === "android"
        ? {
            "androidDeploymentDetails.isInExternalDevAccount":
              !metadata.androidDeploymentDetails?.isInExternalDevAccount,
          }
        : {
            "iosDeploymentDetails.isInExternalDevAccount":
              !metadata.iosDeploymentDetails?.isInExternalDevAccount,
            "iosDeploymentDetails.isDeploymentBlocked":
              !metadata.iosDeploymentDetails?.isInExternalDevAccount,
            "iosDeploymentDetails.deploymentBlockReason": !metadata
              .iosDeploymentDetails?.isInExternalDevAccount
              ? "This app is in external dev account"
              : "",
          };

    await Mongo.metadata.updateOne(
      { host: new ObjectId(hostId) },
      { $set: update },
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
  markFormInReviewHandler,
  markFormInStoreReviewHandler,
  markFormUnpublished,
  rejectFormHandler,
  releaseEditAppForm,
  toggleIsExternalDevAccount,
};
