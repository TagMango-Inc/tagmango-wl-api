import Mongo from "../database";

const fs = require("fs");
const path = require("path");

// Required fields before form can be imported
// "logo",

// "androidStoreSettings.title",
// "androidStoreSettings.short_description",
// "androidStoreSettings.full_description",

// "iosStoreSettings.name",
// "iosStoreSettings.description",
// "iosStoreSettings.keywords",
// "iosStoreSettings.promotional_text",

export const populateAppForms = async () => {
  //find all enterprise-plan creators
  // find there custom host data
  // find there custom host metadata data
  // find the ios and android share link from custom host data

  const pipeline = [
    {
      $match: {
        $and: [
          {
            $and: [
              { androidShareLink: { $exists: true } },
              { androidShareLink: { $ne: "" } },
              { androidShareLink: { $ne: null } },
            ],
          },
          {
            $and: [
              { iosShareLink: { $exists: true } },
              { iosShareLink: { $ne: "" } },
              { iosShareLink: { $ne: null } },
            ],
          },
        ],
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
        as: "metadataDetails",
      },
    },

    {
      $match: {
        $and: [
          { "metadataDetails.logo": { $exists: true } },
          { "metadataDetails.logo": { $ne: null } },
          { "metadataDetails.logo": { $ne: "" } },

          { "metadataDetails.androidStoreSettings.title": { $exists: true } },
          { "metadataDetails.androidStoreSettings.title": { $ne: null } },
          { "metadataDetails.androidStoreSettings.title": { $ne: "" } },

          {
            "metadataDetails.androidStoreSettings.short_description": {
              $exists: true,
            },
          },
          {
            "metadataDetails.androidStoreSettings.short_description": {
              $ne: null,
            },
          },
          {
            "metadataDetails.androidStoreSettings.short_description": {
              $ne: "",
            },
          },

          {
            "metadataDetails.androidStoreSettings.full_description": {
              $exists: true,
            },
          },
          {
            "metadataDetails.androidStoreSettings.full_description": {
              $ne: null,
            },
          },
          {
            "metadataDetails.androidStoreSettings.full_description": {
              $ne: "",
            },
          },

          {
            "metadataDetails.iosStoreSettings.description": { $exists: true },
          },
          { "metadataDetails.iosStoreSettings.description": { $ne: null } },
          { "metadataDetails.iosStoreSettings.description": { $ne: "" } },

          { "metadataDetails.iosStoreSettings.keywords": { $exists: true } },
          { "metadataDetails.iosStoreSettings.keywords": { $ne: null } },
          { "metadataDetails.iosStoreSettings.keywords": { $ne: "" } },

          { "metadataDetails.iosStoreSettings.name": { $exists: true } },
          { "metadataDetails.iosStoreSettings.name": { $ne: null } },
          { "metadataDetails.iosStoreSettings.name": { $ne: "" } },

          {
            "metadataDetails.iosStoreSettings.promotional_text": {
              $exists: true,
            },
          },
          {
            "metadataDetails.iosStoreSettings.promotional_text": { $ne: null },
          },
          { "metadataDetails.iosStoreSettings.promotional_text": { $ne: "" } },
        ],
      },
    },
  ];

  const customHostsArr = await Mongo.customhost.aggregate(pipeline).toArray();

  const hostids = customHostsArr.map((customHost) => customHost._id);
  const appFormsArr = await Mongo.app_forms
    .find({ host: { $in: hostids } })
    .toArray();

  const appFormHostId = appFormsArr.map((appForm) => String(appForm.host));
  // find the appForm that does not have a host from hostIds array
  const appFormsWithoutHost = customHostsArr.filter(
    (customHost) => !appFormHostId.includes(String(customHost._id)),
  );
  console.log(customHostsArr.length, appFormsArr.length, appFormsWithoutHost);

  return; // guard
  for (const customHost of customHostsArr) {
    const metadata = await Mongo.metadata.findOne({
      host: customHost._id,
    });

    let newMetadata = null;
    if (!metadata) {
      console.log("metadata not found for customHost", customHost._id);

      // create metadata

      const appName = customHost.appName ?? customHost.brandname ?? "";
      const formattedName = appName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

      const result = await Mongo.metadata.insertOne({
        host: customHost._id,
        logo: "",
        backgroundType: "color",
        backgroundStartColor: "#ffffff",
        backgroundEndColor: "#ffffff",
        backgroundGradientAngle: 45,
        logoPadding: 15,
        iosDeploymentDetails: {
          bundleId: ``,
          lastDeploymentDetails: {
            versionName: "3.0.7",
            buildNumber: 450,
          },
          isUnderReview: false,
        },
        androidDeploymentDetails: {
          bundleId: ``,
          lastDeploymentDetails: {
            versionName: "3.0.7",
            buildNumber: 450,
          },
          isUnderReview: false,
        },
        androidStoreSettings: {
          title: "",
          short_description: "",
          full_description: "",
          video: "",
        },
        iosStoreSettings: {
          description: "",
          keywords: "EdTech, Education",
          marketing_url: "",
          name: "",
          privacy_url: `https://${customHost.host}/privacy`,
          promotional_text: "",
          subtitle: "",
          support_url: "https://help.tagmango.com",
        },
        iosInfoSettings: {
          copyright: "©2021 TagMango, Inc.",
          primary_category: "EDUCATION",
        },
        iosReviewSettings: {
          demo_password: "123456",
          demo_user: "1223334444",
          email_address: "hasan@tagmango.com",
          first_name: "Mohammad",
          last_name: "Hasan",
          notes:
            'The App requires OTP to login. Please use the password as OTP to login.\n\nIf the app is expecting email id to login please use below credentials:\nemail:\ntest.review@tagmango.com\npassword(OTP):\n123456\n\nIf on entering the OTP it shows "Login Limit Exceeded" on a modal press on "Continue" button to enter the app.',
          phone_number: "+919748286867",
        },

        isFormImported: false,
      } as any);

      newMetadata = await Mongo.metadata.findOne({
        _id: result.insertedId,
      });
    }

    // attach app form with the metadata and deployed status

    // await Mongo.app_forms.findOneAndUpdate(
    //   { host: customHost._id }, // Filter to find the document
    //   {
    //     $set: {
    //       // Use $set to update the fields
    //       host: customHost._id,
    //       status: AppFormStatus.IN_PROGRESS,
    //       logo: metadata ? metadata?.logo || "" : newMetadata?.logo || "",
    //       customOneSignalIcon: "",

    //       backgroundType: metadata
    //         ? metadata.backgroundType || "color"
    //         : newMetadata?.backgroundType,
    //       backgroundStartColor: metadata
    //         ? metadata.backgroundStartColor || "#ffffff"
    //         : newMetadata?.backgroundStartColor,
    //       backgroundEndColor: metadata
    //         ? metadata.backgroundEndColor || "#ffffff"
    //         : newMetadata?.backgroundEndColor,
    //       backgroundGradientAngle: metadata
    //         ? metadata.backgroundGradientAngle || 45
    //         : newMetadata?.backgroundGradientAngle,
    //       logoPadding: metadata
    //         ? metadata.logoPadding || 15
    //         : newMetadata?.logoPadding,

    //       androidStoreSettings: {
    //         title: metadata
    //           ? metadata.androidStoreSettings?.title || ""
    //           : newMetadata?.androidStoreSettings?.title || "",
    //         short_description: metadata
    //           ? metadata.androidStoreSettings?.short_description || ""
    //           : newMetadata?.androidStoreSettings?.short_description || "",
    //         full_description: metadata
    //           ? metadata.androidStoreSettings?.full_description || ""
    //           : newMetadata?.androidStoreSettings?.full_description || "",
    //         video: "",
    //       },
    //       iosStoreSettings: {
    //         description: metadata
    //           ? metadata.iosStoreSettings?.description || ""
    //           : newMetadata?.iosStoreSettings?.description || "",
    //         keywords: metadata
    //           ? metadata.iosStoreSettings?.keywords || ""
    //           : newMetadata?.iosStoreSettings?.keywords || "",
    //         marketing_url: "",
    //         name: metadata
    //           ? metadata.iosStoreSettings?.name || ""
    //           : newMetadata?.iosStoreSettings?.name || "",
    //         privacy_url: metadata
    //           ? metadata.iosStoreSettings?.privacy_url
    //           : `https://${customHost.host}/privacy`,
    //         promotional_text: metadata
    //           ? metadata.iosStoreSettings?.promotional_text || ""
    //           : newMetadata?.iosStoreSettings?.promotional_text || "",
    //         subtitle: "",
    //         support_url: "https://help.tagmango.com",
    //       },
    //       iosInfoSettings: {
    //         copyright: "©2021 TagMango, Inc.",
    //         primary_category: "EDUCATION",
    //       },
    //       createdAt: new Date(),
    //       updatedAt: new Date(),
    //     },
    //   },
    //   { upsert: true }, // Enable upsert
    // );
  }

  // if sharelinks == 2
  // attach app form with the metadata and deployed status

  // if sharelink == 0
  // if all data is present
  // attach app form with the metadata and approved status

  // if all data is not present
  // attach app form with the metadata and in-progress status

  // if sharelink == 1
  // if all data is present
  // attach app form with the metadata and approved status

  // if all data is not present
  // attach app form with the metadata and in-progress status
};
