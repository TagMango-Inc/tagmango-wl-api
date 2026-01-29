import { exec } from "child_process";
import fs from "fs-extra";
import jwt from "jsonwebtoken";
import cron from "node-cron";
import puppeteer from "puppeteer";
import util from "util";

import { Types } from "mongoose";
import {
  UPDATE_ANDROID_PLAY_STORE_STATUS_CRON,
  UPDATE_IOS_REVIEW_STATUS_CRON,
  UPDATE_PRE_REQ_CRON,
} from "../constants";
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

    for (const metadata of allMetadatas) {
      try {
        let appleId = metadata.iosDeploymentDetails.appleId;

        if (!appleId) {
          console.log("apple id not found for bundleId", metadata.host);
          continue;
        }

        const iosDeveloperAccount = await Mongo.developer_accounts_ios.findOne({
          _id: metadata.iosDeveloperAccount,
        });

        if (!iosDeveloperAccount) {
          console.log(
            "ios developer account not found for bundleId",
            metadata.host,
          );
          continue;
        }

        const privateKey = await readFile(
          `./developer_accounts/ios/${iosDeveloperAccount._id}/asc_api_pk.p8`,
          "utf-8",
        );

        let token = jwt.sign({}, privateKey, {
          algorithm: "ES256",
          expiresIn: "5m",
          issuer: iosDeveloperAccount.ascApiKeyIssuer,
          audience: "appstoreconnect-v1",
          keyid: iosDeveloperAccount.ascApiKeyId,
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

  cron.schedule(UPDATE_PRE_REQ_CRON, async () => {
    const hosts = await Mongo.customhost
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
          $project: {
            _id: 1,
            host: 1,
            creator: 1,
            logo: 1,
          },
        },
      ])
      .toArray();

    console.log(hosts.length, " <- total hosts found");

    // Process hosts in batches of 10
    const batchSize = 10;
    for (let i = 0; i < hosts.length; i += batchSize) {
      const batch = hosts.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(hosts.length / batchSize)}`,
      );

      for (const hostDetails of batch) {
        console.log("Running for host id and url -> ", hostDetails._id);

        const creatorMangoes = await Mongo.mango
          .find({
            creator: hostDetails.creator,
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
            price: { $gt: 0 },
          })
          .toArray();

        const mangoIdArray = creatorMangoes.map((m) => m._id);

        const prerequisites = (isPostCourseAndRoomCreated: boolean) => [
          {
            isCompleted: !!mangoIdArray.length,
          },
          {
            isCompleted: isPostCourseAndRoomCreated,
          },
          {
            isCompleted:
              hostDetails.logo &&
              hostDetails.logo !==
                "https://assets.website-files.com/6302e597fbb6ee54fbee3b8a/630c8a92c693d29110158998_logocirclecolored.png"
                ? true
                : false,
          },
        ];

        const postsByMangoesPromise = await Mongo.post
          .find(
            {
              creator: hostDetails.creator,
              mangoArr: {
                $in: mangoIdArray,
              },
              isDeleted: {
                $ne: true,
              },
            },
            {
              projection: { _id: 1, mangoArr: 1 },
            },
          )
          .toArray();

        const coursesByMangoesPromise = await Mongo.course
          .find(
            {
              creator: hostDetails.creator,
              isPublished: true,
              isDripped: {
                $ne: true,
              },
              mangoArr: {
                $in: mangoIdArray,
              },
            },
            {
              projection: { _id: 1, mangoArr: 1 },
            },
          )
          .toArray();

        const [allPosts, allCourses] = await Promise.all([
          postsByMangoesPromise,
          coursesByMangoesPromise,
        ]);

        let allCoursesByChapterFilter: Types.ObjectId[] = [];

        if (allCourses && allCourses.length) {
          allCoursesByChapterFilter = (await Mongo.chapter.distinct("course", {
            creator: hostDetails.creator,
            course: {
              $in: allCourses.map((c) => c._id),
            },
            contentType: "video",
          })) as unknown as Types.ObjectId[];
        }

        const mangoList = creatorMangoes.map((mango) => {
          const mangoIdString = mango._id.toString();

          const relatedPosts = allPosts
            ? allPosts.reduce<Types.ObjectId[]>((acc, post) => {
                if (post.mangoArr.some((m) => m.toString() === mangoIdString)) {
                  acc.push(post._id);
                }
                return acc;
              }, [])
            : [];

          const allCoursesForThisMango = allCourses.filter((course) =>
            course.mangoArr?.find((m) => m.toString() === mangoIdString),
          );

          const relatedCourses = allCoursesByChapterFilter.length
            ? allCoursesByChapterFilter.map(
                (course) =>
                  allCoursesForThisMango.find(
                    (c) => c._id.toString() === course.toString(),
                  )?._id,
              )
            : [];

          return {
            _id: mango._id,
            title: mango.title,
            relatedPosts: relatedPosts.length > 0,
            relatedRooms: true,
            relatedCourses:
              relatedCourses.length > 0 &&
              relatedCourses.filter(Boolean).length > 0,
          };
        });

        const isPostCourseRoomLinkedWithOneMangoExists =
          mangoList.filter(
            (mango) =>
              mango.relatedPosts && mango.relatedCourses && mango.relatedRooms,
          ).length > 0;

        const pr = prerequisites(isPostCourseRoomLinkedWithOneMangoExists);

        const isPreReqCompleted = pr.every(
          (prerequisite) => prerequisite.isCompleted,
        );

        console.log(isPreReqCompleted, " <- isPreReqCompleted");

        await Mongo.metadata.updateOne(
          {
            host: hostDetails._id,
          },
          {
            $set: {
              isPreReqCompleted: isPreReqCompleted,
            },
          },
        );
      }

      // Wait for 10 seconds before processing the next batch (except for the last batch)
      if (i + batchSize < hosts.length) {
        console.log("Waiting 10 seconds before processing next batch...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  });

  // cron to update android play store status by scraping Google Play Store
  cron.schedule(UPDATE_ANDROID_PLAY_STORE_STATUS_CRON, async () => {
    console.log("Running update-android-play-store-status schedule");

    // Helper function for randomized delay (rate limiting)
    const randomDelay = (min = 3000, max = 6000) => {
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      return new Promise((resolve) => setTimeout(resolve, delay));
    };

    // Find all metadata with androidDeploymentDetails.bundleId that don't have playStore.versionName yet
    const allMetadatas = await Mongo.metadata
      .find({
        $and: [
          {
            "androidDeploymentDetails.bundleId": {
              $exists: true,
            },
          },
          {
            "androidDeploymentDetails.bundleId": {
              $ne: "",
            },
          },
          {
            $or: [
              {
                "androidDeploymentDetails.playStore.versionName": {
                  $exists: false,
                },
              },
              {
                "androidDeploymentDetails.playStore.versionName": {
                  $eq: "",
                },
              },
            ],
          },
        ],
      })
      .toArray();

    console.log(allMetadatas.length, " <- total metadata found for Android scraping");

    if (allMetadatas.length === 0) {
      console.log("No metadata to process for Android Play Store scraping");
      return;
    }

    let browser;
    try {
      // Launch the browser
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--ignore-certificate-errors",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      });

      const page = await browser.newPage();

      // Set user agent to avoid detection
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      let count = 0;

      for (const metadata of allMetadatas) {
        try {
          const bundleId = metadata.androidDeploymentDetails?.bundleId;

          if (!bundleId) {
            console.log("Bundle ID not found for host", metadata.host);
            continue;
          }

          console.log(`Scraping: ${bundleId}`);

          // Construct the Google Play Store URL
          const url = `https://play.google.com/store/apps/details?id=${bundleId}`;

          // Navigate to the app page
          await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

          // Check if app was not found
          const notFound = await page.evaluate(() => {
            return document.body.textContent?.includes(
              "the requested URL was not found on this server",
            );
          });

          if (notFound) {
            console.log(`❌ ${bundleId}: App not found on Play Store`);
            await randomDelay();
            continue;
          }

          // Wait for the page content to load
          await page.waitForSelector("h1", { timeout: 10000 });

          // Look for the "About this app" arrow button and click it
          const aboutButton = await page.evaluateHandle(() => {
            // Find the arrow icon next to "About this app" text
            const arrowIcon = document.querySelector(
              'i.google-material-icons.notranslate.VfPpkd-kBDsod.W7A5Qb[aria-hidden="true"]',
            );
            if (arrowIcon && arrowIcon.textContent?.trim() === "arrow_forward") {
              return arrowIcon;
            }

            // Alternative: look for any arrow_forward icon
            const allIcons = Array.from(
              document.querySelectorAll("i.google-material-icons"),
            );
            return allIcons.find(
              (icon) => icon.textContent?.trim() === "arrow_forward",
            );
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const buttonElement = aboutButton?.asElement() as any;
          if (buttonElement) {
            await buttonElement.click();
            console.log(`Clicked "About this app" button for ${bundleId}`);

            // Wait for the modal to appear by checking for "Version" text
            await page.waitForFunction(
              () => document.body.textContent?.includes("Version"),
              { timeout: 10000 },
            );

            // Extract version information from the modal
            const version = await page.evaluate(() => {
              // Look for the version information in the modal
              const allDivs = Array.from(document.querySelectorAll("div"));

              for (let i = 0; i < allDivs.length; i++) {
                const div = allDivs[i];
                const text = div.textContent?.trim();

                // Check if this div contains "Version"
                if (text === "Version") {
                  // Look for the next sibling div that contains the version number
                  const nextDiv = allDivs[i + 1];
                  if (nextDiv && nextDiv.textContent) {
                    const versionText = nextDiv.textContent.trim();
                    // Check if it looks like a version number (contains dots and numbers)
                    if (/^\d+(\.\d+)+/.test(versionText)) {
                      return versionText;
                    }
                  }

                  // Also check parent's next sibling
                  const parent = div.parentElement;
                  if (parent && parent.nextElementSibling) {
                    const nextSibling = parent.nextElementSibling;
                    const versionText = nextSibling.textContent?.trim();
                    if (versionText && /^\d+(\.\d+)+/.test(versionText)) {
                      return versionText;
                    }
                  }
                }
              }

              // Alternative approach: look for version pattern in all text content
              const versionPattern = /Version\s*[\n\r]\s*(\d+(?:\.\d+)+)/i;
              const bodyText = document.body.textContent;
              const match = bodyText?.match(versionPattern);
              if (match) {
                return match[1];
              }

              return null;
            });

            if (version) {
              console.log(`✅ ${bundleId}: ${version}`);

              // Save to database
              await Mongo.metadata.findOneAndUpdate(
                {
                  host: metadata.host,
                },
                {
                  $set: {
                    "androidDeploymentDetails.playStore.versionName": version,
                    "androidDeploymentDetails.playStore.status":
                      "READY_FOR_DISTRIBUTION",
                  },
                },
              );
              count++;
            } else {
              console.log(`❌ ${bundleId}: Version not found`);
            }
          } else {
            console.log(`❌ ${bundleId}: "About this app" button not found`);
          }

          // Randomized delay before processing next bundle ID (rate limiting)
          await randomDelay();
        } catch (error) {
          console.log(
            `❌ ${metadata.androidDeploymentDetails?.bundleId}: Error - ${(error as Error).message}`,
          );
        }
      }

      console.log("Android Play Store scraping completed! Total updated:", count);
    } catch (error) {
      console.error("Script error:", (error as Error).message);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  });
});
