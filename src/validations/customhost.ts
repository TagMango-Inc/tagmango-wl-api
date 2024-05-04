import { z } from "zod";

export const createNewDeploymentSchema = z.object({
  target: z.enum(["android", "ios"]),
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
      relation: z.array(z.string()).optional(),
      target: z
        .object({
          namespace: z.string().optional(),
          host: z.string().optional(),
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
});
