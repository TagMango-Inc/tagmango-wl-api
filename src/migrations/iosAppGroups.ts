/**
 * One-off: record which apps use the OneSignal App Group and put every app on
 * the iOS developer account that owns its bundle ID.
 *
 * Apple is the source of truth:
 *  - bundle IDs per team come from the App Store Connect API (keys in
 *    developer_accounts/ios/<id>/asc_api_pk.p8);
 *  - App Groups per team are not in that API, so they come from the
 *    developer portal: open Identifiers → App Groups for each team, copy the
 *    listApplicationGroups.action response from the browser's network tab and
 *    save it as JSON.
 *
 * For every customhostmetadatas record:
 *  - bundle ID registered on a team → iosDeveloperAccount = that team's
 *    account; appGroupsEnabled = group.<bundle>.onesignal exists on that team
 *  - not registered anywhere (or no bundle ID) and no App Store ID →
 *    appGroupsEnabled stays unset (decided at first deploy) and
 *    iosDeveloperAccount = --unregistered-to, the account new apps go to
 * Every record whose account changes gets its OneSignal push key moved to the
 * new account (only when OneSignal already has one; otherwise the next
 * deployment uploads the right one).
 *
 * usage:
 *   npx tsx src/migrations/iosAppGroups.ts \
 *     --groups Z9M2DKF2B7=/path/dev-1.json --groups Y7434GT8NQ=/path/dev-2.json \
 *     --unregistered-to 68cbf2a78913609eedb102de [--apply]
 * Without --apply nothing is written. With --apply the previous values are
 * saved to migration-backups/ios-app-groups-<timestamp>.json first.
 */
import "dotenv/config";

import fs from "fs-extra";
import jwt from "jsonwebtoken";
import { AnyBulkWriteOperation, ObjectId, WithId } from "mongodb";
import path from "path";

import Mongo from "../database";
import { IDeveloperAccountIos, IMetaData } from "../types/database";
import { setOneSignalApnsKey } from "../utils/iosDeployment";

const NSE = ".OneSignalNotificationServiceExtension";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const groups: Record<string, string> = {};
  let unregisteredTo = "";
  args.forEach((arg, i) => {
    if (arg === "--groups") {
      const [teamId, file] = (args[i + 1] ?? "").split("=");
      if (!teamId || !file) throw new Error("--groups expects TEAMID=file.json");
      groups[teamId] = file;
    }
    if (arg === "--unregistered-to") unregisteredTo = args[i + 1] ?? "";
  });
  if (!/^[a-f0-9]{24}$/.test(unregisteredTo))
    throw new Error("--unregistered-to expects an iosdeveloperaccounts _id");
  return { groups, unregisteredTo, apply: args.includes("--apply") };
};

