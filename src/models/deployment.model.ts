import {
  model,
  Schema,
} from 'mongoose';

export interface IDeploymentTaskType {
  id: string;
  name: string;
  status: 'processing' | 'failed' | 'success';
  logs: {
    message: string;
    type: 'initialized' | 'success' | 'failed' | 'warning';
    timestamp: Date;
  }[];
}
export interface IDeployment {
  host: string;
  platform: 'android' | 'ios';
  versionName: string;
  buildNumber: string;
  tasks: IDeploymentTaskType[];
  status: 'processing' | 'failed' | 'success';
}

const deploymentSchema = new Schema<IDeployment>(
  {
    host: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      required: true,
      enum: ['android', 'ios'],
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
          enum: ['processing', 'failed', 'success'],
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
              enum: ['initialized', 'success', 'error', 'warning'],
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
      enum: ['processing', 'failed', 'success'],
    },
  },
  {
    timestamps: true,
  }
);

const DeploymentModel = model<IDeployment>(
  'WLDeploymentLogs',
  deploymentSchema
);
export default DeploymentModel;
