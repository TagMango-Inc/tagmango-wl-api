import Mongo from '../database';
import { AppFormStatus } from '../types/database';

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
      // match android and ios share link
      $match: {
        $and: [
          {
            iosShareLink: { $exists: false },
          },
          {
            androidShareLink: { $exists: false },
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
        localField: "_id", // Assuming customhosts and customhostmetadatas have a relation by "_id"
        foreignField: "host", // Assuming customhostmetadatas has a field "customHostId"
        as: "metadataDetails",
      },
    },

    {
      $match: {
        $or: [
          { "metadataDetails.logo": { $exists: false } },
          { "metadataDetails.logo": { $eq: null } },
          { "metadataDetails.logo": { $eq: "" } },

          { "metadataDetails.androidStoreSettings.title": { $exists: false } },
          { "metadataDetails.androidStoreSettings.title": { $eq: null } },
          { "metadataDetails.androidStoreSettings.title": { $eq: "" } },

          {
            "metadataDetails.androidStoreSettings.short_description": {
              $exists: false,
            },
          },
          {
            "metadataDetails.androidStoreSettings.short_description": {
              $eq: null,
            },
          },
          {
            "metadataDetails.androidStoreSettings.short_description": {
              $eq: "",
            },
          },

          {
            "metadataDetails.androidStoreSettings.full_description": {
              $exists: false,
            },
          },
          {
            "metadataDetails.androidStoreSettings.full_description": {
              $eq: null,
            },
          },
          {
            "metadataDetails.androidStoreSettings.full_description": {
              $eq: "",
            },
          },

          {
            "metadataDetails.iosStoreSettings.description": { $exists: false },
          },
          { "metadataDetails.iosStoreSettings.description": { $eq: null } },
          { "metadataDetails.iosStoreSettings.description": { $eq: "" } },

          { "metadataDetails.iosStoreSettings.keywords": { $exists: false } },
          { "metadataDetails.iosStoreSettings.keywords": { $eq: null } },
          { "metadataDetails.iosStoreSettings.keywords": { $eq: "" } },

          { "metadataDetails.iosStoreSettings.name": { $exists: false } },
          { "metadataDetails.iosStoreSettings.name": { $eq: null } },
          { "metadataDetails.iosStoreSettings.name": { $eq: "" } },

          {
            "metadataDetails.iosStoreSettings.promotional_text": {
              $exists: false,
            },
          },
          {
            "metadataDetails.iosStoreSettings.promotional_text": { $eq: null },
          },
          { "metadataDetails.iosStoreSettings.promotional_text": { $eq: "" } },
        ],
      },
    },
  ];

  const customHostsArr = await Mongo.customhost.aggregate(pipeline).toArray();

  console.log(customHostsArr.length);
  // console.log(customHostsArr[0].host);

  //save the ids in text file

  // const filePath = path.join(
  //   __dirname,
  //   "customHostsWithNoLinksAndIncompleteMetaData.txt",
  // );

  // let data = "";
  // for (const customHost of customHostsArr) {
  //   data += customHost._id + "\n";
  // }

  // fs.writeFileSync(filePath, data);

  // return;
  for (const customHost of customHostsArr) {
    const metadata = await Mongo.metadata.findOne({
      host: customHost._id,
    });

    if (!metadata) {
      console.log("metadata not found for customHost", customHost._id);
      continue;
    }

    // attach app form with the metadata and deployed status

    await Mongo.app_forms.findOneAndUpdate(
      { host: customHost._id }, // Filter to find the document
      {
        $set: {
          // Use $set to update the fields
          host: customHost._id,
          status: AppFormStatus.IN_PROGRESS,
          logo: metadata?.logo || "",
          customOneSignalIcon: "",

          backgroundType: metadata.backgroundType || "color",
          backgroundStartColor: metadata.backgroundStartColor || "#ffffff",
          backgroundEndColor: metadata.backgroundEndColor || "#ffffff",
          backgroundGradientAngle: metadata.backgroundGradientAngle || 45,
          logoPadding: metadata.logoPadding || 15,

          androidStoreSettings: {
            title: metadata.androidStoreSettings?.title || "",
            short_description:
              metadata.androidStoreSettings?.short_description || "",
            full_description:
              metadata.androidStoreSettings?.full_description || "",
            video: "",
          },
          iosStoreSettings: {
            description: metadata.iosStoreSettings?.description || "",
            keywords: metadata.iosStoreSettings?.keywords || "",
            marketing_url: "",
            name: metadata.iosStoreSettings?.name || "",
            privacy_url:
              metadata.iosStoreSettings?.privacy_url ||
              `https://${customHost.host}/privacy`,
            promotional_text: metadata.iosStoreSettings?.promotional_text || "",
            subtitle: "",
            support_url: "https://help.tagmango.com",
          },
          iosInfoSettings: {
            copyright: "©2021 TagMango, Inc.",
            primary_category: "EDUCATION",
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }, // Enable upsert
    );
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
