const fs = require("fs-extra");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const https = require("https");
const path = require("path");

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const { writeFile, readFile } = fs.promises;

// * metadata/android/
// * en-US/
//     * images/
//         * phoneScreenshots/
//             * 1_en-IN.jpeg
//             * 2_en-IN.jpeg
//             * 3_en-IN.jpeg
//             * 4_en-IN.jpeg
//             * 5_en-IN.jpeg
//             * 6_en-IN.jpeg
//             * 7_en-IN.jpeg
//         * sevenInchScreenshots/
//         * tenInchScreenshots/
//         * tvScreenshots/
//         * wearScreenshots/
//         * featureGraphic.jpeg
//         * icon.jpeg
//     * title.txt
//     * short_description.txt
//     * full_description.txt
//     * video.txt
//     * changelogs/
//         * default.txt

// * metadata/ios/
// * en-GB/
//     * apple_tv_privacy_policy.txt
//     * description.txt
//     * keywords.txt
//     * marketing_url.txt
//     * name.txt
//     * privacy_url.txt
//     * promotional_text.txt
//     * release_notes.txt
//     * subtitle.txt
//     * support_url.txt
// * review_information/
//     * demo_password.txt
//     * demo_user.txt
//     * email_address.txt
//     * first_name.txt
//     * last_name.txt
//     * notes.txt
//     * phone_number.txt
// * copyright.txt
// * primary_category.txt
// * primary_first_sub_category.txt
// * primary_second_sub_category.txt
// * secondary_category.txt
// * secondary_first_sub_category.txt
// * secondary_second_sub_category.txt
// * screenshots/
//     * en-GB/
//         * 0_APP_IPHONE_65_0.jpg
//         * 1_APP_IPHONE_65_1.jpg
//         * 2_APP_IPHONE_65_2.jpg
//         * 3_APP_IPHONE_65_3.jpg
//         * 4_APP_IPHONE_65_4.jpg

const androidStoreFiles = [
  "title",
  "short_description",
  "full_description",
  "video",
];

const iosStoreFiles = [
  "apple_tv_privacy_policy",
  "description",
  "keywords",
  "marketing_url",
  "name",
  "privacy_url",
  "promotional_text",
  "release_notes",
  "subtitle",
  "support_url",
];

const iosReviewFiles = [
  "demo_password",
  "demo_user",
  "email_address",
  "first_name",
  "last_name",
  "notes",
  "phone_number",
];

const iosInfoFiles = [
  "copyright",
  "primary_category",
  "primary_first_sub_category",
  "primary_second_sub_category",
  "secondary_category",
  "secondary_first_sub_category",
  "secondary_second_sub_category",
];

const downloadFile = async (url, outputPath) => {
  try {
    await fs.ensureDir(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
      https
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(`Failed to download ${url}: ${response.statusCode}`),
            );
            return;
          }

          const writer = fs.createWriteStream(outputPath);
          response.pipe(writer);

          writer.on("finish", () => {
            writer.close();
            resolve();
          });

          writer.on("error", (err) => {
            writer.close();
            reject(err);
          });
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  } catch (error) {
    console.error(`Error downloading file from ${url}:`, error);
    throw error;
  }
};

