import fs from "fs-extra";
import { ObjectId, WithId } from "mongodb";
import path from "path";

import Mongo from "../database";
import { DEFAULT_IOS_DEVELOPER_ACCOUNT_ID } from "../constants";
import { IDeveloperAccountIos, IMetaData } from "../types/database";

/**
 * Two iOS pipelines exist because both Apple developer accounts hit the
 * 1,000 App Group limit. Apps created before 13 Oct 2026 have a
 * group.<bundle>.onesignal App Group and keep it; new apps are created without
 * one (OneSignal then loses badge counts and confirmed delivery only).
 */
export type IosPipeline = "ios-standard" | "ios-app-groups";

export const iosPipelineFor = (appGroupsEnabled: boolean): IosPipeline =>
  appGroupsEnabled ? "ios-app-groups" : "ios-standard";

/**
 * Whether this app's iOS build uses the OneSignal App Group.
 *
 * Every app registered with Apple before this change has an explicit value
 * (backfilled from the developer portal). When it is missing, an app already
 * on App Store Connect predates the change, so it keeps App Groups; only a
 * genuinely new app (first deployment) goes without.
 */
export const resolveAppGroupsEnabled = (
  metadata: Pick<IMetaData, "iosDeploymentDetails">,
  isFirstDeployment: boolean,
): boolean => {
  const flag = metadata.iosDeploymentDetails?.appGroupsEnabled;
  if (typeof flag === "boolean") return flag;
  return !isFirstDeployment;
};

/** Saves the resolved value so later deployments don't have to guess. */
export const saveAppGroupsEnabled = async (
  host: ObjectId,
  metadata: Pick<IMetaData, "iosDeploymentDetails">,
  appGroupsEnabled: boolean,
) => {
  if (metadata.iosDeploymentDetails?.appGroupsEnabled === appGroupsEnabled)
    return;
  // nested $set only, so a concurrent settings save can't be overwritten
  await Mongo.metadata.updateOne(
    { host },
    { $set: { "iosDeploymentDetails.appGroupsEnabled": appGroupsEnabled } },
  );
};

/**
 * The app's iOS developer account. Apps without one get the default account,
 * which is saved on the metadata so the app stays on that account.
 */
export const resolveIosDeveloperAccount = async (
  host: ObjectId,
  metadata: Pick<IMetaData, "iosDeveloperAccount">,
): Promise<WithId<IDeveloperAccountIos> | null> => {
  if (metadata.iosDeveloperAccount) {
    return Mongo.developer_accounts_ios.findOne({
      _id: metadata.iosDeveloperAccount,
    });
  }

  const defaultAccountId = new ObjectId(DEFAULT_IOS_DEVELOPER_ACCOUNT_ID);
  const account = await Mongo.developer_accounts_ios.findOne({
    _id: defaultAccountId,
  });
  if (account) {
    await Mongo.metadata.updateOne(
      { host },
      { $set: { iosDeveloperAccount: defaultAccountId } },
    );
  }
  return account;
};

/**
 * Points the app's OneSignal iOS push setup at this account's APNs key. An
 * APNs key only works for its own team, and deployments only upload one when
 * the OneSignal app has none, so moving an app to another account needs this.
 */
export const setOneSignalApnsKey = async (
  onesignalAppId: string,
  account: WithId<IDeveloperAccountIos>,
  bundleId: string,
): Promise<{ ok: true } | { ok: false; error: unknown }> => {
  const apnsPath = path.resolve(
    `./developer_accounts/ios/${account._id}/apns.p8`,
  );
  if (!(await fs.pathExists(apnsPath))) {
    return { ok: false, error: `APNs key missing at ${apnsPath}` };
  }

  const res = await fetch(`https://api.onesignal.com/apps/${onesignalAppId}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apns_p8: await fs.readFile(apnsPath, "base64"),
      apns_bundle_id: bundleId,
      apns_team_id: account.teamId,
      apns_key_id: account.apnsKeyId,
      apns_env: "production",
    }),
  });
  const data = await res.json();
  if (!data?.id || "errors" in data) return { ok: false, error: data };
  return { ok: true };
};

/**
 * Universal-link entries for the app's apple-app-site-association file: one
 * per iOS developer account, the app's own team first. An app transferred
 * between our accounts has builds signed by both teams on people's phones,
 * and each build only matches the entry with its own team ID. An entry for a
 * team that doesn't own the app is ignored by iOS.
 */
export const iosUniversalLinkDetails = async (
  account: WithId<IDeveloperAccountIos>,
  bundleId: string,
) => {
  const otherTeams = (
    await Mongo.developer_accounts_ios
      .find({ _id: { $ne: account._id } }, { projection: { teamId: 1 } })
      .toArray()
  ).map((a) => a.teamId);
  return [...new Set([account.teamId, ...otherTeams])].map((teamId) => ({
    appID: `${teamId}.${bundleId}`,
    paths: ["NOT /zoom*", "*"],
  }));
};
