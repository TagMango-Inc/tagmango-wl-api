import { ObjectId, WithId } from "mongodb";

import Mongo from "../../src/database";
import { buildQueueFor } from "../../src/job/config";
import {
  IDeployment,
  IDeveloperAccountAndroid,
  IDeveloperAccountIos,
  Status,
} from "../../src/types/database";
import {
  resolveAppGroupsEnabled,
  resolveIosDeveloperAccount,
  saveAppGroupsEnabled,
} from "../utils/iosDeployment";

type QueueResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; message?: string };

/**
 * Puts an existing deployment (back) on its build queue, built from what is in
 * Mongo now. Used by the restart endpoint and by requeue-pending, which re-adds
 * pending deployments whose jobs Redis lost. jobId is the deployment id, so
 * adding one that is still queued does nothing.
 */
export const queueExistingDeployment = async (
  deployment: WithId<IDeployment>,
  { lifo }: { lifo: boolean },
): Promise<QueueResult> => {
  const deploymentId = deployment._id.toString();

  const customhost = await Mongo.customhost.findOne({ _id: deployment.host });
  const metadata = await Mongo.metadata.findOne({ host: deployment.host });

  if (!customhost) {
    return { ok: false, status: 404, message: "Custom Host not found" };
  }
  if (!metadata) {
    return { ok: false, status: 404, message: "Metadata not found" };
  }

  if (
    deployment.platform === "android" &&
    metadata.androidDeploymentDetails.isDeploymentBlocked
  ) {
    return {
      ok: false,
      status: 400,
      message: metadata.androidDeploymentDetails.deploymentBlockReason,
    };
  } else if (
    deployment.platform === "ios" &&
    metadata.iosDeploymentDetails.isDeploymentBlocked
  ) {
    return {
      ok: false,
      status: 400,
      message: metadata.iosDeploymentDetails.deploymentBlockReason,
    };
  }

  let androidDeveloperAccount: WithId<IDeveloperAccountAndroid> | null = null;
  let iosDeveloperAccount: WithId<IDeveloperAccountIos> | null = null;

  if (deployment.platform === "android" && metadata.androidDeveloperAccount) {
    androidDeveloperAccount = await Mongo.developer_accounts_android.findOne({
      _id: metadata.androidDeveloperAccount,
    });
  } else if (deployment.platform === "ios") {
    iosDeveloperAccount = await resolveIosDeveloperAccount(
      customhost._id,
      metadata,
    );
  }

  if (deployment.platform === "ios" && !iosDeveloperAccount) {
    return {
      ok: false,
      status: 400,
      message: "iOS Developer Account not found",
    };
  }
  // a restart reruns the pipeline the deployment started with; older
  // deployments didn't record it
  let appGroupsEnabled: boolean | undefined;
  if (deployment.platform === "ios") {
    appGroupsEnabled =
      deployment.appGroupsEnabled ??
      resolveAppGroupsEnabled(metadata, deployment.isFirstDeployment);
    await saveAppGroupsEnabled(customhost._id, metadata, appGroupsEnabled);
  }

  // change status of deployment to pending
  await Mongo.deployment.updateOne(
    { _id: new ObjectId(deploymentId) },
    {
      $set: {
        status: Status.PENDING,
        updatedAt: new Date(),
        ...(appGroupsEnabled !== undefined && { appGroupsEnabled }),
      },
    },
  );

  await (await buildQueueFor(deployment.platform)).add(
    `${deploymentId}-${deployment.platform}-${deployment.versionName}`,
    {
      deploymentId,
      hostId: deployment.host.toString(),
      name:
        (deployment.platform === "android"
          ? metadata.androidStoreSettings.title
          : metadata.iosStoreSettings.name) ?? customhost.appName,
      appName: customhost.appName || customhost.brandname,
      bundle:
        deployment.platform === "android"
          ? metadata.androidDeploymentDetails.bundleId
          : metadata.iosDeploymentDetails.bundleId,
      domain: customhost.host,
      color: customhost.colors.PRIMARY,
      bgColor: metadata.backgroundStartColor,
      onesignal_id: customhost.onesignalAppId || "",
      platform: deployment.platform,
      // a restart must rebuild the same version the deployment was
      // created with; the release's base build number has usually been
      // uploaded already, so the store would reject it
      versionName: deployment.versionName,
      buildNumber: deployment.buildNumber,
      appleId: metadata.iosDeploymentDetails.appleId || "",

      androidStoreSettings: metadata.androidStoreSettings,

      iosStoreSettings: metadata.iosStoreSettings,
      iosInfoSettings: metadata.iosInfoSettings,
      iosReviewSettings: metadata.iosReviewSettings,

      generateIAPScreenshot: deployment.generateIAPScreenshot || false,

      androidDeveloperAccount,
      iosDeveloperAccount,
      isFirstDeployment: deployment.isFirstDeployment || false,
      appGroupsEnabled,
    },
    {
      attempts: 0,
      lifo,
      jobId: deploymentId,
    },
  );
  return { ok: true };
};