const generateMetadata = async ({
  hostId,
  rootPath,
  fastlanePath,
  androidStoreSettings,
  iosStoreSettings,
  iosInfoSettings,
  iosReviewSettings,

  androidFeatureGraphic,
  androidScreenshots,

  iosScreenshots,

  androidDeveloperAccount,
}) => {
  const androidPath = `${fastlanePath}/metadata/android/en-GB`;
  const androidUSPath = `${fastlanePath}/metadata/android/en-US`;
  const androidImagesPath = `${androidPath}/images`;
  const androidUSImagesPath = `${androidUSPath}/images`;
  const androidPhoneScreenshotsPath = `${androidImagesPath}/phoneScreenshots`;
  const androidUSPhoneScreenshotsPath = `${androidUSImagesPath}/phoneScreenshots`;
  const androidChangeLogsPath = `${androidPath}/changelogs`;
  const androidUSChangeLogsPath = `${androidUSPath}/changelogs`;
  const iosPath = `${fastlanePath}/metadata/ios`;
  const iosStorePath = `${iosPath}/en-GB`;
  const iosUSStorePath = `${iosPath}/en-US`;
  const iosReviewPath = `${iosPath}/review_information`;
  const iosScreenshotsPath = `${iosPath}/screenshots/en-GB`;
  const iosUSScreenshotsPath = `${iosPath}/screenshots/en-US`;

  const rootAssetPath = `https://tagmango.com/appzap-assets/metadata/${hostId}`;

  // Array of directory paths to ensure
  const directories = [
    androidPath,
    androidUSPath,
    androidImagesPath,
    androidUSImagesPath,
    androidPhoneScreenshotsPath,
    androidUSPhoneScreenshotsPath,
    androidChangeLogsPath,
    androidUSChangeLogsPath,
    iosStorePath,
    iosUSStorePath,
    iosReviewPath,
    iosPath,
    iosScreenshotsPath,
    iosUSScreenshotsPath,
  ];

  const releaseDetails = await readFile("./data/release.json");
  const { releaseNotes } = JSON.parse(releaseDetails);

  if (androidDeveloperAccount && androidDeveloperAccount._id) {
    // move developer_accounts/android/[androidDeveloperAccount._id]/keystore.jks to rootPath/android/app/keystore.jks
    const keystorePath = `${rootPath}/android/app/keystore.jks`;
    await fs.copy(
      `./developer_accounts/android/${androidDeveloperAccount._id}/keystore.jks`,
      keystorePath,
    );

    // move developer_accounts/android/[androidDeveloperAccount._id]/fastlane-android.json to rootPath/fastlane-android.json
    const fastlaneAndroidJSONPath = `${rootPath}/fastlane-android.json`;
    await fs.copy(
      `./developer_accounts/android/${androidDeveloperAccount._id}/fastlane-android.json`,
      fastlaneAndroidJSONPath,
    );
  }

  // Create all directories concurrently
  await Promise.all(
    directories.map((dir) => fs.ensureDir(dir, { recursive: true })),
  );

  // Writing files for Android store settings
  const androidPromise = Promise.all(
    androidStoreFiles.map((file) => {
      const path = `${androidPath}/${file}.txt`;
      return writeFile(path, androidStoreSettings[file] ?? "");
    }),
  );
  const androidUSPromise = Promise.all(
    androidStoreFiles.map((file) => {
      const path = `${androidUSPath}/${file}.txt`;
      return writeFile(path, androidStoreSettings[file] ?? "");
    }),
  );

  // Write changelog for Android
  const changelogPath = `${androidChangeLogsPath}/default.txt`;
  const changelogUSPath = `${androidUSChangeLogsPath}/default.txt`;
  const androidChangeLogPromise = writeFile(changelogPath, releaseNotes);
  const androidUSChangeLogPromise = writeFile(changelogUSPath, releaseNotes);

  // Writing files for iOS store settings
  const iosStorePromise = Promise.all(
    iosStoreFiles.map((file) => {
      const path = `${iosStorePath}/${file}.txt`;
      return writeFile(path, iosStoreSettings[file] ?? "");
    }),
  );
  const iosUSStorePromise = Promise.all(
    iosStoreFiles.map((file) => {
      const path = `${iosUSStorePath}/${file}.txt`;
      return writeFile(path, iosStoreSettings[file] ?? "");
    }),
  );

  // Writing release notes for iOS
  const releaseNotesPath = `${iosStorePath}/release_notes.txt`;
  const iosReleaseNotesPromise = writeFile(releaseNotesPath, releaseNotes);

  const iosUSReleaseNotesPath = `${iosUSStorePath}/release_notes.txt`;
  const iosUSReleaseNotesPromise = writeFile(
    iosUSReleaseNotesPath,
    releaseNotes,
  );

  // Writing review files for iOS
  const iosReviewPromise = Promise.all(
    iosReviewFiles.map((file) => {
      const path = `${iosReviewPath}/${file}.txt`;
      return writeFile(path, iosReviewSettings[file] ?? "");
    }),
  );

  // Writing info files for iOS
  const iosInfoPromise = Promise.all(
    iosInfoFiles.map((file) => {
      const path = `${iosPath}/${file}.txt`;
      return writeFile(path, iosInfoSettings[file] ?? "");
    }),
  );

  try {
    if (!androidScreenshots || !iosScreenshots || !androidFeatureGraphic) {
      console.log(
        "No screenshot metadata is unavailable, trying to fetch from db",
      );
      await client.connect();

      console.log("Connected to MongoDB");

      const metadata = await client
        .db("tagmango-production")
        .collection("customhostmetadatas")
        .findOne({ host: new ObjectId(hostId) });

      if (metadata) {
        androidScreenshots = metadata.androidScreenshots;
        iosScreenshots = metadata.iosScreenshots;
        androidFeatureGraphic = metadata.androidFeatureGraphic;
      } else {
        throw new Error("Metadata not found in db");
      }
    }
  } catch (err) {
    console.error(err);
    throw err;
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }

  // Copying Android images
  const copyAndroidImages = Promise.all([
    downloadFile(
      `${rootAssetPath}/${androidFeatureGraphic}`,
      `${androidImagesPath}/featureGraphic.png`,
    ),
    downloadFile(
      `${rootAssetPath}/${androidFeatureGraphic}`,
      `${androidUSImagesPath}/featureGraphic.png`,
    ),
    downloadFile(`${rootAssetPath}/icon.png`, `${androidImagesPath}/icon.png`),
    downloadFile(
      `${rootAssetPath}/icon.png`,
      `${androidUSImagesPath}/icon.png`,
    ),
    ...androidScreenshots.map((screenshot, index) => {
      return downloadFile(
        `${rootAssetPath}/${screenshot}`,
        `${androidPhoneScreenshotsPath}/${index + 1}_en-IN.png`,
      );
    }),
    ...androidScreenshots.map((screenshot, index) => {
      return downloadFile(
        `${rootAssetPath}/${screenshot}`,
        `${androidUSPhoneScreenshotsPath}/${index + 1}_en-IN.png`,
      );
    }),
  ]);

  // Copying iOS screenshots
  const copyIosImages = Promise.all([
    ...(iosScreenshots["iphone_65"]?.map((screenshot, index) =>
      downloadFile(
        `${rootAssetPath}/${screenshot}`,
        `${iosScreenshotsPath}/${index}_APP_IPHONE_65_${index}.png`,
      ),
    ) || []),
  ]);

  const copyIosUSImages = Promise.all([
    ...(iosScreenshots["iphone_65"]?.map((screenshot, index) =>
      downloadFile(
        `${rootAssetPath}/${screenshot}`,
        `${iosUSScreenshotsPath}/${index}_APP_IPHONE_65_${index}.png`,
      ),
    ) || []),
  ]);

  // Execute all operations without waiting for each other to finish
  return Promise.all([
    androidPromise,
    androidUSPromise,
    androidChangeLogPromise,
    androidUSChangeLogPromise,
    iosStorePromise,
    iosUSStorePromise,
    iosReleaseNotesPromise,
    iosUSReleaseNotesPromise,
    iosReviewPromise,
    iosInfoPromise,
    copyAndroidImages,
    copyIosImages,
    copyIosUSImages,
  ]);
};

const commandLineArgs = process.argv.slice(2);

if (commandLineArgs) {
  let config = {};

  commandLineArgs.forEach((entry) => {
    const [key, ...values] = entry.split(":");
    const value = values.join(":");

    try {
      config[key] = JSON.parse(value);
    } catch (e) {
      config[key] = value;
    }
  });

  generateMetadata(config).catch((err) => {
    console.error(err);
    throw err;
  });
}
