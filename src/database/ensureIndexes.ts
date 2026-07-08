import { Db } from "mongodb";

import { Collections } from "../types/database";

/**
 * Idempotent index creation for collections OWNED by this service.
 * Shared collections (customhosts, users, mangos, appforms, adminusers) are
 * owned by the main TagMango app — indexes for those are proposed in
 * PROPOSED_SHARED_INDEXES and must be created by the owning app.
 */
const OWNED_INDEXES: {
  collection: string;
  keys: Record<string, 1 | -1>;
  name: string;
}[] = [
  // wldeployments: per-app lists filter by host and sort by updatedAt
  {
    collection: Collections.DEPLOYMENT,
    keys: { host: 1, updatedAt: -1 },
    name: "host_1_updatedAt_-1",
  },
  // global deployments list + recent-deployments sort
  {
    collection: Collections.DEPLOYMENT,
    keys: { updatedAt: -1 },
    name: "updatedAt_-1",
  },
  // filtered global list (platform/status) with same sort
  {
    collection: Collections.DEPLOYMENT,
    keys: { status: 1, platform: 1, updatedAt: -1 },
    name: "status_1_platform_1_updatedAt_-1",
  },
  // latest-redeployment-details findOne sorted by createdAt
  {
    collection: Collections.REDEPLOYMENT,
    keys: { createdAt: -1 },
    name: "createdAt_-1",
  },
  // deployment-requests list sort
  {
    collection: Collections.APP_DEPLOYMENT_REQUESTS,
    keys: { createdAt: -1 },
    name: "createdAt_-1",
  },
];

// For visibility in logs only — created by the main app, not here.
const PROPOSED_SHARED_INDEXES = [
  "customhosts { whitelableStatus: 1, updatedAt: -1 }",
  "customhosts { updatedAt: -1 }",
  "mangos { creator: 1 }",
];

const ensureIndexes = async (db: Db): Promise<void> => {
  for (const { collection, keys, name } of OWNED_INDEXES) {
    try {
      await db.collection(collection).createIndex(keys, { name, background: true });
    } catch (error) {
      // createIndex is idempotent for identical specs; a conflict means an
      // index with the same name but different keys exists — surface it.
      console.error(`ensureIndexes: failed on ${collection}.${name}:`, error);
    }
  }
  console.log(
    `ensureIndexes: verified ${OWNED_INDEXES.length} owned indexes. ` +
      `Proposed for main app (not auto-created): ${PROPOSED_SHARED_INDEXES.join("; ")}`,
  );
};

export default ensureIndexes;
