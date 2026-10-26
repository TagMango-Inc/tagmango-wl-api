import { z } from "zod";

import { RoutingConfig } from "../../src/types/database";

export const createNewDeploymentSchema = z.object({
  target: z.enum(["android", "ios"]),
  generateIAPScreenshot: z.boolean().optional(),
  // Temporary: deploy this one app at another release (e.g. a 10.0.2 hotfix)
  // without touching data/release.json, which bulk redeploys keep using.
  // branch defaults to v/<versionName>.
  releaseOverride: z
    .object({
      versionName: z.string().regex(/^\d+\.\d+\.\d+$/),
      buildNumber: z.number().int().positive(),
      branch: z.string().regex(/^v\/\d+\.\d+\.\d+[\w.-]*$/).optional(),
    })
    .optional(),
});

export const createBulkReDeploymentSchema = z.object({
  target: z.enum(["android", "ios"]),
  customHostIds: z.array(z.string()),
});

export const patchCustomHostByIdSchema = z.object({
  domain: z.string().optional(),
  logo: z.string().optional(),
  favicon: z.string().optional(),
  logoEmailHeader: z.string().optional(),
  logoInvoiceHeader: z.string().optional(),
  colors: z
    .object({
      PRIMARY: z.string().optional(),
      LAUNCH_BG: z.string().optional(),
      DARKBLUE: z.string().optional(),
    })
    .optional(),
  theme: z.enum(["light", "dark"]).optional(),
  loginScreenTitle: z.string().optional(),
  appName: z.string().optional(),
  emailDomain: z.string().optional(),
  host: z.string().optional(),
  offeringTitle: z.string().optional(),
  offeringTitles: z.string().optional(),
  brandname: z.string().optional(),
  supportAddress: z.string().optional(),
  androidShareLink: z.string().optional(),
  iosShareLink: z.string().optional(),
  androidDeepLinkConfig: z
    .object({
      relation: z.array(z.string()).optional(),
      target: z
        .object({
          namespace: z.string().optional(),
          package_name: z.string().optional(),
          sha256_cert_fingerprints: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  iosDeepLinkConfig: z
    .object({
      applinks: z
        .object({
          apps: z.array(z.string()).optional(),
          details: z.array(
            z.object({
              appID: z.string().optional(),
              paths: z.array(z.string()).optional(),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
  landingPageHost: z.string().optional(),
  maxUserLogin: z.number().optional(),
  isPWAEnabled: z.boolean().optional(),
  gcpConfig: z
    .object({
      clientId: z.string().optional(),
      apiKey: z.string().optional(),
    })
    .optional(),
  onesignalAppId: z.string().optional(),
  customOneSignalApiKey: z.string().optional(),
  enableSupportWidget: z.boolean().optional(),
  supportWidget: z
    .array(
      z.object({
        type: z.enum(["email", "whatsapp", "customScript"]),
        value: z.string(),
      }),
    )
    .optional(),
  routingConfig: z.custom<RoutingConfig>().optional(),
});
