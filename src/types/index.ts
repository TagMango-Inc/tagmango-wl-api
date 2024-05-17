import { Response } from "express";

import {
  IAndroidStoreSettings,
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
  bundle: string;
  domain: string;
  color: string;
  bgColor: string;
  onesignal_id: string;
  buildNumber: number;
  versionName: string;

  androidStoreSettings: IAndroidStoreSettings;
  androidScreenshots: string[];
  androidFeatureGraphic: string;

  iosStoreSettings: IIosStoreSettings;
  iosInfoSettings: IIosInfoSettings;
  iosReviewSettings: IIosReviewSettings;
  iosScreenshots: IIosScreenshots;
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
