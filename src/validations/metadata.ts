import { z } from "zod";

const FileSchema = z.instanceof(File);

const createMetadataSchema = z.object({
  appName: z.string(),
});

const updateMetadataLogoSchema = z.object({
  logo: FileSchema,
  icon: FileSchema,
  background: FileSchema,
  foreground: FileSchema,
  backgroundType: z.enum(["color", "gradient"]).optional(),
  backgroundStartColor: z.string().optional(),
  backgroundEndColor: z.string().optional(),
  backgroundAngle: z.string().optional(),
  logoPadding: z.string().optional(),
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

export {
  createMetadataSchema,
  updateAndroidDeploymentDetailsSchema,
  updateIosDeploymentDetailsSchema,
  updateMetadataLogoSchema,
};
