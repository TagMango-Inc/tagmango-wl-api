import { ObjectId } from "mongodb";

import Mongo from "../database";

/**
 * The forms/redeployment endpoints all need "which customhosts belong to an
 * enterprise-plan creator" — but users.whitelabelPlanType is unindexed, so
 * resolving it live costs a ~1.2s users-$lookup over ~9k hosts per request
 * (this was the dominant cost of GET /forms at ~4.5s).
 *
 * This module resolves the set once and caches it in-process for 10 minutes.
 * Serving stale-while-revalidate: after the TTL the stale set is returned
 * while a single background refresh runs. Plan changes are rare; a ≤10min
 * lag on a new enterprise host appearing in these lists is acceptable.
 */

export interface EnterpriseHosts {
  /** enterprise hosts that are NOT platform-suspended */
  activeIds: ObjectId[];
  /** enterprise hosts that ARE platform-suspended */
  suspendedIds: ObjectId[];
  /** ALL suspended host ids (any plan) — for form-count exclusions */
  allSuspendedIds: ObjectId[];
  fetchedAt: number;
}

const TTL_MS = 10 * 60 * 1000;

let cache: EnterpriseHosts | null = null;
let refreshPromise: Promise<EnterpriseHosts> | null = null;

const build = async (): Promise<EnterpriseHosts> => {
  const [enterpriseRows, allSuspendedRows] = await Promise.all([
    Mongo.customhost
      .aggregate<{ _id: ObjectId; platformSuspended?: boolean }>([
        {
          $lookup: {
            from: "users",
            localField: "creator",
            foreignField: "_id",
            as: "cd",
            pipeline: [
              { $match: { whitelabelPlanType: "enterprise-plan" } },
              { $project: { _id: 1 } },
            ],
          },
        },
        { $match: { "cd.0": { $exists: true } } },
        { $project: { platformSuspended: 1 } },
      ])
      .toArray(),
    Mongo.customhost
      .find({ platformSuspended: true }, { projection: { _id: 1 } })
      .toArray(),
  ]);

  const activeIds: ObjectId[] = [];
  const suspendedIds: ObjectId[] = [];
  for (const row of enterpriseRows) {
    (row.platformSuspended === true ? suspendedIds : activeIds).push(row._id);
  }

  return {
    activeIds,
    suspendedIds,
    allSuspendedIds: allSuspendedRows.map((r) => r._id),
    fetchedAt: Date.now(),
  };
};

export const getEnterpriseHosts = async (): Promise<EnterpriseHosts> => {
  const fresh = cache && Date.now() - cache.fetchedAt < TTL_MS;
  if (cache && fresh) return cache;

  if (!refreshPromise) {
    refreshPromise = build()
      .then((data) => {
        cache = data;
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
    // swallow background-refresh errors; the stale cache keeps serving
    refreshPromise.catch(() => undefined);
  }

  // stale-while-revalidate: serve the old set immediately if we have one
  if (cache) return cache;
  return refreshPromise;
};
