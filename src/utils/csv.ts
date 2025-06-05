import { Context } from "hono";

import Mongo from "../database";
import { Response } from "./statuscode";

// Get apps by version in CSV format
export const getAppsByVersionCSV = async (
  c: Context,
  targetVersion: string,
  platform: string,
) => {
  try {
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
          $match:
            platform === "android"
              ? {
                  androidShareLink: { $type: "string", $ne: "" },
                  "metadata.androidDeploymentDetails.versionName":
                    targetVersion,
                }
              : {
                  iosShareLink: { $type: "string", $ne: "" },
                  "metadata.iosDeploymentDetails.versionName": targetVersion,
                },
        },
        {
          $project: {
            email: { $arrayElemAt: ["$creatorDetails.email", 0] },
            host: "$host",
            appName: "$appName",
            androidVersion: "$metadata.androidDeploymentDetails.versionName",
            iosVersion: "$metadata.iosDeploymentDetails.versionName",
          },
        },
      ])
      .toArray();

    // Convert to CSV format
    const headers = "sno.,email,host,appName,platform,version\n";
    const csvRows = result.map((app, index) => {
      if (platform === "android") {
        return `${index + 1},${app.email},${app.host},${app.appName},android,${app.androidVersion}`;
      } else {
        return `${index + 1},${app.email},${app.host},${app.appName},ios,${app.iosVersion}`;
      }
    });

    const csvContent = headers + csvRows.join("\n");

    // Set response headers for CSV download
    c.header("Content-Type", "text/csv");
    c.header(
      "Content-Disposition",
      `attachment; filename="apps-version-${targetVersion}.csv"`,
    );

    return c.body(csvContent);
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
};

// Get live apps on old version in CSV format
export const getLiveAppsOnOldVersionCSV = async (
  c: Context,
  latestVersion: string,
  target: string,
) => {
  try {
    let latestVersionQuery = "",
      shareLinkQuery = {};
    if (target === "ios") {
      latestVersionQuery = "metadata.iosDeploymentDetails.versionName";
      shareLinkQuery = { iosShareLink: { $type: "string", $ne: "" } };
    } else {
      latestVersionQuery = "metadata.androidDeploymentDetails.versionName";
      shareLinkQuery = { androidShareLink: { $type: "string", $ne: "" } };
    }

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
            email: { $arrayElemAt: ["$creatorDetails.email", 0] },
            host: "$host",
            appName: "$appName",
            currentVersion:
              target === "ios"
                ? "$metadata.iosDeploymentDetails.versionName"
                : "$metadata.androidDeploymentDetails.versionName",
            createdAt: "$createdAt",
          },
        },
      ])
      .toArray();

    // Convert to CSV format
    const headers = "sno.,email,host,appName,platform,currentVersion\n";
    const csvRows = result.map((app, index) => {
      return `${index + 1},${app.email},${app.host},${app.appName},${target},${app.currentVersion}`;
    });

    const csvContent = headers + csvRows.join("\n");

    // Set response headers for CSV download
    c.header("Content-Type", "text/csv");
    c.header(
      "Content-Disposition",
      `attachment; filename="live-apps-old-version-${target}.csv"`,
    );

    return c.body(csvContent);
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
};
