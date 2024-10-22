import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import {
  createOrRevokeSubscriptionSchema,
  patchIapProductIdsSchema,
  patchMangoIapDetailsSchema,
} from "../../src/validations/iap";
import Mongo from "../database";

const factory = createFactory();

/**
 * /iap/mangoes-by-creator/:creatorId
 * GET
 * Get all mangoes by creator
 */
const getAllMangoesByCreator = factory.createHandlers(async (c) => {
  const { creatorId } = c.req.param();
  const { host } = c.req.query();

  if (!creatorId || !host)
    return c.json(
      { message: "Creator ID and host is required" },
      {
        status: 400,
        statusText: "Bad Request",
      },
    );
  try {
    const demoUser = await Mongo.platform_users.findOne({
      phone: 1223334444,
      host,
    });

    // Aggregate posts, courses, and subscriptions
    const [allSubscriptions] = await Promise.all([
      demoUser
        ? Mongo.subscription
            .find(
              {
                creator: new ObjectId(creatorId),
                fan: demoUser._id,
                status: "active",
              },
              { projection: { mango: 1 } },
            )
            .toArray()
        : Promise.resolve([]),
    ]);

    const subscriptionMangoes = new Set(
      allSubscriptions.map((subscription) => subscription.mango.toHexString()),
    );

    const mangoAggregation = await Mongo.mango
      .aggregate([
        {
          $match: {
            creator: new ObjectId(creatorId),
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
          },
        },
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "mangoArr",
            as: "relatedPosts",
          },
        },
        {
          $addFields: {
            relatedPosts: {
              $filter: {
                input: "$relatedPosts",
                as: "post",
                cond: { $ne: ["$$post.isDeleted", true] }, // Check if isDeleted is not true
              },
            },
          },
        },
        {
          $lookup: {
            from: "rooms",
            localField: "_id",
            foreignField: "mango",
            as: "relatedRooms",
          },
        },
        {
          $addFields: {
            relatedRooms: {
              $filter: {
                input: "$relatedRooms",
                as: "room",
                cond: { $ne: ["$$room.isDeleted", true] }, // Check if isDeleted is not true
              },
            },
          },
        },
        {
          $lookup: {
            from: "courses",
            localField: "_id",
            foreignField: "mangoArr",
            as: "relatedCourses",
          },
        },
        {
          $addFields: {
            relatedCourses: {
              $filter: {
                input: "$relatedCourses", // Array of related courses
                as: "course",
                cond: {
                  $and: [
                    { $eq: ["$$course.isPublished", true] },
                    { $ne: ["$$course.isDripped", true] },
                  ],
                },
              },
            },
          },
        },
        {
          $unwind: "$relatedCourses",
        },
        {
          $lookup: {
            from: "chapters",
            localField: "relatedCourses._id", // Use the course ID to lookup chapters
            foreignField: "course", // Assuming each chapter has a `courseId` field to link to the course
            as: "relatedChapters",
          },
        },
        {
          $addFields: {
            relatedCourses: {
              $cond: {
                if: {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: "$relatedChapters", // Array of chapters related to the course
                          as: "chapter",
                          cond: {
                            $eq: ["$$chapter.contentType", "video"], // Check if contentType is video
                          },
                        },
                      },
                    },
                    0,
                  ], // Ensure that at least one chapter with contentType=video exists
                },
                then: "$relatedCourses", // Keep course if at least one video chapter exists
                else: null, // Exclude the course otherwise
              },
            },
          },
        },
        {
          $match: { relatedCourses: { $ne: null } },
        },

        {
          $group: {
            _id: "$_id",
            hasPosts: { $first: "$relatedPosts" }, // Preserve posts
            hasCourses: { $push: "$relatedCourses" }, // Collect filtered courses
            hasRooms: { $first: "$relatedRooms" }, // Preserve rooms
            title: { $first: "$title" },
            description: { $first: "$description" },
            price: { $first: "$price" },
            inrAmount: { $first: "$inrAmount" },
            usdAmount: { $first: "$usdAmount" },
            eurAmount: { $first: "$eurAmount" },
            recurringType: { $first: "$recurringType" },
            currency: { $first: "$currency" },
            iapProductId: { $first: "$iapProductId" },
            createdAt: { $first: "$createdAt" },
            iapDescription: { $first: "$iapDescription" },
            iapPrice: { $first: "$iapPrice" },
          },
        },
      ])
      .toArray();

    const mangoesToSend = mangoAggregation.map((mango) => ({
      ...mango,
      hasPosts: mango.hasPosts.length > 0,
      hasCourses: mango.hasCourses.length > 0,
      hasRooms: mango.hasRooms.length > 0,
      isSubscribed: subscriptionMangoes.has(mango._id.toHexString()),
    }));

    return c.json(
      {
        message: "Mangoes fetched successfully",
        result: mangoesToSend,
      },
      {
        status: 200,
        statusText: "OK",
      },
    );
  } catch (err) {
    return c.json(
      { message: "Internal Server Error" },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
    );
  }
});

