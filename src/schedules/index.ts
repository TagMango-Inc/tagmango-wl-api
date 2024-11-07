import { exec } from "child_process";
import fs from "fs-extra";
import jwt from "jsonwebtoken";
import cron from "node-cron";
import util from "util";

import { UPDATE_IOS_REVIEW_STATUS_CRON } from "../constants";
import Mongo from "../database";

const execAsync = util.promisify(exec);

const { readFile, writeFile } = fs.promises;

// list all the cron jobs to be run here

// cron to update ios review status
Mongo.connect().then(() => {
  cron.schedule(UPDATE_IOS_REVIEW_STATUS_CRON, async () => {
    console.log("Running update-ios-review-status schedule");
    const allMetadatas = await Mongo.metadata
      .find({
        $and: [
          {
            "iosDeploymentDetails.appleId": {
              $exists: true,
            },
          },
          {
            "iosDeploymentDetails.appleId": {
              $ne: "",
            },
          },
        ],
      })
      .toArray();

    console.log(allMetadatas.length, " <- total metadata found");

    let count = 0;

    for (const metadata of allMetadatas.slice(0, 5)) {
      try {
        let appleId = metadata.iosDeploymentDetails.appleId;

        if (!appleId) {
          console.log("apple id not found for bundleId", metadata.host);
          continue;
        }

        const privateKey = await readFile("./asc_api_pk.p8", "utf-8");

        let token = jwt.sign({}, privateKey, {
          algorithm: "ES256",
          expiresIn: "5m",
          issuer: "4f5cd5ab-5d30-46ec-8a09-33508575602e",
          audience: "appstoreconnect-v1",
          keyid: "FW86Z62C9N",
        });

        const res = await fetch(
          `https://api.appstoreconnect.apple.com/v1/apps/${appleId}/appStoreVersions?limit=1`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        let data = await res.json();

        if (data?.data?.length > 0) {
          const appDetails = data.data[0];
          const appVersion = appDetails.attributes.versionString;
          const appVersionState = appDetails.attributes.appVersionState;

          console.log(appVersion, appVersionState);
          await Mongo.metadata.findOneAndUpdate(
            {
              host: metadata.host,
            },
            {
              $set: {
                "iosDeploymentDetails.appStore.versionName": appVersion,
                "iosDeploymentDetails.appStore.status": appVersionState,
              },
            },
          );
          count++;
        }
      } catch (error) {
        console.log(error);
      }
    }

    console.log("total updated", count);
  });
});
