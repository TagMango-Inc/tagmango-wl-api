import {
  Document,
  model,
  Schema,
  Types,
} from 'mongoose';

export interface IMetaData extends Document {
  host: Types.ObjectId;
  appName: string;

  //   assetDomain: string;
  logo: string;

  backgroundType: "color" | "gradient";
  backgroundStartColor: string;
  backgroundEndColor: string;
  backgroundGradientAngle: number;
  //   backgroundColor: string; // for type color
  //   gradientStartColor: string; // for type gradient
  //   gradientEndColor: string; // for type gradient
  //   gradientAngle: number;    // for type gradient
  logoPadding: number;

  iosDeploymentDetails: {
    bundleId: string;
    versionName: string;
    buildNumber: number;
    isUnderReview: boolean;
    lastDeploymentDetails: {
      versionName: string;
      buildNumber: number;
    };
  };
  androidDeploymentDetails: {
    bundleId: string;
    versionName: string;
    buildNumber: number;
    lastDeploymentDetails: {
      versionName: string;
      buildNumber: number;
    };
  };
}

const customhostMetadataSchema = new Schema<IMetaData>(
  {
    host: {
      type: Schema.Types.ObjectId,
      ref: "customhost",
      unique: true,
      required: true,
    },
    appName: {
      type: String,
    },
    logo: {
      type: String,
    },
    backgroundType: {
      type: String,
      enum: ["color", "gradient"],
      default: "color",
    },
    backgroundStartColor: {
      type: String,
    },
    backgroundEndColor: {
      type: String,
    },
    backgroundGradientAngle: {
      type: Number,
      default: 0,
    },
    logoPadding: {
      type: Number,
      default: 0,
    },

    iosDeploymentDetails: {
      bundleId: String,
      versionName: String,
      buildNumber: Number,
      isUnderReview: Boolean,
      lastDeploymentDetails: {
        versionName: String,
        buildNumber: Number,
      },
    },
    androidDeploymentDetails: {
      bundleId: String,
      versionName: String,
      buildNumber: Number,
      lastDeploymentDetails: {
        versionName: String,
        buildNumber: Number,
      },
    },
  },
  { timestamps: true },
);

const MetadataModel = model<IMetaData>(
  "customhostmetadata",
  customhostMetadataSchema,
);
export default MetadataModel;
