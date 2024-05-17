import { z } from "zod";

import {
  IAndroidStoreSettings,
  IIosInfoSettings,
  IIosReviewSettings,
  IIosStoreSettings,
} from "../types/database";

const FileSchema = z.instanceof(File);

const updateMetadataLogoSchema = z.object({
  logo: z.string().optional(),
  icon: z.string(),
  background: z.string(),
  foreground: z.string(),
  backgroundType: z.enum(["color", "gradient"]).optional(),
  backgroundStartColor: z.string().optional(),
  backgroundEndColor: z.string().optional(),
  backgroundGradientAngle: z.number().optional(),
  logoPadding: z.number().optional(),
});

const updateAndroidDeploymentDetailsSchema = z.object({
  bundleId: z.string(),
  versionName: z.string(),
  buildNumber: z.number(),
});
const updateAndroidStoreMetadataSchema = z.custom<IAndroidStoreSettings>();
const reorderAndroidScreenshotsSchema = z.object({
  screenshots: z.array(z.string()),
});
const deleteAndroidScreenshotsSchema = z.object({
  screenshots: z.array(z.string()),
});

const updateIosDeploymentDetailsSchema = z.object({
  bundleId: z.string(),
  versionName: z.string(),
  buildNumber: z.number(),
  isUnderReview: z.boolean(),
});
const updateIosStoreMetadataSchema = z.custom<IIosStoreSettings>();
const updateIosInfoMetadataSchema = z.custom<IIosInfoSettings>();
const updateIosReviewMetadataSchema = z.custom<IIosReviewSettings>();
const updateIosScreenshotsSchema = z.object({
  screenshots: z.array(z.string()),
  type: z.enum(["5.5", "6.5", "6.7"]),
});

export {
  deleteAndroidScreenshotsSchema,
  reorderAndroidScreenshotsSchema,
  updateAndroidDeploymentDetailsSchema,
  updateAndroidStoreMetadataSchema,
  updateIosDeploymentDetailsSchema,
  updateIosInfoMetadataSchema,
  updateIosReviewMetadataSchema,
  updateIosScreenshotsSchema,
  updateIosStoreMetadataSchema,
  updateMetadataLogoSchema,
};
