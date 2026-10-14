import { Collection, MongoServerError, ObjectId, WithId } from "mongodb";

import Mongo from "../database";
import {
  ICustomHost,
  IDeveloperAccountIos,
  IIosReviewApp,
  IIosReviewRun,
  IMetaData,
  IosReviewAppStatus,
  IosReviewRunType,
} from "../types/database";
import {
  AppStoreConnectClient,
  AscApiError,
  AscResource,
} from "./appStoreConnect";

/**
 * Bulk "Submit for Review" for iOS redeployments, ported from the
 * submit_ios.py script in the "iOS Bulk Submit for Review" KT doc.
 *
 * Per app: find the version in Prepare for Submission (or already in a draft
 * as Ready for Review), attach the latest valid build for that version,
 * switch release to "Automatically release this version", create/reuse the
 * review draft, add the version and submit. Only redeployments (an older
 * version live) are submitted; everything else gets a status saying why.
 * Re-running is safe: drafts are reused and open submissions are skipped.
 */

const LIVE_STATES = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"]);
// READY_FOR_REVIEW = the version already sits in an unsubmitted draft
const DRAFT_STATES = new Set(["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW"]);
const OPEN_SUBMISSION_STATES = "WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES";
const BUILD_FIELDS = "version,processingState,expired,usesNonExemptEncryption";

/** apps checked against App Store Connect in parallel */
const CONCURRENCY = 6;
const HEARTBEAT_INTERVAL_MS = 30_000;
/** a processing run without a heartbeat for this long is treated as dead */
const HEARTBEAT_STALE_MS = 2 * 60_000;

type AscApp = AscResource<{ name: string; bundleId: string }>;
type AscVersion = AscResource<{
  versionString: string;
  appStoreState?: string;
  appVersionState?: string;
  releaseType?: string;
}>;
type AscBuild = AscResource<{
  version: string;
  processingState: string;
  expired?: boolean;
  usesNonExemptEncryption?: boolean | null;
}>;

interface HostInfo {
  host: ObjectId;
  hostName: string;
  blockedReason: string;
}

type AppRow = Omit<
  IIosReviewApp,
  "run" | "runType" | "developerAccount" | "createdAt"
>;

const versionState = (v: AscVersion) =>
  v.attributes.appVersionState || v.attributes.appStoreState || "";

/** apps of the account that currently have an iOS version in a draft state */
const listCandidateApps = async (
  client: AppStoreConnectClient,
): Promise<AscApp[]> => {
  const params: Record<string, string | number> = {
    limit: 200,
    "fields[apps]": "name,bundleId",
    "filter[appStoreVersions.appStoreState]": [...DRAFT_STATES].join(","),
    "filter[appStoreVersions.platform]": "IOS",
  };
  try {
    return await client.getAll<AscApp["attributes"]>("/v1/apps", params);
  } catch (error) {
    if (!(error instanceof AscApiError)) throw error;
    // filter rejected: fall back to every app, the per-app check filters
    return client.getAll<AscApp["attributes"]>("/v1/apps", {
      limit: 200,
      "fields[apps]": "name,bundleId",
    });
  }
};

/**
 * our host for each App Store Connect app id, plus why it may not be submitted.
 * Collections are injectable so the dry-run script can use its own read-only
 * connection.
 */
const loadHostInfo = async (
  appleIds: string[],
  collections: {
    metadata: Collection<IMetaData>;
    customhost: Collection<ICustomHost>;
  } = { metadata: Mongo.metadata, customhost: Mongo.customhost },
) => {
  const metadatas = await collections.metadata
    .find(
      { "iosDeploymentDetails.appleId": { $in: appleIds } },
      {
        projection: {
          host: 1,
          "iosDeploymentDetails.appleId": 1,
          "iosDeploymentDetails.isDeploymentBlocked": 1,
          "iosDeploymentDetails.deploymentBlockReason": 1,
        },
      },
    )
    .toArray();
  const hosts = await collections.customhost
    .find(
      { _id: { $in: metadatas.map((m) => m.host) } },
      {
        projection: { appName: 1, brandname: 1, host: 1, platformSuspended: 1 },
      },
    )
    .toArray();
  const hostById = new Map(hosts.map((h) => [h._id.toHexString(), h]));

  const info = new Map<string, HostInfo>();
  for (const m of metadatas) {
    const host = hostById.get(m.host.toHexString());
    if (!host) continue;
    let blockedReason = "";
    if (host.platformSuspended) blockedReason = "host is platform-suspended";
    else if (m.iosDeploymentDetails?.isDeploymentBlocked) {
      blockedReason = `iOS deployment blocked: ${
        m.iosDeploymentDetails.deploymentBlockReason || "no reason given"
      }`;
    }
    info.set(m.iosDeploymentDetails.appleId, {
      host: host._id,
      hostName: host.appName || host.brandname || host.host || "",
      blockedReason,
    });
  }
  return info;
};