const ascBundleIds = async (account: WithId<IDeveloperAccountIos>) => {
  const privateKey = await fs.readFile(
    path.resolve(`./developer_accounts/ios/${account._id}/asc_api_pk.p8`),
    "utf-8",
  );
  const token = () =>
    jwt.sign({}, privateKey, {
      algorithm: "ES256",
      expiresIn: "10m",
      issuer: account.ascApiKeyIssuer,
      audience: "appstoreconnect-v1",
      keyid: account.ascApiKeyId,
    });

  const ids = new Set<string>();
  let url: string | undefined =
    "https://api.appstoreconnect.apple.com/v1/bundleIds?limit=200&fields[bundleIds]=identifier";
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new Error(`${account.name}: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: { attributes: { identifier: string } }[];
      links?: { next?: string };
    };
    body.data.forEach((b) => ids.add(b.attributes.identifier));
    url = body.links?.next;
  }
  return ids;
};

const portalGroups = async (file: string, teamId: string) => {
  const body = JSON.parse(await fs.readFile(file, "utf-8")) as {
    totalRecords?: number;
    applicationGroupList?: { identifier: string; prefix: string }[];
  };
  const list = body.applicationGroupList ?? [];
  if (!list.length) throw new Error(`${file}: no applicationGroupList`);
  if (list.some((g) => g.prefix !== teamId))
    throw new Error(`${file}: groups belong to another team than ${teamId}`);
  if (body.totalRecords !== undefined && body.totalRecords !== list.length)
    throw new Error(`${file}: has ${list.length} of ${body.totalRecords} groups; export with a bigger pageSize`);
  return new Set(list.map((g) => g.identifier));
};

const run = async () => {
  const { groups: groupFiles, unregisteredTo, apply } = parseArgs();
  const accounts = await Mongo.developer_accounts_ios.find({}).toArray();
  const newAppsAccount = accounts.find((a) => a._id.toString() === unregisteredTo);
  if (!newAppsAccount) throw new Error(`--unregistered-to ${unregisteredTo}: no such account`);

  const teams = await Promise.all(
    accounts.map(async (account) => {
      const file = groupFiles[account.teamId];
      if (!file) throw new Error(`missing --groups ${account.teamId}=<file> (${account.name})`);
      return {
        account,
        bundleIds: await ascBundleIds(account),
        groups: await portalGroups(file, account.teamId),
      };
    }),
  );
  teams.forEach((t) =>
    console.log(`${t.account.name}: ${t.bundleIds.size} bundle IDs, ${t.groups.size} App Groups`),
  );

  const ownerOf = (bundleId: string) =>
    teams.filter((t) => t.bundleIds.has(bundleId));
  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const ops: AnyBulkWriteOperation<IMetaData>[] = [];
  const backup: unknown[] = [];
  const accountMoves: { host: ObjectId; bundleId: string; to: WithId<IDeveloperAccountIos> }[] = [];
  const needsManualFix: string[] = [];

  const moveUnregistered = (
    m: { host: ObjectId },
    bundleId: string | undefined,
    appleId: string | undefined,
    currentAccount: string | null,
    $set: Record<string, unknown>,
    reason: string,
  ) => {
    // an App Store ID means the app exists somewhere we can't see; leave it
    if (appleId || currentAccount === newAppsAccount._id.toString()) return;
    $set.iosDeveloperAccount = newAppsAccount._id;
    count(`account → ${newAppsAccount.name} (${reason})`);
    if (bundleId) accountMoves.push({ host: m.host, bundleId, to: newAppsAccount });
  };

  const metadatas = await Mongo.metadata
    .find(
      {},
      {
        projection: {
          host: 1,
          iosDeveloperAccount: 1,
          "iosDeploymentDetails.bundleId": 1,
          "iosDeploymentDetails.appleId": 1,
          "iosDeploymentDetails.appGroupsEnabled": 1,
        },
      },
    )
    .toArray();

  for (const m of metadatas) {
    const bundleId = m.iosDeploymentDetails?.bundleId;
    const appleId = m.iosDeploymentDetails?.appleId;
    const currentAccount = m.iosDeveloperAccount?.toString() ?? null;
    const $set: Record<string, unknown> = {};

    if (!bundleId) {
      count("no bundle ID");
      moveUnregistered(m, bundleId, appleId, currentAccount, $set, "no bundle ID");
    } else {
      const owners = ownerOf(bundleId);
      if (owners.length > 1) {
        count("registered on more than one team (skipped)");
        needsManualFix.push(`${bundleId}: registered on ${owners.map((o) => o.account.name).join(" and ")}`);
        continue;
      }
      const owner = owners[0];
      if (!owner) {
        count("not registered with Apple");
        moveUnregistered(m, bundleId, appleId, currentAccount, $set, "not registered");
      } else {
        count("registered");
        const hasGroup = owner.groups.has(`group.${bundleId}.onesignal`);
        count(hasGroup ? "appGroupsEnabled: true" : "appGroupsEnabled: false");
        if (m.iosDeploymentDetails?.appGroupsEnabled !== hasGroup)
          $set["iosDeploymentDetails.appGroupsEnabled"] = hasGroup;

        if (currentAccount !== owner.account._id.toString()) {
          $set.iosDeveloperAccount = owner.account._id;
          count(currentAccount ? "account fixed (wrong team)" : "account set (was unset)");
          accountMoves.push({ host: m.host, bundleId, to: owner.account });
        } else {
          count("account already correct");
        }

        const other = teams.find((t) => t !== owner);
        if (other?.bundleIds.has(bundleId + NSE) && !owner.bundleIds.has(bundleId + NSE)) {
          needsManualFix.push(
            `${bundleId}: notification extension is registered on ${other.account.name}, app on ${owner.account.name}`,
          );
        }
      }
    }

    if (Object.keys($set).length) {
      backup.push({
        _id: m._id,
        host: m.host,
        iosDeveloperAccount: m.iosDeveloperAccount ?? null,
        appGroupsEnabled: m.iosDeploymentDetails?.appGroupsEnabled ?? null,
      });
      ops.push({
        updateOne: {
          filter: { _id: m._id },
          update: { $set },
        },
      });
    }
  }

  console.log(JSON.stringify({ records: metadatas.length, ...counts }, null, 1));
  console.log(`records to update: ${ops.length}; OneSignal push keys to move: ${accountMoves.length}`);
  if (needsManualFix.length) {
    console.log(`needs a manual fix in the developer portal (${needsManualFix.length}):`);
    needsManualFix.forEach((l) => console.log(`  ${l}`));
  }
  if (!apply) {
    console.log("dry run: nothing written (pass --apply)");
    return;
  }

  const backupFile = path.resolve(`./migration-backups/ios-app-groups-${Date.now()}.json`);
  await fs.outputJson(backupFile, backup, { spaces: 1 });
  console.log(`saved ${backup.length} previous values to ${backupFile}`);
  if (ops.length) {
    const res = await Mongo.metadata.bulkWrite(ops, { ordered: false });
    console.log(`updated ${res.modifiedCount} records`);
  }

  const customhosts = await Mongo.customhost
    .find(
      { _id: { $in: accountMoves.map((a) => a.host) } },
      { projection: { onesignalAppId: 1 } },
    )
    .toArray();
  const onesignalByHost = new Map(customhosts.map((c) => [c._id.toString(), c.onesignalAppId]));
  const failed: string[] = [];
  let moved = 0;
  for (const move of accountMoves) {
    const onesignalAppId = onesignalByHost.get(move.host.toString());
    if (!onesignalAppId) continue;
    const res = await fetch(`https://api.onesignal.com/apps/${onesignalAppId}`, {
      headers: { Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}` },
    });
    const app = await res.json();
    // no key yet: the next deployment uploads the right one
    if (!app?.apns_p8 || app.apns_team_id === move.to.teamId) continue;
    const result = await setOneSignalApnsKey(onesignalAppId, move.to, move.bundleId);
    if (result.ok) moved++;
    else failed.push(`${move.bundleId} (${onesignalAppId}): ${JSON.stringify(result.error)}`);
  }
  console.log(`OneSignal push keys moved: ${moved}`);
  if (failed.length) {
    console.log(`OneSignal updates that failed (${failed.length}):`);
    failed.forEach((l) => console.log(`  ${l}`));
  }
};

Mongo.connect().then(() =>
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    }),
);