/**
 * PATCH
 * /iap/update-product-ids
 * Update IAP product ids
 * @param req mangoIds: string[]; action: "assign" | "unassign"
 */
const updateIapProductIds = factory.createHandlers(
  zValidator("json", patchIapProductIdsSchema),
  async (c) => {
    try {
      const { mangoIds, action, host } = c.req.valid("json");

      const demoUser = await Mongo.platform_users.findOne({
        phone: 1223334444,
        host,
      });

      const result: Record<string, string> = {};
      if (action === "unassign") {
        await Mongo.mango.updateMany(
          {
            _id: {
              $in: mangoIds.map((mng) => new ObjectId(mng)),
            },
          },
          { $unset: { iapProductId: 1, iapDescription: 1, iapPrice: 1 } },
        );

        // remove subscription
        if (demoUser) {
          await Mongo.subscription.updateMany(
            {
              mango: {
                $in: mangoIds.map((mng) => new ObjectId(mng)),
              },
              fan: new ObjectId(demoUser._id),
            },
            {
              $set: {
                status: "expired",
              },
            },
          );

          await Mongo.subscription.deleteMany({
            mango: {
              $in: mangoIds.map((mng) => new ObjectId(mng)),
            },
            fan: new ObjectId(demoUser._id),
          });
        }
      } else {
        const mangoes = await Mongo.mango
          .find({
            _id: {
              $in: mangoIds.map((mng) => new ObjectId(mng)),
            },
          })
          .toArray();
        const promises = mangoes.map((mng) => {
          const newObjectId = new ObjectId().toString();
          mng.iapProductId = newObjectId;
          result[mng._id.toHexString()] = newObjectId;
          return Mongo.mango.updateOne(
            { _id: mng._id },
            {
              $set: {
                iapProductId: newObjectId,
              },
            },
          );
        });
        await Promise.all(promises);
      }

      return c.json(
        {
          message: "IAP product ids updated successfully",
          result,
        },
        {
          status: 200,
          statusText: "OK",
        },
      );
    } catch (err) {
      return c.json(
        { message: "Internal Server Error" },
        {
          status: 500,
          statusText: "Internal Server Error",
        },
      );
    }
  },
);

/**
 * PATCH
 * /iap/mangoes/:mangoId
 * Update IAP details of a mango
 * @param req iapDescription: string; iapPrice: number
 */
const updateMangoIapDetails = factory.createHandlers(
  zValidator("json", patchMangoIapDetailsSchema),
  async (c) => {
    const { mangoId } = c.req.param();
    const { iapDescription, iapPrice } = c.req.valid("json");

    if (!mangoId)
      return c.json(
        { message: "Mango ID is required" },
        {
          status: 400,
          statusText: "Bad Request",
        },
      );

    try {
      const mango = await Mongo.mango.findOne({
        _id: new ObjectId(mangoId),
      });
      if (!mango)
        return c.json(
          { message: "Mango not found" },
          {
            status: 404,
            statusText: "Not Found",
          },
        );

      await Mongo.mango.updateOne(
        { _id: new ObjectId(mangoId) },
        { $set: { iapDescription, iapPrice } },
      );

      return c.json(
        {
          message: "IAP details updated successfully",
        },
        {
          status: 200,
          statusText: "OK",
        },
      );
    } catch (err) {
      return c.json(
        { message: "Internal Server Error" },
        {
          status: 500,
          statusText: "Internal Server Error",
        },
      );
    }
  },
);

