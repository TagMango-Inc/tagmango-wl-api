import crypto from "crypto";
import fs from "fs-extra";
import path from "path";

import { IDeveloperAccountIos } from "../types/database";

/**
 * Environment that makes the iOS lanes sign in with the account's App Store
 * Connect API key (fastlane's app_store_connect_api_key reads these names).
 * match and deliver then never need the Apple ID session, which expires and
 * failed 19 iOS deploys between 9 and 12 Oct 2026. Empty when the account has
 * no key, or WL_DISABLE_ASC_API_KEY=1 is set on the worker, so the lanes fall
 * back to the Apple ID.
 */
export const ascApiKeyEnv = (
  account: Pick<IDeveloperAccountIos, "ascApiKeyId" | "ascApiKeyIssuer"> | null | undefined,
  privateKeyBase64: string | null,
): Record<string, string> =>
  process.env.WL_DISABLE_ASC_API_KEY !== "1" &&
  account?.ascApiKeyId &&
  account?.ascApiKeyIssuer &&
  privateKeyBase64
    ? {
        APP_STORE_CONNECT_API_KEY_KEY_ID: account.ascApiKeyId,
        APP_STORE_CONNECT_API_KEY_ISSUER_ID: account.ascApiKeyIssuer,
        APP_STORE_CONNECT_API_KEY_KEY: privateKeyBase64,
        APP_STORE_CONNECT_API_KEY_IS_KEY_CONTENT_BASE64: "true",
      }
    : {};

// App privacy details can only be uploaded with the Apple ID. They belong to
// the app rather than a version, so the upload lane skips them
// (WL_SKIP_APP_PRIVACY=1) once the app has the current file. The lane writes
// the marker after an upload goes through, and only then is the hash saved.

export const APP_PRIVACY_HASH_FIELD = "iosDeploymentDetails.uploadedAppPrivacyHash";

export const appPrivacyMarker = (workspace: string) =>
  path.join(workspace, "fastlane/.app_privacy_uploaded");

/** sha256 of the workspace's app_privacy_details.json, null when missing */
export const hashAppPrivacy = async (workspace: string) => {
  const file = path.join(workspace, "fastlane/app_privacy_details.json");
  if (!(await fs.pathExists(file))) return null;
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
};
