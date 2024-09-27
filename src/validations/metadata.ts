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
  customOneSignalIcon: z.string().optional(),
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
const updateAndroidDeploymentAccountSchema = z.object({
  developerAccountId: z.string(),
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
const reorderIosScreenshotsSchema = z.object({
  screenshots: z.array(z.string()),
  type: z.enum(["iphone_55", "iphone_65", "iphone_67"]),
});
const deleteIosScreenshotsSchema = z.object({
  screenshots: z.array(z.string()),
  type: z.enum(["iphone_55", "iphone_65", "iphone_67"]),
});

export {
  deleteAndroidScreenshotsSchema,
  deleteIosScreenshotsSchema,
  reorderAndroidScreenshotsSchema,
  reorderIosScreenshotsSchema,
  updateAndroidDeploymentAccountSchema,
  updateAndroidDeploymentDetailsSchema,
  updateAndroidStoreMetadataSchema,
  updateIosDeploymentDetailsSchema,
  updateIosInfoMetadataSchema,
  updateIosReviewMetadataSchema,
  updateIosStoreMetadataSchema,
  updateMetadataLogoSchema,
};
