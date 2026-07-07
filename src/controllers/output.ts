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

    // the data file can contain corrupt keys (a literal "undefined" from a
    // build recorded without a host id) — one bad key must not 500 the list
    const customhostIds = Object.keys(parsedAABDetails)
      .filter((id) => /^[a-f0-9]{24}$/i.test(id))
      .map((id) => new ObjectId(id));
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

/**
 * DELETE /wl/output/android/aab/:id
 * Removes a generated .aab bundle: deletes the outputs file and drops the
 * entry from data/android-aab.json. Irreversible (the file is deleted).
 */
const deleteAabById = factory.createHandlers(async (c) => {
  try {
    const { id } = c.req.param();

    // id is interpolated into a filesystem path — keep it strictly ObjectId-ish
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      return c.json({ message: "Invalid id" }, Response.BAD_REQUEST);
    }

    const rawAABDetails = await readFile(`./data/android-aab.json`, "utf-8");
    const parsedAABDetails: AABDetailsType = JSON.parse(rawAABDetails);

    if (!parsedAABDetails[id]) {
      return c.json({ message: "Bundle not found" }, Response.NOT_FOUND);
    }

    delete parsedAABDetails[id];
    await fs.writeFile(
      `./data/android-aab.json`,
      JSON.stringify(parsedAABDetails, null, 2),
    );
    await fs.remove(`./outputs/android/${id}.aab`);

    return c.json({ message: "Bundle deleted successfully" }, Response.OK);
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

export { deleteAabById, getAllaabDetails };
