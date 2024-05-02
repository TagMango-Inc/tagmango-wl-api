import { model, Schema, Types } from "mongoose";

export interface IDeploymentTaskType {
  id: string;
  name: string;
  status: "processing" | "failed" | "success";
  logs: {
    message: string;
    type: "initialized" | "success" | "failed" | "warning";
    timestamp: Date;
  }[];
}
export interface IDeployment {
  host: Types.ObjectId;
  user: Types.ObjectId;
  platform: "android" | "ios";
  versionName: string;
  buildNumber: string;
  tasks: IDeploymentTaskType[];
  status: "processing" | "failed" | "success";
}

const deploymentSchema = new Schema<IDeployment>(
  {
    host: { type: Schema.Types.ObjectId, ref: "customhost" },
    user: { type: Schema.Types.ObjectId, ref: "adminusers" },
    platform: {
      type: String,
      required: true,
      enum: ["android", "ios"],
    },
    versionName: {
      type: String,
      required: true,
    },
    buildNumber: {
      type: String,
      required: true,
    },
    tasks: [
      {
        id: {
          type: String,
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          required: true,
          enum: ["processing", "failed", "success"],
        },
        logs: [
          {
            message: {
              type: String,
              required: true,
            },
            type: {
              type: String,
              required: true,
              enum: ["initialized", "success", "error", "warning"],
            },
            timestamp: {
              type: Date,
              default: Date.now,
            },
          },
        ],
      },
    ],
    status: {
      type: String,
      required: true,
      enum: ["processing", "failed", "success"],
    },
  },
  {
    timestamps: true,
  },
);

const DeploymentModel = model<IDeployment>("WLDeployment", deploymentSchema);
export default DeploymentModel;
