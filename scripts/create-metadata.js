const fs = require("fs-extra");
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
//         * 0_APP_IPHONE_55_0.png
//         * 0_APP_IPHONE_65_0.jpg
//         * 1_APP_IPHONE_55_1.png
//         * 1_APP_IPHONE_65_1.jpg
//         * 2_APP_IPHONE_55_2.png
//         * 2_APP_IPHONE_65_2.jpg
//         * 3_APP_IPHONE_55_3.png
//         * 3_APP_IPHONE_65_3.jpg
//         * 4_APP_IPHONE_55_4.jpg
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
  "primary_category",
  "primary_first_sub_category",
  "primary_second_sub_category",
  "secondary_category",
  "secondary_first_sub_category",
  "secondary_second_sub_category",
];

const generateMetadata = async ({
  hostId,
  fastlanePath,
  androidStoreSettings,
  iosStoreSettings,
  iosInfoSettings,
  iosReviewSettings,

  androidFeatureGraphic,
  androidScreenshots,

  iosScreenshots,
}) => {
  const androidPath = `${fastlanePath}/metadata/android/en-US`;
  const androidImagesPath = `${androidPath}/images`;
  const androidPhoneScreenshotsPath = `${androidImagesPath}/phoneScreenshots`;
  const iosPath = `${fastlanePath}/metadata/ios`;
  const iosStorePath = `${iosPath}/en-GB`;
  const iosReviewPath = `${iosPath}/review_information`;
  const iosScreenshotsPath = `${iosPath}/screenshots/en-GB`;

  const rootAssetPath = `./assets/${hostId}`;

  // Array of directory paths to ensure
  const directories = [
    androidPath,
    androidImagesPath,
    androidPhoneScreenshotsPath,
    iosStorePath,
    iosReviewPath,
    iosPath,
  ];

  // Create all directories concurrently
  await Promise.all(
    directories.map((dir) => fs.mkdir(dir, { recursive: true })),
  );

  // Writing files for Android store settings
  const androidPromise = Promise.all(
    androidStoreFiles.map((file) => {
      const path = `${androidPath}/${file}.txt`;
      return fs.writeFile(path, androidStoreSettings[file] ?? "");
    }),
  );

  // Writing files for iOS store settings
  const iosStorePromise = Promise.all(
    iosStoreFiles.map((file) => {
      const path = `${iosStorePath}/${file}.txt`;
      return fs.writeFile(path, iosStoreSettings[file] ?? "");
    }),
  );

  // Writing review files for iOS
  const iosReviewPromise = Promise.all(
    iosReviewFiles.map((file) => {
      const path = `${iosReviewPath}/${file}.txt`;
      return fs.writeFile(path, iosReviewSettings[file] ?? "");
    }),
  );

  // Writing info files for iOS
  const iosInfoPromise = Promise.all(
    iosInfoFiles.map((file) => {
      const path = `${iosPath}/${file}.txt`;
      return fs.writeFile(path, iosInfoSettings[file] ?? "");
    }),
  );

  // Copying Android images
  const copyAndroidImages = Promise.all([
    fs.copy(
      `${rootAssetPath}/${androidFeatureGraphic}`,
      `${androidImagesPath}/featureGraphic.png`,
    ),
    fs.copy(`${rootAssetPath}/icon.png`, `${androidImagesPath}/icon.png`),
    ...androidScreenshots.map((screenshot, index) => {
      return fs.copy(
        `${rootAssetPath}/${screenshot}`,
        `${androidPhoneScreenshotsPath}/${index + 1}_en-IN.png`,
      );
    }),
  ]);

  // Copying iOS screenshots
  const copyIosImages = Promise.all([
    ...(iosScreenshots["iphone_65"]?.map((screenshot, index) =>
      fs.copy(
        `${rootAssetPath}/${screenshot}`,
        `${iosScreenshotsPath}/${index}_APP_IPHONE_65_${index}.jpg`,
      ),
    ) || []),
    ...(iosScreenshots["iphone_55"]?.map((screenshot, index) =>
      fs.copy(
        `${rootAssetPath}/${screenshot}`,
        `${iosScreenshotsPath}/${index}_APP_IPHONE_55_${index}.png`,
      ),
    ) || []),
    ...(iosScreenshots["iphone_67"]?.map((screenshot, index) =>
      fs.copy(
        `${rootAssetPath}/${screenshot}`,
        `${iosScreenshotsPath}/${index}_APP_IPHONE_67_${index}.png`,
      ),
    ) || []),
  ]);

  // Execute all operations without waiting for each other to finish
  return Promise.all([
    androidPromise,
    iosStorePromise,
    iosReviewPromise,
    iosInfoPromise,
    copyAndroidImages,
    copyIosImages,
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

  generateMetadata(config);
}
