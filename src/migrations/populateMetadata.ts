import Mongo from "../database";

export const populateMetadata = async () => {
  const metadatas = await Mongo.metadata
    .find({ androidStoreSettings: { $exists: false } })
    .toArray();

  for (const metadata of metadatas) {
    // @ts-expect-error
    const appName = metadata.appName;

    const updatedMetadata = {
      ...metadata,
      androidStoreSettings: {
        title: appName,
        short_description: `Get access to all premium content by ${appName}!`,
        full_description: `Get access to all premium content in ${appName}. Access pre-recorded courses, enrol for live workshops, get certified and a lot more! Be a part of the awesome community that you always wanted to be in!`,
        video: "",
      },
      iosStoreSettings: {
        description: `Get access to all premium content in ${appName}. Access pre-recorded courses, enrol for live workshops, get certified and a lot more! Be a part of the awesome community that you always wanted to be in!`,
        keywords: "EdTech, Education",
        marketing_url: "",
        name: appName,
        privacy_url: "",
        promotional_text: `Get access to all premium content by ${appName}!`,
        subtitle: "",
        support_url: "https://help.tagmango.com",
      },
      iosInfoSettings: {
        copyright: "©2021 TagMango, Inc.",
        primary_category: "Education",
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
    };

    // save the metadata
    await Mongo.metadata.updateOne(
      { _id: metadata._id },
      {
        $set: updatedMetadata,
      },
    );
  }
};

export const removeAppNameFromMetadata = async () => {
  await Mongo.metadata.updateMany(
    {},
    {
      $unset: {
        appName: "",
      },
    },
  );
};

export const fixPrimaryCategory = async () => {
  await Mongo.metadata.updateMany(
    {},
    {
      $set: {
        "iosInfoSettings.primary_category": "EDUCATION",
      },
    },
  );
};
