import fs from "fs-extra";
import jwt from "jsonwebtoken";
import { WithId } from "mongodb";
import path from "path";

import { IDeveloperAccountIos } from "../types/database";

const API = "https://api.appstoreconnect.apple.com/v1";

export type AscBundleId = { id: string; identifier: string };

/**
 * App Store Connect API calls as one developer account, using its key in
 * developer_accounts/ios/<id>/asc_api_pk.p8.
 */
export const ascClient = async (account: WithId<IDeveloperAccountIos>) => {
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

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(url.startsWith("http") ? url : `${API}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : null };
  };

  const fail = (what: string, r: { status: number; json: any }) =>
    new Error(
      `${account.name}: ${what} failed (${r.status}) ${r.json?.errors?.[0]?.detail ?? ""}`.trim(),
    );

  return {
    /** the bundle ID with exactly this identifier on this team, or null */
    async findBundleId(identifier: string): Promise<AscBundleId | null> {
      // filter[identifier] also matches longer identifiers, so compare exactly
      const r = await call(
        "GET",
        `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&fields[bundleIds]=identifier&limit=200`,
      );
      if (!r.ok) throw fail(`looking up ${identifier}`, r);
      const match = (r.json.data as any[]).find((b) => b.attributes.identifier === identifier);
      return match ? { id: match.id, identifier } : null;
    },

    async deleteBundleId(bundle: AscBundleId) {
      const r = await call("DELETE", `/bundleIds/${bundle.id}`);
      if (!r.ok && r.status !== 404) throw fail(`deleting ${bundle.identifier}`, r);
    },

    async createBundleId(identifier: string, name: string): Promise<AscBundleId> {
      const r = await call("POST", "/bundleIds", {
        data: { type: "bundleIds", attributes: { identifier, name, platform: "IOS" } },
      });
      if (!r.ok) throw fail(`registering ${identifier}`, r);
      return { id: r.json.data.id, identifier };
    },

    /** turns on the capabilities the bundle ID doesn't have yet */
    async enableCapabilities(bundle: AscBundleId, capabilities: string[]) {
      const r = await call("GET", `/bundleIds/${bundle.id}/bundleIdCapabilities?limit=200`);
      if (!r.ok) throw fail(`reading capabilities of ${bundle.identifier}`, r);
      const have = new Set((r.json.data as any[]).map((c) => c.attributes.capabilityType));
      for (const capabilityType of capabilities.filter((c) => !have.has(c))) {
        const add = await call("POST", "/bundleIdCapabilities", {
          data: {
            type: "bundleIdCapabilities",
            attributes: { capabilityType },
            relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
          },
        });
        if (!add.ok) throw fail(`turning on ${capabilityType} for ${bundle.identifier}`, add);
      }
    },

    /** whether this team can see the App Store Connect app with this Apple ID */
    async hasApp(appleId: string) {
      const r = await call("GET", `/apps/${encodeURIComponent(appleId)}?fields[apps]=bundleId`);
      if (r.status === 404 || r.status === 403) return false;
      if (!r.ok) throw fail(`looking up app ${appleId}`, r);
      return true;
    },
  };
};
