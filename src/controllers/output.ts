import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import Mongo from "../database";
import { AABDetailsType } from "../types";
import { Response } from "../utils/statuscode";

const { readFile } = fs.promises;

const factory = createFactory();

const getAllaabDetails = factory.createHandlers(async (c) => {
  try {
    const rawAABDetails = await readFile(`./data/android-aab.json`, "utf-8");
    const parsedAABDetails: AABDetailsType = JSON.parse(rawAABDetails);

    const customhostIds = Object.keys(parsedAABDetails).map(
      (id) => new ObjectId(id),
    );
    const docs = await Mongo.customhost
      .find(
        {
          _id: { $in: customhostIds },
        },
        {
          projection: {
            logo: 1,
            appName: 1,
            domain: 1,
            host: 1,
          },
        },
      )
      .toArray();

    const aabDetails = docs.map((doc) => {
      const { _id } = doc;
      const { versionName, buildNumber, createdAt } =
        parsedAABDetails[_id.toString()];
      return {
        ...doc,
        versionName,
        buildNumber,
        createdAt,
      };
    });

    return c.json(
      {
        message: "Fetched AAB Details",
        result: aabDetails,
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

export { getAllaabDetails };
