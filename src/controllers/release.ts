import { exec, execSync } from "child_process";
import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { z } from "zod";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../database";
import { Response } from "../utils/statuscode";
import { updateReleaseDetailsSchema } from "../validations/release";

const { readFile, writeFile } = fs.promises;

const factory = createFactory();

const releaseFilePath = "./data/release.json";

const getReleaseDetails = factory.createHandlers(async (c) => {
  try {
    const rawReleaseDetails = await readFile(releaseFilePath, "utf-8");

    const parsedReleaseDetails = JSON.parse(rawReleaseDetails);

    return c.json(
      {
        message: "Fetched release details",
        result: parsedReleaseDetails,
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

const updateReleaseDetails = factory.createHandlers(
  zValidator("json", updateReleaseDetailsSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const rawReleaseDetails = await readFile(releaseFilePath, "utf-8");

      const parsedReleaseDetails = JSON.parse(rawReleaseDetails);
      const mergedReleaseDetails = { ...parsedReleaseDetails, ...body };

      await writeFile(releaseFilePath, JSON.stringify(mergedReleaseDetails));

      // Keep the singleton appreleaseversions document in sync with the file
      // so core-api's latestAvailableVersionName reflects the new release.
      const now = new Date();
      await Mongo.app_release_versions.updateOne(
        {},
        {
          $set: {
            versionName: mergedReleaseDetails.versionName,
            buildNumber: mergedReleaseDetails.buildNumber,
            releaseNotes: mergedReleaseDetails.releaseNotes,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );

      return c.json(
        {
          message: "Release details updated successfully",
        },
        Response.OK,
      );
    } catch (error) {
      console.error("Error updating release details:", error);
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

// get device space
const getDeviceSpace = factory.createHandlers(async (c) => {
  try {
    // get the hardisk space of device
    const output = execSync("df -h /", { encoding: "utf8" }); // Works on Linux & macOS
    const lines = output.trim().split("\n");

    // Extract values from the second line
    const columns = lines[1].split(/\s+/);
    const size = columns[1]; // Total size
    const used = columns[2]; // Used space
    const available = columns[3]; // Available space
    const usedPercentage = columns[4]; // Usage percentage

    return c.json(
      {
        message: "Fetched device space",
        result: {
          total: size,
          used: used,
          available: available,
          usedPercentage: usedPercentage,
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

// get device space
const freeupSpace = factory.createHandlers(
  zValidator(
    "json",
    z.object({
      bundleIds: z.array(z.string()),
    }),
  ),
  async (c) => {
    try {
      // get bundled ids from body
      const { bundleIds } = c.req.valid("json");

      if (!bundleIds.length) {
        return c.json(
          {
            message: "No bundle ids found",
          },
          Response.BAD_REQUEST,
        );
      }

      for (let i = 0; i < bundleIds.length; i++) {
        exec(`rm -rf ./deployments/${bundleIds[i]}`);
      }

      return c.json(
        {
          message: "Fetched device space",
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

export { freeupSpace, getDeviceSpace, getReleaseDetails, updateReleaseDetails };
