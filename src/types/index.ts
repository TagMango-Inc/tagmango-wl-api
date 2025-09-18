import { Response } from "express";
import { WithId } from "mongodb";

import {
  IAndroidStoreSettings,
  IDeveloperAccountAndroid,
  IDeveloperAccountIos,
  IIosInfoSettings,
  IIosReviewSettings,
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

  iosStoreSettings: IIosStoreSettings;
  iosInfoSettings: IIosInfoSettings;
  iosReviewSettings: IIosReviewSettings;

  androidDeveloperAccount?: null | WithId<IDeveloperAccountAndroid>;
  iosDeveloperAccount?: null | WithId<IDeveloperAccountIos>;
  isFirstDeployment: boolean;
  generateIAPScreenshot: boolean;
};

export type BuildJobPayloadType = {
  deploymentId: string;
  hostId: string;
  platform: "android" | "ios";
} & BuildConfigType;

export type RedeploymentJobPayloadType = {
  hostIds: string[];
  platform: "android" | "ios";
  redeploymentId: string;
  userId: string;
};

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
