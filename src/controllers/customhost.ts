import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../../src/database";
import { patchCustomHostByIdSchema } from "../../src/validations/customhost";
import { AppFormStatus } from "../types/database";
import { AWSService } from "../utils/aws";
import { escapeRegExp } from "../utils/regex";
import { Response } from "../utils/statuscode";

const factory = createFactory();
const awsService = new AWSService();

/**
 * Whitelist of customhost fields the dashboard actually consumes (xref-verified
 * against every Settings tab). The raw doc has ~85 fields including secrets
 * (whatsappApiKey/whatsappSecretKey, sendGrid ids, certificateArn) and heavy
 * blobs (pwaManifest, deploymentMetadata) that must not reach the browser.
 * GET and PATCH must stay in lockstep — the PATCH response is spread-merged
 * into the frontend's app state.
 */
const CUSTOM_HOST_FIELDS = {
  appName: 1,
  host: 1,
  logo: 1,
  offeringTitle: 1,
  offeringTitles: 1,
  androidShareLink: 1,
  iosShareLink: 1,
  loginScreenTitle: 1,
  colors: 1,
  theme: 1,
  gcpConfig: 1,
  onesignalAppId: 1,
  customOneSignalApiKey: 1,
  isPWAEnabled: 1,
  androidDeepLinkConfig: 1,
  iosDeepLinkConfig: 1,
  supportAddress: 1,
  customSupportLink: 1,
  enableSupportWidget: 1,
  supportWidget: 1,
  creator: 1,
  routingConfig: 1,
  iapMangoes: 1,
  isCommunityFeatureActive: 1,
} as const;
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

    // only run the (unindexable) regex match when there is a search term —
    // the default page load can then use the updatedAt index directly
    const searchRegex = new RegExp(escapeRegExp(SEARCH), "i");
    const searchedCustomhostsArray = await Mongo.customhost
      .aggregate([
        {
          $match: {
            ...(SEARCH
              ? {
                  $or: [
                    { appName: { $regex: searchRegex } },
                    { host: { $regex: searchRegex } },
                    { brandname: { $regex: searchRegex } },
                  ],
                }
              : {}),
            whitelableStatus: { $ne: "drafted" },
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
        {
          $lookup: {
            from: "customhostmetadatas",
            localField: "_id",
            foreignField: "host",
            as: "deploymentDetails",
            pipeline: [
              {
                $project: {
                  "androidDeploymentDetails.versionName": 1,
                  "androidDeploymentDetails.playStore.versionName": 1,
                  "iosDeploymentDetails.versionName": 1,
                  "iosDeploymentDetails.isUnderReview": 1,
                  "iosDeploymentDetails.appStore.versionName": 1,
                  "iosDeploymentDetails.appStore.status": 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$deploymentDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        // creatorEmail / appFormStatus (users + appforms lookups) moved to
        // GET /:id/export-details — they were consumed only by the per-row
        // CSV export, not the table
        {
          $project: {
            appName: 1,
            host: 1,
            logo: 1,
            createdAt: 1,
            updatedAt: 1,
            androidShareLink: 1,
            iosShareLink: 1,
            androidVersionName:
              "$deploymentDetails.androidDeploymentDetails.versionName",
            androidStoreVersionName:
              "$deploymentDetails.androidDeploymentDetails.playStore.versionName",
            iosVersionName:
              "$deploymentDetails.iosDeploymentDetails.versionName",
            iosStoreVersionName: {
              $cond: {
                if: {
                  $eq: [
                    "$deploymentDetails.iosDeploymentDetails.appStore.status",
                    "READY_FOR_DISTRIBUTION",
                  ],
                },
                then: "$deploymentDetails.iosDeploymentDetails.appStore.versionName",
                else: null,
              },
            },
            iosUnderReview:
              "$deploymentDetails.iosDeploymentDetails.isUnderReview",
          },
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
    /wl/apps/:id/export-details
    GET
    CSV-export-only columns (creatorEmail, appFormStatus) fetched on demand
    when the user clicks the per-row CSV button — keeps the users/appforms
    joins out of the hot list pipeline.
    Protected Route
*/
const getCustomHostExportDetailsHandler = factory.createHandlers(async (c) => {
  try {
    const { id } = c.req.param();
    const hostId = new ObjectId(id);

    const customHost = await Mongo.customhost.findOne(
      { _id: hostId },
      { projection: { creator: 1 } },
    );
    if (!customHost) {
      return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
    }

    const [creator, appForm] = await Promise.all([
      customHost.creator
        ? Mongo.platform_users.findOne(
            { _id: new ObjectId(customHost.creator) },
            { projection: { email: 1 } },
          )
        : null,
      Mongo.app_forms.findOne(
        { host: hostId, parentForm: { $exists: false } },
        { projection: { status: 1 } },
      ),
    ]);

    return c.json(
      {
        message: "Export Details",
        result: {
          creatorEmail: creator?.email ?? null,
          appFormStatus: appForm?.status ?? null,
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
    const customHost = await Mongo.customhost.findOne(
      {
        _id: new ObjectId(id),
      },
      { projection: CUSTOM_HOST_FIELDS },
    );

    if (!customHost) {
      return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
    }

    // full platform-user doc previously shipped otp + refreshTokens to the
    // browser; the UI shows name/email/phone only
    const creatorDetails = await Mongo.platform_users.findOne(
      {
        _id: new ObjectId(customHost?.creator),
      },
      { projection: { name: 1, email: 1, phone: 1 } },
    );

    return c.json(
      {
        message: "Fetched Custom Host",
        result: { ...customHost, creatorDetails },
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
          projection: CUSTOM_HOST_FIELDS,
        },
      );
      if (!updatedCustomHost) {
        return c.json({ message: "Custom Host not found" }, Response.NOT_FOUND);
      }

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

      // When any of the android or ios share links are updated,
      //  - Then we need to send email to the creator based on the action.
      //  - Also if both link exists, then update the app form to "DEPLOYED" (ie, if not already in DEPLOYED state).
      if (
        updatedCustomHost &&
        (updatedCustomHost.androidShareLink || updatedCustomHost.iosShareLink)
      ) {
        const appForm = await Mongo.app_forms.findOne({
          host: new ObjectId(id),
          parentForm: { $exists: false },
        });

        // if the app form is not deployed, then enqueue the message to deploy the app
        if (appForm && appForm.status !== AppFormStatus.DEPLOYED) {
          await awsService.enqueueMessage(
            "appzap.app.deployed",
            {
              host: updatedCustomHost._id.toString(),
            },
            {},
          );

          // if the android and ios share links are present, then update the app form to deployed
          if (
            updatedCustomHost.androidShareLink &&
            updatedCustomHost.iosShareLink
          ) {
            await Mongo.app_forms.findOneAndUpdate(
              {
                host: new ObjectId(id),
                parentForm: { $exists: false },
              },
              {
                $set: {
                  showAppsLiveBannerToCreator: true,
                  status: AppFormStatus.DEPLOYED,
                  updatedAt: new Date(),
                },
              },
            );
          }
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
  getCustomHostExportDetailsHandler,
  patchCustomHostByIdHandler,
};
