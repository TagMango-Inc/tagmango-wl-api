import { Response } from "express";

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
  message: string;
  timestamp: number;
};
