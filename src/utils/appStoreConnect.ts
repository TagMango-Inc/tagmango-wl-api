import fs from "fs-extra";
import jwt from "jsonwebtoken";
import { WithId } from "mongodb";
import path from "path";

import { IDeveloperAccountIos } from "../types/database";

const BASE_URL = "https://api.appstoreconnect.apple.com";
// Apple allows tokens up to 20 minutes
const TOKEN_TTL_SECONDS = 19 * 60;
const MAX_ATTEMPTS = 5;

type Params = Record<string, string | number | boolean>;

export interface AscResource<A = Record<string, any>> {
  type: string;
  id: string;
  attributes: A;
  relationships?: Record<
    string,
    { data?: { type: string; id: string } | null }
  >;
}

interface AscResponse<A = Record<string, any>> {
  data: AscResource<A> | AscResource<A>[] | null;
  links?: { next?: string };
}

export class AscApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    let detail = body.slice(0, 300);
    try {
      const errors: { detail?: string; title?: string }[] =
        JSON.parse(body).errors ?? [];
      const joined = errors
        .map((e) => e.detail || e.title || "")
        .filter(Boolean)
        .join("; ");
      if (joined) detail = joined;
    } catch {
      // not JSON, keep the raw text
    }
    super(`${status}: ${detail}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * App Store Connect API client for one iOS developer account, using the
 * account's team API key (developer_accounts/ios/<id>/asc_api_pk.p8).
 * Retries 429 / 5xx / network failures with a growing backoff.
 */
export class AppStoreConnectClient {
  private token = "";
  private tokenExpiresAt = 0;

  private constructor(
    private account: WithId<IDeveloperAccountIos>,
    private privateKey: string,
  ) {}

  static async forAccount(account: WithId<IDeveloperAccountIos>) {
    const privateKey = await fs.readFile(
      path.resolve(`./developer_accounts/ios/${account._id}/asc_api_pk.p8`),
      "utf-8",
    );
    return new AppStoreConnectClient(account, privateKey);
  }

  private getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now < this.tokenExpiresAt - 60) return this.token;

    this.token = jwt.sign({}, this.privateKey, {
      algorithm: "ES256",
      expiresIn: TOKEN_TTL_SECONDS,
      issuer: this.account.ascApiKeyIssuer,
      audience: "appstoreconnect-v1",
      keyid: this.account.ascApiKeyId,
    });
    this.tokenExpiresAt = now + TOKEN_TTL_SECONDS;
    return this.token;
  }

  async request<A = Record<string, any>>(
    method: "GET" | "POST" | "PATCH",
    pathOrUrl: string,
    options: { params?: Params; body?: unknown } = {},
  ): Promise<AscResponse<A>> {
    const url = new URL(
      pathOrUrl.startsWith("http") ? pathOrUrl : BASE_URL + pathOrUrl,
    );
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, String(value));
    }

    for (let attempt = 1; ; attempt++) {
      let res: globalThis.Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.getToken()}`,
            "Content-Type": "application/json",
          },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS) {
          throw new AscApiError(0, `network failed: ${String(error)}`);
        }
        await sleep(5_000 * attempt);
        continue;
      }

      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : { data: null };

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(10_000 * attempt);
        continue;
      }
      throw new AscApiError(res.status, text);
    }
  }

  /** GET a single resource (or null) */
  async getOne<A = Record<string, any>>(path: string, params?: Params) {
    const { data } = await this.request<A>("GET", path, { params });
    return (Array.isArray(data) ? data[0] : data) ?? null;
  }

  /** GET a collection, following `links.next` across pages */
  async getAll<A = Record<string, any>>(path: string, params?: Params) {
    const out: AscResource<A>[] = [];
    let next: string | undefined = path;
    let nextParams: Params | undefined = params;
    while (next) {
      const page: AscResponse<A> = await this.request<A>("GET", next, {
        params: nextParams,
      });
      if (Array.isArray(page.data)) out.push(...page.data);
      next = page.links?.next;
      // the next link already carries the query string
      nextParams = undefined;
    }
    return out;
  }
}
