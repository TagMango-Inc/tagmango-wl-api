/**
 * Read-only dry run of the iOS bulk "Submit for Review" check, from the
 * command line. Changes nothing in App Store Connect or Mongo: it uses its own
 * Mongo connection (no ensureIndexes) and runs the same per-app check the
 * dashboard runs, with submit off.
 *
 * Run from the API folder (needs .env and developer_accounts/ios/<id>/):
 *   npx tsx scripts/ios-review-dry-run.ts --account <iosDeveloperAccountId>
 *   npx tsx scripts/ios-review-dry-run.ts --account <id> --app "MSME Growth Hub"
 * --app matches the App Store Connect name (substring), bundle id or app id.
 * Without --app it checks every candidate app; --list only lists them.
 */
import "dotenv/config";

import { MongoClient, ObjectId } from "mongodb";

import {
  Collections,
  ICustomHost,
  IDeveloperAccountIos,
  IMetaData,
} from "../src/types/database";
import { AppStoreConnectClient } from "../src/utils/appStoreConnect";
import {
  listCandidateApps,
  loadHostInfo,
  processApp,
} from "../src/utils/iosReview";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const main = async () => {
  const accountId = arg("account");
  const appFilter = arg("app")?.toLowerCase();
  if (!accountId || !ObjectId.isValid(accountId)) {
    console.error("usage: --account <iosDeveloperAccountId> [--app <name>]");
    process.exit(1);
  }

  const mongo = new MongoClient(process.env.MONGO_URI || "");
  await mongo.connect();
  try {
    const db = mongo.db();
    const account = await db
      .collection<IDeveloperAccountIos>(Collections.DEVELOPER_ACCOUNT_IOS)
      .findOne({ _id: new ObjectId(accountId) });
    if (!account)
      throw new Error(`iOS developer account ${accountId} not found`);
    console.log(`Account: ${account.name} (${account.teamName})`);

    const client = await AppStoreConnectClient.forAccount(account);
    let apps = await listCandidateApps(client);
    console.log(
      `${apps.length} app(s) with a version waiting in App Store Connect`,
    );

    if (process.argv.includes("--list")) {
      for (const a of apps) {
        console.log(`${a.id}  ${a.attributes.bundleId}  ${a.attributes.name}`);
      }
      return;
    }

    if (appFilter) {
      apps = apps.filter(
        (a) =>
          a.id === appFilter ||
          a.attributes.bundleId.toLowerCase() === appFilter ||
          a.attributes.name.toLowerCase().includes(appFilter),
      );
      if (apps.length !== 1) {
        console.error(
          `--app matched ${apps.length} apps:`,
          apps.slice(0, 20).map((a) => a.attributes.name),
        );
        process.exit(1);
      }
    }

    const hostInfo = await loadHostInfo(
      apps.map((a) => a.id),
      {
        metadata: db.collection<IMetaData>(Collections.METADATA),
        customhost: db.collection<ICustomHost>(Collections.CUSTOM_HOST),
      },
    );

    const counts: Record<string, number> = {};
    for (const app of apps) {
      let line: string;
      try {
        const row = await processApp(client, app, hostInfo.get(app.id), false);
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        line = [
          row.appName.slice(0, 40).padEnd(40),
          `${row.liveVersion || "-"} -> ${row.draftVersion || "-"}`.padEnd(18),
          `build ${row.build || "-"}`.padEnd(12),
          `release ${row.releaseType || "-"}`.padEnd(24),
          row.status.padEnd(18),
          row.hostName ? `[${row.hostName}]` : "",
          row.note,
        ].join(" ");
      } catch (error) {
        counts.error = (counts.error ?? 0) + 1;
        line = `${app.attributes.name.slice(0, 40).padEnd(40)} error: ${String(error)}`;
      }
      console.log(line);
    }
    console.log("\nSummary:", counts);
  } finally {
    await mongo.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
