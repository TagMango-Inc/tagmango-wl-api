import { model, Schema, Types } from "mongoose";

export interface IDeploymentTask {
  id: string;
  name: string;
  status: "pending" | "processing" | "failed" | "success";
  logs: {
    message: string;
    type: "initialized" | "success" | "failed" | "warning";
    timestamp: Date;
  }[];
  duration: number;
}
export interface IDeployment {
  host: Types.ObjectId;
  user: Types.ObjectId;
  platform: "android" | "ios";
  versionName: string;
  buildNumber: number;
  tasks: IDeploymentTask[];
  status: "pending" | "processing" | "failed" | "success" | "cancelled";
  cancelledBy: Types.ObjectId;
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
      type: Number,
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
          enum: ["pending", "processing", "failed", "success"],
        },
        duration: {
          type: Number,
          default: 0,
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
              enum: ["initialized", "success", "failed", "warning"],
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
      default: "pending",
      enum: ["pending", "processing", "failed", "success", "cancelled"],
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "adminusers",
    },
  },
  {
    timestamps: true,
  },
);

const DeploymentModel = model<IDeployment>("WLDeployment", deploymentSchema);
export default DeploymentModel;
