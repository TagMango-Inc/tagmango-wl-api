import { ObjectId } from "mongodb";

import Mongo from "../database";
import { ascClient } from "./appStoreConnect";
import { iosUniversalLinkDetails, setOneSignalApnsKey } from "./iosDeployment";

/**
 * Apple's App Transfer moves an app's App Store record and main bundle ID
 * from TagMango 2 to TagMango, and nothing else. This finishes the move on
 * our side (see the "Transferring an iOS app from TagMango 2 to TagMango"
 * doc). Only that direction is supported.
 */
export const TRANSFER_FROM_TEAM_ID = "Y7434GT8NQ"; // TagMango 2
export const TRANSFER_TO_TEAM_ID = "Z9M2DKF2B7"; // TagMango

const NSE_SUFFIX = ".OneSignalNotificationServiceExtension";
const NSE_CAPABILITIES = ["PUSH_NOTIFICATIONS", "ASSOCIATED_DOMAINS"];
const APP_GROUPS_PORTAL =
  "https://developer.apple.com/account/resources/identifiers/list/applicationGroup";

export type TransferStepKey =
  | "verify"
  | "extension"
  | "account"
  | "push"
  | "universalLinks"
  | "appGroup";

export type TransferStep = {
  key: TransferStepKey;
  title: string;
  status: "done" | "skipped" | "failed" | "notRun" | "manual";
  detail: string;
};

export class TransferRefused extends Error {}

export type TransferResult = {
  ok: boolean;
  steps: TransferStep[];
  /** the App Group to delete by hand on TagMango 2, when the app had one */
  appGroup: { identifier: string; team: string; portalUrl: string } | null;
};

