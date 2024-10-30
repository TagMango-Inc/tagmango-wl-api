import { Response } from "express";
import { WithId } from "mongodb";

import {
  IAndroidStoreSettings,
  IDeveloperAccountAndroid,
  IIosInfoSettings,
  IIosReviewSettings,
  IIosScreenshots,
  IIosStoreSettings,
} from "./database";

export type ClientType = {
  id: number;
  response: Response;
};
export type JWTPayloadType = {
  id: string;
  email: string;
  exp: number;
};

export type BuildConfigType = {
  name: string;
  appName: string;
  bundle: string;
  domain: string;
  color: string;
  bgColor: string;
  onesignal_id: string;
  buildNumber: number;
  versionName: string;
  appleId: string;

  androidStoreSettings: IAndroidStoreSettings;
  androidScreenshots: string[];
  androidFeatureGraphic: string;

  iosStoreSettings: IIosStoreSettings;
  iosInfoSettings: IIosInfoSettings;
  iosReviewSettings: IIosReviewSettings;
  iosScreenshots: IIosScreenshots;

  androidDeveloperAccount?: null | WithId<IDeveloperAccountAndroid>;
  isFirstDeployment: boolean;
};

export type BuildJobPayloadType = {
  deploymentId: string;
  hostId: string;
  platform: "android" | "ios";
} & BuildConfigType;

export type JobProgressType = {
  task: {
    id: string;
    name: string;
    type: "initialised" | "processing" | "success" | "failed";
    duration: number;
  };
  type: "success" | "failed" | "warning";
  message: string;
  timestamp: Date;
};

export type AABDetailsType = Record<
  string,
  {
    versionName: string;
    buildNumber: number;
    createdAt: Date;
  }
>;