/**
 * POST /iap/subscriptions/:mangoId
 * Create a subscription or revoke a subscription
 * @param req action: "create" | "revoke", host: string
 */
const createOrRevokeSubscription = factory.createHandlers(
  zValidator("json", createOrRevokeSubscriptionSchema),
  async (c) => {
    const { mangoId } = c.req.param();
    const { action, host } = c.req.valid("json");

    if (!mangoId)
      return c.json(
        { message: "Mango ID is required" },
        {
          status: 400,
          statusText: "Bad Request",
        },
      );

    try {
      const demoUser = await Mongo.platform_users.findOne({
        phone: 1223334444,
        host,
      });

      let newUser;
      if (!demoUser) {
        // fint
        // create a new user
        newUser = await Mongo.platform_users.insertOne({
          phone: 1223334444,
          host,
          onboarding: "fan_completed",
          country: "IN",
          currency: "INR",
          name: "John Doe",
          email: "test.review@tagmango.com",
          profilePicUrl:
            "https://tagmango.com/staticassets/avatar-placeholder.png-1612857612139.png",
          isEmailVerified: false,
          mangoes: [],
          showtwitter: false,
          showfacebook: false,
          showinstagram: false,
          showyoutube: false,
          showlinkedin: false,
          isDeactivated: false,
          fanCompleted: false,
          otp: "",
          expireIn: "",
          createdAt: new Date(),
          updatedAt: new Date(),
          userSlug: `demo-user-${new ObjectId().toHexString()}`,
          firebaseSync: 0,
          syncFirebase: false,
          refreshTokens: [],
          isHiddenFromDiscovery: false,
          showSubscriberCount: false,
          isAssetsMigrated: false,
          videoUploadEnabled: false,
          convenienceFee: 0,
          mangoCreditsAvailable: 0,
          drmEnabled: false,
        });
      }

      if (!demoUser && !newUser) {
        return c.json(
          { message: "Cannot create demo user" },
          {
            status: 500,
            statusText: "Internal Server Error",
          },
        );
      }

      const mango = await Mongo.mango.findOne({
        _id: new ObjectId(mangoId),
      });
      if (!mango)
        return c.json(
          { message: "Mango not found" },
          {
            status: 404,
            statusText: "Not Found",
          },
        );

      if (action === "create") {
        const subscription = await Mongo.subscription.insertOne({
          creator: mango.creator,
          fan: demoUser
            ? new ObjectId(demoUser._id)
            : newUser
              ? newUser.insertedId
              : new ObjectId(),
          mango: new ObjectId(mangoId),
          status: "initiated",
          isPublic: false,
          createdAt: new Date(),
          expiredAt: new Date(
            new Date().setFullYear(new Date().getFullYear() + 10),
          ),
          orders: [],
        });
        await Mongo.subscription.updateOne(
          {
            _id: subscription.insertedId,
          },
          {
            $set: {
              status: "active",
              latestSubscriptionDate: new Date(),
            },
          },
        );
      } else {
        await Mongo.subscription.updateOne(
          {
            creator: mango.creator,
            fan: demoUser
              ? new ObjectId(demoUser._id)
              : newUser
                ? newUser.insertedId
                : new ObjectId(),
            mango: new ObjectId(mangoId),
          },
          {
            $set: {
              status: "expired",
            },
          },
        );
        await Mongo.subscription.deleteOne({
          creator: mango.creator,
          fan: demoUser
            ? new ObjectId(demoUser._id)
            : newUser
              ? newUser.insertedId
              : new ObjectId(),
          mango: new ObjectId(mangoId),
        });
      }

      return c.json(
        {
          message: "Subscription updated successfully",
        },
        {
          status: 200,
          statusText: "OK",
        },
      );
    } catch (err) {
      return c.json(
        { message: "Internal Server Error" },
        {
          status: 500,
          statusText: "Internal Server Error",
        },
      );
    }
  },
);

export {
  createOrRevokeSubscription,
  getAllMangoesByCreator,
  updateIapProductIds,
  updateMangoIapDetails,
};
