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
}) => {
  const androidPath = `${fastlanePath}/metadata/android/en-US`;
  const iosPath = `${fastlanePath}/metadata/ios`;
  const iosStorePath = `${iosPath}/en-GB`;
  const iosReviewPath = `${iosPath}/review_information`;

  await fs.ensureDir(androidPath);
  await fs.ensureDir(iosStorePath);
  await fs.ensureDir(iosReviewPath);
  await fs.ensureDir(iosPath);

  await Promise.all(
    androidStoreFiles.map(async (file) => {
      const path = `${androidPath}/${file}.txt`;
      await fs.writeFile(path, androidStoreSettings[file] ?? "");
    }),
  );

  await Promise.all(
    iosStoreFiles.map(async (file) => {
      const path = `${iosStorePath}/${file}.txt`;
      await fs.writeFile(path, iosStoreSettings[file] ?? "");
    }),
  );

  await Promise.all(
    iosReviewFiles.map(async (file) => {
      const path = `${iosReviewPath}/${file}.txt`;
      await fs.writeFile(path, iosReviewSettings[file] ?? "");
    }),
  );

  await Promise.all(
    iosInfoFiles.map(async (file) => {
      const path = `${iosPath}/${file}.txt`;
      await fs.writeFile(path, iosInfoSettings[file] ?? "");
    }),
  );
};

const commandLineArgs = process.argv.slice(2);

if (commandLineArgs) {
  const config = {};
  commandLineArgs.forEach((entry) => {
    const items = entry.split(":");
    let keys = [];
    let value = "";
    if (items.length > 2) {
      keys = items.slice(0, 2);
      value = items.slice(2).join(":");
    } else {
      keys = [items[0]];
      value = items[1];
    }

    keys.reduce((acc, key, index) => {
      if (index === keys.length - 1) {
        acc[key] = value;
      } else {
        acc[key] = acc[key] || {};
      }
      return acc[key];
    }, config);
  });

  generateMetadata(config);
}