/**
 * Checks one app and, when `submit` is set and it is eligible, submits it.
 * Mirrors process() of submit_ios.py.
 */
const processApp = async (
  client: AppStoreConnectClient,
  app: AscApp,
  hostInfo: HostInfo | undefined,
  submit: boolean,
): Promise<AppRow> => {
  const appleId = app.id;
  const row: AppRow = {
    appleId,
    bundleId: app.attributes.bundleId,
    appName: app.attributes.name,
    host: hostInfo?.host ?? null,
    hostName: hostInfo?.hostName ?? "",
    liveVersion: "",
    draftVersion: "",
    build: "",
    releaseType: "",
    status: IosReviewAppStatus.ELIGIBLE,
    note: "",
  };
  const done = (status: IosReviewAppStatus, note = "") => ({
    ...row,
    status,
    note: row.note + note,
  });

  const versions = await client.getAll<AscVersion["attributes"]>(
    `/v1/apps/${appleId}/appStoreVersions`,
    {
      "filter[platform]": "IOS",
      limit: 50,
      "fields[appStoreVersions]":
        "versionString,appStoreState,appVersionState,releaseType,createdDate",
    },
  );
  const drafts = versions.filter((v) => DRAFT_STATES.has(versionState(v)));
  const lives = versions.filter((v) => LIVE_STATES.has(versionState(v)));
  if (lives.length) row.liveVersion = lives[0].attributes.versionString;
  if (!drafts.length) {
    return done(
      IosReviewAppStatus.NO_DRAFT,
      "no version in Prepare for Submission / Ready for Review",
    );
  }

  const draft = drafts[0];
  const versionId = draft.id;
  const versionString = draft.attributes.versionString;
  row.draftVersion = versionString;
  row.releaseType = draft.attributes.releaseType || "";

  if (!lives.length) {
    return done(
      IosReviewAppStatus.NEW_DEPLOYMENT,
      "no live version: first deployment, do it manually (in-app purchases etc.)",
    );
  }
  if (!hostInfo) {
    return done(
      IosReviewAppStatus.NOT_IN_DASHBOARD,
      "no app in the dashboard has this App Store Connect id",
    );
  }
  if (hostInfo.blockedReason) {
    return done(IosReviewAppStatus.BLOCKED, hostInfo.blockedReason);
  }

  // already sitting in a submission that is waiting / in review / rejected?
  const openSubmissions = await client.getAll("/v1/reviewSubmissions", {
    "filter[app]": appleId,
    "filter[platform]": "IOS",
    "filter[state]": OPEN_SUBMISSION_STATES,
  });
  if (openSubmissions.length) {
    const state: string = openSubmissions[0].attributes.state;
    return done(
      state === "UNRESOLVED_ISSUES"
        ? IosReviewAppStatus.REJECTED
        : IosReviewAppStatus.IN_REVIEW,
      `already has a submission in state ${state}`,
    );
  }

  // build: the attached one if valid, else the latest valid one for this version
  const attached = await client.getOne<AscBuild["attributes"]>(
    `/v1/appStoreVersions/${versionId}/build`,
    { "fields[builds]": BUILD_FIELDS },
  );
  let build: AscBuild | null =
    attached &&
    attached.attributes.processingState === "VALID" &&
    !attached.attributes.expired
      ? attached
      : null;
  if (!build) {
    build = await client.getOne<AscBuild["attributes"]>("/v1/builds", {
      "filter[app]": appleId,
      "filter[preReleaseVersion.version]": versionString,
      "filter[preReleaseVersion.platform]": "IOS",
      "filter[processingState]": "VALID",
      "filter[expired]": "false",
      sort: "-uploadedDate",
      limit: 1,
      "fields[builds]": BUILD_FIELDS,
    });
  }
  if (!build) {
    const latest = await client.getOne<AscBuild["attributes"]>("/v1/builds", {
      "filter[app]": appleId,
      "filter[preReleaseVersion.version]": versionString,
      sort: "-uploadedDate",
      limit: 1,
      "fields[builds]": "version,processingState,expired",
    });
    if (!latest) {
      return done(
        IosReviewAppStatus.BUILD_MISSING,
        "no build uploaded for this version",
      );
    }
    const { version, processingState, expired } = latest.attributes;
    row.build = version;
    if (processingState === "PROCESSING") {
      return done(
        IosReviewAppStatus.BUILD_PROCESSING,
        `build ${version} is still processing`,
      );
    }
    return done(
      IosReviewAppStatus.BUILD_INVALID,
      `build ${version} is ${expired ? "EXPIRED" : processingState}`,
    );
  }

  row.build = build.attributes.version;
  if (build.attributes.usesNonExemptEncryption == null) {
    row.note = "export compliance not set on build; ";
  }

  if (!submit) return done(IosReviewAppStatus.ELIGIBLE);

  // 1) attach build
  if (!attached || attached.id !== build.id) {
    await client.request(
      "PATCH",
      `/v1/appStoreVersions/${versionId}/relationships/build`,
      { body: { data: { type: "builds", id: build.id } } },
    );
  }

  // 2) "Automatically release this version"
  if (row.releaseType !== "AFTER_APPROVAL") {
    await client.request("PATCH", `/v1/appStoreVersions/${versionId}`, {
      body: {
        data: {
          type: "appStoreVersions",
          id: versionId,
          attributes: { releaseType: "AFTER_APPROVAL" },
        },
      },
    });
    row.releaseType = `${row.releaseType || "MANUAL"} -> AFTER_APPROVAL`;
  }

  // 3) review draft: reuse an unsubmitted one, else create it
  const draftSubmissions = await client.getAll("/v1/reviewSubmissions", {
    "filter[app]": appleId,
    "filter[platform]": "IOS",
    "filter[state]": "READY_FOR_REVIEW",
  });
  let submissionId = draftSubmissions[0]?.id;
  if (!submissionId) {
    const created = await client.request("POST", "/v1/reviewSubmissions", {
      body: {
        data: {
          type: "reviewSubmissions",
          attributes: { platform: "IOS" },
          relationships: { app: { data: { type: "apps", id: appleId } } },
        },
      },
    });
    submissionId = (created.data as AscResource).id;
  }

  const items = await client.getAll(
    `/v1/reviewSubmissions/${submissionId}/items`,
    { include: "appStoreVersion", limit: 50 },
  );
  const alreadyAdded = items.some(
    (item) => item.relationships?.appStoreVersion?.data?.id === versionId,
  );
  if (!alreadyAdded) {
    await client.request("POST", "/v1/reviewSubmissionItems", {
      body: {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: {
              data: { type: "reviewSubmissions", id: submissionId },
            },
            appStoreVersion: {
              data: { type: "appStoreVersions", id: versionId },
            },
          },
        },
      },
    });
  }

  // 4) Submit for Review
  await client.request("PATCH", `/v1/reviewSubmissions/${submissionId}`, {
    body: {
      data: {
        type: "reviewSubmissions",
        id: submissionId,
        attributes: { submitted: true },
      },
    },
  });

  // reflect it right away; the iOS review status cron keeps it in sync after
  await Mongo.metadata.updateOne(
    { host: hostInfo.host },
    {
      $set: {
        "iosDeploymentDetails.appStore.versionName": versionString,
        "iosDeploymentDetails.appStore.status": "WAITING_FOR_REVIEW",
      },
    },
  );

  return done(IosReviewAppStatus.SUBMITTED);
};

