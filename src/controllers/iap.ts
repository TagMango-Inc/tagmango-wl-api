import { createFactory } from "hono/factory";
import mongoose from "mongoose";
import MangoModel from "src/models/mango.model";
import {
  patchIapProductIdsSchema,
  patchMangoIapDetailsSchema,
} from "src/validations/iap";

import { zValidator } from "@hono/zod-validator";

const factory = createFactory();

/**
 * /iap/mangoes-by-creator/:creatorId
 * GET
 * Get all mangoes by creator
 */
const getAllMangoesByCreator = factory.createHandlers(async (c) => {
  const { creatorId } = c.req.param();

  if (!creatorId)
    return c.json(
      { message: "Creator ID is required" },
      {
        status: 400,
        statusText: "Bad Request",
      },
    );
  try {
    const mangoes = await MangoModel.find({
      creator: new mongoose.Types.ObjectId(creatorId),
      isHidden: { $ne: true },
      isStopTakingPayment: { $ne: true },
      $or: [{ end: { $gte: new Date() } }, { end: null }],
      isPublic: { $ne: true },
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .select(
        "title description price inrAmount usdAmount eurAmount recurringType currency iapProductId createdAt iapDescription iapPrice",
      );
    return c.json(
      {
        message: "Mangoes fetched successfully",
        result: mangoes,
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
      const { mangoIds, action } = c.req.valid("json");
      const result: any = {};
      if (action === "unassign") {
        await MangoModel.updateMany(
          {
            _id: {
              $in: mangoIds.map((mng) => new mongoose.Types.ObjectId(mng)),
            },
          },
          { $unset: { iapProductId: 1, iapDescription: 1, iapPrice: 1 } },
        );
      } else {
        const mangoes = await MangoModel.find({
          _id: { $in: mangoIds.map((mng) => new mongoose.Types.ObjectId(mng)) },
        });
        const promises = mangoes.map((mng) => {
          const newObjectId = new mongoose.Types.ObjectId().toString();
          mng.iapProductId = newObjectId;
          result[mng.id] = newObjectId;
          return mng.save();
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
      const mango = await MangoModel.findById(mangoId);
      if (!mango)
        return c.json(
          { message: "Mango not found" },
          {
            status: 404,
            statusText: "Not Found",
          },
        );

      mango.iapDescription = iapDescription;
      mango.iapPrice = iapPrice;
      await mango.save();

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

export { getAllMangoesByCreator, updateIapProductIds, updateMangoIapDetails };
