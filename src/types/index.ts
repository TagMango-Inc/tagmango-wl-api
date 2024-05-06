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

export type BuildJobPayloadType = {
  deploymentId: string;
  hostId: string;
  name: string;
  bundle: string;
  domain: string;
  color: string;
  bgColor: string;
  onesignal_id: string;
  platform: "android" | "ios";
};

export type JobProgressType = {
  taskId: string;
  message: string;
  timestamp: number;
};