const runPool = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) => {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        await worker(items[next++]);
      }
    },
  );
  await Promise.all(lanes);
};

const executeRun = async (
  runId: ObjectId,
  account: WithId<IDeveloperAccountIos>,
  type: IosReviewRunType,
  appleIds: string[] | undefined,
) => {
  const heartbeat = setInterval(() => {
    Mongo.ios_review_runs
      .updateOne({ _id: runId }, { $set: { heartbeatAt: new Date() } })
      .catch((error) => console.error("ios review heartbeat failed:", error));
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const client = await AppStoreConnectClient.forAccount(account);
    let apps = await listCandidateApps(client);
    const missingRows: AppRow[] = [];

    if (appleIds) {
      // submit only the selected apps; any no longer in a draft state is reported
      const selected = new Set(appleIds);
      apps = apps.filter((app) => selected.has(app.id));
      const found = new Set(apps.map((app) => app.id));
      for (const appleId of appleIds) {
        if (found.has(appleId)) continue;
        const last = await Mongo.ios_review_apps.findOne(
          { developerAccount: account._id, appleId },
          { sort: { createdAt: -1 } },
        );
        missingRows.push({
          appleId,
          bundleId: last?.bundleId ?? "",
          appName: last?.appName ?? appleId,
          host: last?.host ?? null,
          hostName: last?.hostName ?? "",
          liveVersion: last?.liveVersion ?? "",
          draftVersion: "",
          build: "",
          releaseType: "",
          status: IosReviewAppStatus.NO_DRAFT,
          note: "no longer has a version in Prepare for Submission / Ready for Review",
        });
      }
    }

    const hostInfo = await loadHostInfo([
      ...apps.map((app) => app.id),
      ...missingRows.map((r) => r.appleId),
    ]);

    await Mongo.ios_review_runs.updateOne(
      { _id: runId },
      {
        $set: {
          total: apps.length + missingRows.length,
          heartbeatAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    const saveRow = async (row: AppRow) => {
      const now = new Date();
      await Mongo.ios_review_apps.insertOne({
        ...row,
        run: runId,
        runType: type,
        developerAccount: account._id,
        createdAt: now,
      });
      await Mongo.ios_review_runs.updateOne(
        { _id: runId },
        {
          $inc: { processed: 1, [`counts.${row.status}`]: 1 },
          $set: { heartbeatAt: now, updatedAt: now },
        },
      );
    };

    for (const row of missingRows) await saveRow(row);

    await runPool(apps, CONCURRENCY, async (app) => {
      let row: AppRow;
      try {
        row = await processApp(
          client,
          app,
          hostInfo.get(app.id),
          type === "submit",
        );
      } catch (error) {
        const info = hostInfo.get(app.id);
        row = {
          appleId: app.id,
          bundleId: app.attributes.bundleId,
          appName: app.attributes.name,
          host: info?.host ?? null,
          hostName: info?.hostName ?? "",
          liveVersion: "",
          draftVersion: "",
          build: "",
          releaseType: "",
          status: IosReviewAppStatus.ERROR,
          note: String((error as Error)?.message ?? error).slice(0, 400),
        };
      }
      await saveRow(row);
    });

    await Mongo.ios_review_runs.updateOne(
      { _id: runId },
      {
        $set: {
          status: "success",
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
  } catch (error) {
    console.error(`ios review run ${runId} failed:`, error);
    await Mongo.ios_review_runs.updateOne(
      { _id: runId },
      {
        $set: {
          status: "failed",
          error: String((error as Error)?.message ?? error).slice(0, 400),
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
  } finally {
    clearInterval(heartbeat);
  }
};

/** marks runs whose process died (no heartbeat) as failed, freeing the lock */
const failStaleRuns = (developerAccount: ObjectId) =>
  Mongo.ios_review_runs.updateMany(
    {
      developerAccount,
      status: "processing",
      heartbeatAt: { $lt: new Date(Date.now() - HEARTBEAT_STALE_MS) },
    },
    {
      $set: {
        status: "failed",
        error: "interrupted (the server restarted mid-run); safe to run again",
        finishedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );

/**
 * Starts a scan or submit run in the background. Only one run per developer
 * account at a time (enforced by a unique partial index, so it holds across
 * API instances): returns the running one instead when there is one.
 */
const startIosReviewRun = async ({
  account,
  type,
  userId,
  appleIds,
}: {
  account: WithId<IDeveloperAccountIos>;
  type: IosReviewRunType;
  userId: ObjectId;
  appleIds?: string[];
}): Promise<
  | { started: true; runId: ObjectId }
  | { started: false; running: WithId<IIosReviewRun> | null }
> => {
  await failStaleRuns(account._id);

  const now = new Date();
  const run: IIosReviewRun = {
    developerAccount: account._id,
    type,
    status: "processing",
    user: userId,
    ...(appleIds && { appleIds }),
    total: 0,
    processed: 0,
    counts: {},
    heartbeatAt: now,
    createdAt: now,
    updatedAt: now,
  };

  let runId: ObjectId;
  try {
    runId = (await Mongo.ios_review_runs.insertOne(run)).insertedId;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const running = await Mongo.ios_review_runs.findOne({
        developerAccount: account._id,
        status: "processing",
      });
      return { started: false, running };
    }
    throw error;
  }

  void executeRun(runId, account, type, appleIds);
  return { started: true, runId };
};

export {
  failStaleRuns,
  listCandidateApps,
  loadHostInfo,
  processApp,
  startIosReviewRun,
};
