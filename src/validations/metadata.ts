import { z } from "zod";

const FileSchema = z.instanceof(File);

const createMetadataSchema = z.object({
  appName: z.string(),
});

const updateMetadataLogoSchema = z.object({
  logo: z.string(),
  icon: z.string(),
  background: z.string(),
  foreground: z.string(),
  backgroundType: z.enum(["color", "gradient"]).optional(),
  backgroundStartColor: z.string().optional(),
  backgroundEndColor: z.string().optional(),
  backgroundGradientAngle: z.number().optional(),
  logoPadding: z.number().optional(),
});

const updateIosDeploymentDetailsSchema = z.object({
  bundleId: z.string(),
  versionName: z.string(),
  buildNumber: z.number(),
  isUnderReview: z.boolean(),
});
const updateAndroidDeploymentDetailsSchema = z.object({
  bundleId: z.string(),
  versionName: z.string(),
  buildNumber: z.number(),
});

const updateMetadataSettingsSchema = z.object({
  appName: z.string().optional(),
});

export {
  createMetadataSchema,
  updateAndroidDeploymentDetailsSchema,
  updateIosDeploymentDetailsSchema,
  updateMetadataLogoSchema,
  updateMetadataSettingsSchema,
};
