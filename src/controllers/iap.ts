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

    const mangoes = await Mongo.mango
      .find(
        {
          creator: new ObjectId(creatorId),
          isHidden: { $ne: true },
          isStopTakingPayment: { $ne: true },
          $or: [{ end: { $gte: new Date() } }, { end: undefined }],
          isPublic: { $ne: true },
          isDeleted: { $ne: true },
        },
        {
          sort: { createdAt: -1 },
          projection: {
            title: 1,
            description: 1,
            price: 1,
            inrAmount: 1,
            usdAmount: 1,
            eurAmount: 1,
            recurringType: 1,
            currency: 1,
            iapProductId: 1,
            createdAt: 1,
            iapDescription: 1,
            iapPrice: 1,
          },
        },
      )
      .toArray();

    // Aggregate posts, courses, and subscriptions
    const [allPosts, allCourses, allSubscriptions] = await Promise.all([
      Mongo.post
        .find(
          { creator: new ObjectId(creatorId) },
          { projection: { mangoArr: 1 } },
        )
        .toArray(),
      Mongo.course
        .find(
          { creator: new ObjectId(creatorId), isPublished: true },
          { projection: { mangoArr: 1 } },
        )
        .toArray(),
      demoUser
        ? Mongo.subscription
            .find(
              {
                creator: new ObjectId(creatorId),
                fan: new ObjectId(demoUser._id),
                status: "active",
              },
              { projection: { mango: 1 } },
            )
            .toArray()
        : Promise.resolve([]),
    ]);

    // Use Set for unique processing and simpler inclusion checks
    const postMangoes = new Set(
      allPosts.flatMap((post) => post.mangoArr.map((mng) => mng.toHexString())),
    );
    const courseMangoes = new Set(
      allCourses.flatMap((course) =>
        course.mangoArr.map((mng) => mng.toHexString()),
      ),
    );
    const subscriptionMangoes = new Set(
      allSubscriptions.map((subscription) => subscription.mango.toHexString()),
    );

    const mangoesToSend = mangoes.map((mango) => ({
      ...mango,
      hasPosts: postMangoes.has(mango._id.toHexString()),
      hasCourses: courseMangoes.has(mango._id.toHexString()),
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

      if (!demoUser)
        return c.json(
          { message: "Demo user not found" },
          {
            status: 404,
            statusText: "Not Found",
          },
        );

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
          fan: new ObjectId(demoUser._id),
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
            },
          },
        );
      } else {
        await Mongo.subscription.updateOne(
          {
            creator: mango.creator,
            fan: new ObjectId(demoUser._id),
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
          fan: new ObjectId(demoUser._id),
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
