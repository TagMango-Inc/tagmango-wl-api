import { WithId } from "mongodb";

import Mongo from "../database";
import { IMetaData, IPlayVersionObservation } from "../types/database";
import { getEnterpriseHosts } from "./enterpriseHostsCache";

/**
 * Shared by the Puppeteer Play Store cron and the google-play-scraper shadow
 * cron, so both check exactly the same apps and their observations can be
 * compared one to one.
 */

/** appreleaseversions.versionName: the version AppZap is pushing to all hosts */
export const getTargetPlayVersion = async (): Promise<string | null> => {
  const releaseDoc = await Mongo.app_release_versions.findOne({});
  return releaseDoc?.versionName || null;
};

/**
 * Non-suspended enterprise hosts that have a Play Store link and a bundle id,
 * and whose Play Store version hasn't yet caught up to the target. When the
 * target is unknown, hosts that have never been scraped.
 */
export const findPlayStoreCandidates = async (
  target: string | null,
): Promise<WithId<IMetaData>[]> => {
  const { activeIds } = await getEnterpriseHosts();
  const hostsWithPlayStoreLink = await Mongo.customhost
    .find(
      {
        _id: { $in: activeIds },
        androidShareLink: { $type: "string", $ne: "" },
      },
      { projection: { _id: 1 } },
    )
    .toArray();

  return Mongo.metadata
    .find({
      host: { $in: hostsWithPlayStoreLink.map((h) => h._id) },
      "androidDeploymentDetails.bundleId": { $type: "string", $ne: "" },
      ...(target
        ? { "androidDeploymentDetails.playStore.versionName": { $ne: target } }
        : {
            $or: [
              {
                "androidDeploymentDetails.playStore.versionName": {
                  $exists: false,
                },
              },
              { "androidDeploymentDetails.playStore.versionName": "" },
            ],
          }),
    })
    .toArray();
};

/**
 * Hosts already on the target, for the shadow's control sample. Sorted by
 * host so the same apps are checked every run.
 */
export const findPlayStoreControls = async (
  target: string,
  limit: number,
): Promise<WithId<IMetaData>[]> => {
  const { activeIds } = await getEnterpriseHosts();
  return Mongo.metadata
    .find({
      host: { $in: activeIds },
      "androidDeploymentDetails.bundleId": { $type: "string", $ne: "" },
      "androidDeploymentDetails.playStore.versionName": target,
    })
    .sort({ host: 1 })
    .limit(limit)
    .toArray();
};

export const newPlayRunId = (source: IPlayVersionObservation["source"]) =>
  `${source}-${new Date().toISOString()}`;

/** Best effort: a failed write must never break a scraper run. */
export const recordPlayObservation = async (
  observation: IPlayVersionObservation,
): Promise<void> => {
  try {
    await Mongo.play_version_observations.insertOne(observation);
  } catch (error) {
    console.error(
      "Failed to record Play Store observation:",
      (error as Error).message,
    );
  }
};
