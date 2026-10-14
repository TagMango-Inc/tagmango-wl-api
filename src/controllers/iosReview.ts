import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId, WithId } from "mongodb";
import path from "path";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../database";
import { JWTPayloadType } from "../types";
import { IIosReviewApp, IosReviewRunType } from "../types/database";
import { failStaleRuns, startIosReviewRun } from "../utils/iosReview";
import { Response } from "../utils/statuscode";
import { submitIosReviewSchema } from "../validations/iosReview";

const factory = createFactory();

const hasAscKey = (accountId: ObjectId) =>
  fs.pathExists(
    path.resolve(`./developer_accounts/ios/${accountId}/asc_api_pk.p8`),
  );

const findAccount = (accountId: string) =>
  ObjectId.isValid(accountId)
    ? Mongo.developer_accounts_ios.findOne({ _id: new ObjectId(accountId) })
    : null;

/**
 * /ios-review/accounts
 * GET
 * iOS developer accounts that bulk review submission can run on
 */
const getIosReviewAccounts = factory.createHandlers(async (c) => {
  try {
    const accounts = await Mongo.developer_accounts_ios
      .find({}, { projection: { name: 1, teamName: 1, teamId: 1 } })
      .toArray();
    const result = await Promise.all(
      accounts.map(async (account) => ({
        ...account,
        hasApiKey: await hasAscKey(account._id),
      })),
    );
    return c.json({ message: "Fetched iOS accounts", result }, Response.OK);
  } catch (error) {
    console.error("Error fetching iOS review accounts:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * /ios-review/:accountId
 * GET
 * The latest scan's apps, with any newer submit result per app laid over it,
 * plus the latest run (to show progress while one is running)
 */
const getIosReviewOverview = factory.createHandlers(async (c) => {
  try {
    const account = await findAccount(c.req.param("accountId"));
    if (!account) {
      return c.json({ message: "Account not found" }, Response.NOT_FOUND);
    }
    await failStaleRuns(account._id);

    const [latestRun, latestScan] = await Promise.all([
      Mongo.ios_review_runs.findOne(
        { developerAccount: account._id },
        { sort: { createdAt: -1 } },
      ),
      Mongo.ios_review_runs.findOne(
        { developerAccount: account._id, type: "scan" },
        { sort: { createdAt: -1 } },
      ),
    ]);

    let apps: WithId<IIosReviewApp>[] = [];
    if (latestScan) {
      const [scanRows, submitRows] = await Promise.all([
        Mongo.ios_review_apps.find({ run: latestScan._id }).toArray(),
        Mongo.ios_review_apps
          .find({
            developerAccount: account._id,
            runType: "submit",
            createdAt: { $gt: latestScan.createdAt },
          })
          .sort({ createdAt: 1 })
          .toArray(),
      ]);
      const byAppleId = new Map(scanRows.map((row) => [row.appleId, row]));
      for (const row of submitRows) byAppleId.set(row.appleId, row);
      apps = [...byAppleId.values()].sort((a, b) =>
        a.appName.localeCompare(b.appName),
      );
    }

    return c.json(
      {
        message: "Fetched iOS review overview",
        result: {
          account: { _id: account._id, name: account.name },
          latestRun,
          latestScan,
          apps,
        },
      },
      Response.OK,
    );
  } catch (error) {
    console.error("Error fetching iOS review overview:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * /ios-review/:accountId/runs
 * GET
 * Recent runs of an account, newest first
 */
const getIosReviewRuns = factory.createHandlers(async (c) => {
  try {
    const { accountId } = c.req.param();
    if (!ObjectId.isValid(accountId)) {
      return c.json({ message: "Invalid account id" }, Response.BAD_REQUEST);
    }
    const runs = await Mongo.ios_review_runs
      .aggregate([
        { $match: { developerAccount: new ObjectId(accountId) } },
        { $sort: { createdAt: -1 } },
        { $limit: 30 },
        {
          $lookup: {
            from: "adminusers",
            localField: "user",
            foreignField: "_id",
            as: "user",
            pipeline: [{ $project: { name: 1, email: 1 } }],
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $project: { appleIds: 0 } },
      ])
      .toArray();
    return c.json({ message: "Fetched runs", result: runs }, Response.OK);
  } catch (error) {
    console.error("Error fetching iOS review runs:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * /ios-review/runs/:runId/apps
 * GET
 * Every app row of one run (for the run log / CSV export)
 */
const getIosReviewRunApps = factory.createHandlers(async (c) => {
  try {
    const { runId } = c.req.param();
    if (!ObjectId.isValid(runId)) {
      return c.json({ message: "Invalid run id" }, Response.BAD_REQUEST);
    }
    const apps = await Mongo.ios_review_apps
      .find({ run: new ObjectId(runId) })
      .sort({ appName: 1 })
      .toArray();
    return c.json({ message: "Fetched run apps", result: apps }, Response.OK);
  } catch (error) {
    console.error("Error fetching iOS review run apps:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const startRun = async (
  accountId: string,
  type: IosReviewRunType,
  userId: string,
  appleIds?: string[],
) => {
  const account = await findAccount(accountId);
  if (!account) {
    return {
      status: Response.NOT_FOUND,
      body: { message: "Account not found" },
    };
  }
  if (!(await hasAscKey(account._id))) {
    return {
      status: Response.BAD_REQUEST,
      body: {
        message: "This account has no App Store Connect API key on the server",
      },
    };
  }

  const started = await startIosReviewRun({
    account,
    type,
    userId: new ObjectId(userId),
    appleIds,
  });
  if (!started.started) {
    return {
      status: Response.CONFLICT,
      body: {
        message: `A ${started.running?.type ?? ""} run is already in progress for this account`,
        result: started.running,
      },
    };
  }
  return {
    status: Response.CREATED,
    body: {
      message: type === "scan" ? "Scan started" : "Submission started",
      result: { runId: started.runId },
    },
  };
};

/**
 * /ios-review/:accountId/scan
 * POST
 * Read-only check of every app with a version waiting to be submitted
 */
const scanIosReview = factory.createHandlers(async (c) => {
  try {
    const payload: JWTPayloadType = c.get("jwtPayload");
    const { status, body } = await startRun(
      c.req.param("accountId"),
      "scan",
      payload.id,
    );
    return c.json(body, status);
  } catch (error) {
    console.error("Error starting iOS review scan:", error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
 * /ios-review/:accountId/submit
 * POST
 * Submits the selected apps for review. Each app is re-checked right before
 * anything is changed, so ones that stopped being eligible are skipped.
 */
const submitIosReview = factory.createHandlers(
  zValidator("json", submitIosReviewSchema),
  async (c) => {
    try {
      const payload: JWTPayloadType = c.get("jwtPayload");
      const { appleIds } = c.req.valid("json");
      const { status, body } = await startRun(
        c.req.param("accountId"),
        "submit",
        payload.id,
        [...new Set(appleIds)],
      );
      return c.json(body, status);
    } catch (error) {
      console.error("Error starting iOS review submission:", error);
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

export {
  getIosReviewAccounts,
  getIosReviewOverview,
  getIosReviewRunApps,
  getIosReviewRuns,
  scanIosReview,
  submitIosReview,
};
