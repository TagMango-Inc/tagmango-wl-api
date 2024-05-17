import fs from "fs-extra";
import { createFactory } from "hono/factory";

import { zValidator } from "@hono/zod-validator";

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
      await writeFile(
        releaseFilePath,
        JSON.stringify({ ...parsedReleaseDetails, ...body }),
      );
      return c.json(
        {
          message: "Release details updated successfully",
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

export { getReleaseDetails, updateReleaseDetails };