export const transferIosAppToTagMango = async (appId: string): Promise<TransferResult> => {
  const host = new ObjectId(appId);
  const [metadata, customhost, from, to] = await Promise.all([
    Mongo.metadata.findOne(
      { host },
      { projection: { iosDeveloperAccount: 1, iosDeploymentDetails: 1 } },
    ),
    Mongo.customhost.findOne({ _id: host }, { projection: { onesignalAppId: 1 } }),
    Mongo.developer_accounts_ios.findOne({ teamId: TRANSFER_FROM_TEAM_ID }),
    Mongo.developer_accounts_ios.findOne({ teamId: TRANSFER_TO_TEAM_ID }),
  ]);

  if (!metadata || !customhost) throw new TransferRefused("App not found");
  if (!from || !to) throw new TransferRefused("TagMango or TagMango 2 developer account is missing");
  const bundleId = metadata.iosDeploymentDetails?.bundleId;
  const appleId = metadata.iosDeploymentDetails?.appleId;
  if (!bundleId) throw new TransferRefused("The app has no iOS bundle ID");
  if (!appleId) {
    throw new TransferRefused(
      "This app isn't on App Store Connect yet, so there is nothing to transfer. Change its developer account instead.",
    );
  }
  // re-running after a partial transfer finds the app already on TagMango
  const current = metadata.iosDeveloperAccount?.toString();
  if (current !== from._id.toString() && current !== to._id.toString()) {
    throw new TransferRefused(`Only apps on ${from.name} can be transferred to ${to.name}`);
  }
  const running = await Mongo.deployment.findOne(
    { host, platform: "ios", status: { $in: ["pending", "processing"] } },
    { projection: { _id: 1 } },
  );
  if (running) {
    throw new TransferRefused("An iOS deployment for this app is queued or running. Wait for it to finish.");
  }

  // a re-run can't tell any more (the first run turned the flag off), so it
  // keeps showing the reminder; only an app still on TagMango 2 with the flag
  // off is known to have no group
  const hadAppGroup = !(
    current === from._id.toString() && metadata.iosDeploymentDetails?.appGroupsEnabled === false
  );
  const nse = `${bundleId}${NSE_SUFFIX}`;
  const appGroup = `group.${bundleId}.onesignal`;

  const steps: TransferStep[] = [
    { key: "verify", title: `App Store Connect shows the app on ${to.name}`, status: "notRun", detail: "" },
    { key: "extension", title: `Move ${nse} to ${to.name}`, status: "notRun", detail: "" },
    { key: "account", title: `Use ${to.name} for builds, without the App Group`, status: "notRun", detail: "" },
    { key: "push", title: `Point OneSignal at ${to.name}'s push key`, status: "notRun", detail: "" },
    { key: "universalLinks", title: "Universal links accept both teams", status: "notRun", detail: "" },
    { key: "appGroup", title: `Delete ${appGroup} on ${from.name}`, status: "notRun", detail: "" },
  ];
  const step = (key: TransferStepKey) => steps.find((s) => s.key === key)!;

  const run = async (key: TransferStepKey, fn: () => Promise<{ status: "done" | "skipped"; detail: string }>) => {
    try {
      Object.assign(step(key), await fn());
      return true;
    } catch (error) {
      Object.assign(step(key), {
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const [fromAsc, toAsc] = await Promise.all([ascClient(from), ascClient(to)]);

  const ok =
    (await run("verify", async () => {
      const [hasApp, mainBundle] = await Promise.all([toAsc.hasApp(appleId), toAsc.findBundleId(bundleId)]);
      if (!hasApp || !mainBundle) {
        throw new Error(
          `${to.name} can't see the app yet. Accept the transfer in App Store Connect, then try again.`,
        );
      }
      return { status: "done", detail: `App ${appleId} and ${bundleId} are on ${to.name}` };
    })) &&
    (await run("extension", async () => {
      let onTo = await toAsc.findBundleId(nse);
      let status: "done" | "skipped" = "skipped";
      if (!onTo) {
        const onFrom = await fromAsc.findBundleId(nse);
        if (onFrom) await fromAsc.deleteBundleId(onFrom);
        // Apple names may only hold letters, numbers and spaces
        onTo = await toAsc.createBundleId(nse, "OneSignal Notification Service Extension");
        status = "done";
      }
      await toAsc.enableCapabilities(onTo, NSE_CAPABILITIES);
      return {
        status,
        detail:
          status === "done"
            ? `Deleted on ${from.name}, registered on ${to.name} with Push Notifications and Associated Domains`
            : `Already on ${to.name}`,
      };
    })) &&
    (await run("account", async () => {
      const alreadyDone =
        current === to._id.toString() && metadata.iosDeploymentDetails?.appGroupsEnabled === false;
      if (alreadyDone) return { status: "skipped", detail: "Already set" };
      await Mongo.metadata.updateOne(
        { host },
        { $set: { iosDeveloperAccount: to._id, "iosDeploymentDetails.appGroupsEnabled": false } },
      );
      return { status: "done", detail: `Next builds sign and upload with ${to.name}, without the App Group` };
    })) &&
    (await run("push", async () => {
      if (!customhost.onesignalAppId) {
        return { status: "skipped", detail: "No OneSignal app yet; the next deploy uploads the right key" };
      }
      const apns = await setOneSignalApnsKey(customhost.onesignalAppId, to, bundleId);
      if (!apns.ok) {
        throw new Error(`OneSignal refused the key: ${JSON.stringify(apns.error).slice(0, 300)}`);
      }
      return { status: "done", detail: `Team ${to.teamId}, key ${to.apnsKeyId}` };
    })) &&
    (await run("universalLinks", async () => {
      const details = await iosUniversalLinkDetails(to, bundleId);
      await Mongo.customhost.updateOne(
        { _id: host },
        { $set: { iosDeepLinkConfig: { applinks: { apps: [], details } } } },
      );
      return { status: "done", detail: details.map((d) => d.appID).join(", ") };
    }));

  if (ok) {
    Object.assign(
      step("appGroup"),
      hadAppGroup
        ? { status: "manual", detail: "Apple has no API for App Groups. Delete it in the developer portal." }
        : { status: "skipped", detail: "The app has no App Group" },
    );
  }

  console.log(`iOS transfer ${bundleId}: ${steps.map((s) => `${s.key}=${s.status}`).join(" ")}`);
  return {
    ok,
    steps,
    appGroup: ok && hadAppGroup ? { identifier: appGroup, team: `${from.name} (${from.teamId})`, portalUrl: APP_GROUPS_PORTAL } : null,
  };
};
