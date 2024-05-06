import mongoose, { Schema } from "mongoose";

// import { UserDocument } from './user';
// import { MangoDocument } from './mango';

export const SystemPointsTypeList = [
  "dailyActive",
  "likeOnPost",
  "commentOnPost",
  "messageInRoom",
  "createPost",
  "10perCourseCompletion",
  "50perCourseCompletion",
  "100perCourseCompletion",
  "attendance",
] as const;
export type SystemPointsType = (typeof SystemPointsTypeList)[number];

export interface PointsConfig {
  pointsName?: string;
  pointsImage?: string;
  pointsMap: Record<SystemPointsType, number>;
}
export type CustomHostDocument = mongoose.Document & {
  creator: Schema.Types.ObjectId; // ! PopulatedDoc<UserDocument>;
  aliasCreator: Schema.Types.ObjectId; // ! PopulatedDoc<UserDocument>;
  tagmangoCreator: Schema.Types.ObjectId; // ! PopulatedDoc<UserDocument>;
  host: string;
  logo: string;
  favicon: string;
  offeringTitle: string;
  offeringTitles: string;
  emailDomain: string;
  brandname: string;
  supportAddress: string;
  logoEmailHeader: string;
  logoInvoiceHeader: string;
  landingPageHost: string;
  androidDeepLinkConfig: object;
  iosDeepLinkConfig: object;
  // **
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
  deploymentDetails: {
    appLogo: string;
    appName: string;
  };
  //** */
  versionDetails: object;
  colors: any;
  theme: "light" | "dark";
  appName: string;
  androidShareLink: string;
  iosShareLink: string;
  maxUserLogin: number;
  gcpConfig: {
    clientId: string;
    apiKey: string;
  };
  customSupportLink: string;
  whatsappApiKey?: string;
  whatsappProvider?: string;
  disableWhatsapp?: boolean;
  disableSMS?: boolean;
  customTemplateConfig?: any;
  isFreeMangoEnabled?: any;
  hidePopularServices?: boolean;
  hotjarCode?: string;
  clarityCode?: string;
  zoomgalleryViewCode?: string;
  whatsappAccountId?: string;
  whatsappSecretKey?: string;
  whatsappChannelId?: string;
  whatsappBrandName?: string;
  loginScreenTitle?: string;
  pwaManifest?: object;
  sku?: string;
  isIAPEnabled?: boolean;

  autoWhiteLable: boolean;
  isWhitelbleLive: boolean;
  distributionId: string;
  certificateArn: string;
  pwaDistributionId: string;
  whitelableStatus:
    | "initiated"
    | "domain_verified"
    | "details_added"
    | "drafted";
  enableCache: boolean;
  isPWAEnabled: boolean;
  supportWidget: any;
  enableSupportWidget: boolean;
  sendGridDomainAccountId?: number;
  sendGridDomainVerified?: boolean;
  rootLevelLandingPageHost?: string;
  appIconUrl: string;
  appGenericHeaders: [string];
  platformSuspended: boolean;
  maximumOverlapsAllowed: number;
  isCommunityEnabled: boolean;
  pointsConfig: PointsConfig;
  gamifiedMangoes: Schema.Types.ObjectId; // !! PopulatedDoc<MangoDocument>[];
  communityEnabledMangoes?: Schema.Types.ObjectId; // ! PopulatedDoc<MangoDocument>[];
  iapMangoes?: Record<string, string>;
  onesignalAppId?: string;
  domainVerificationRecords?: any;
  emailDomainVerificationRecords?: any;

  routingConfig?: RoutingConfig;
};

export interface RoutingConfig {
  initialRoutes?: InitialRoutes;
  routes: Route[];
}

export type InitialRoutes = Record<string, InitialRoute>;

export interface InitialRoute {
  path: string;
  key: string;
  isTMProject?: boolean;
}

export interface Route {
  key: string;
  path: string;
  title: string;
  apps?: CustomApp[];
  icon?: string;
  iconPack?: string;
}

export interface CustomApp {
  domain?: string;
  name: string;
  entryPath?: string;
  slug: string;
  target?: CustomAppTarget;
  description?: string;
}

export enum CustomAppTarget {
  SELF = "_self",
  BLANK = "_blank",
}

export const CustomHostSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    tagmangoCreator: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    aliasCreator: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    host: {
      type: String,
      required: true,
    },
    maxUserLogin: { type: Number, default: 5 },

    landingPageHost: {
      type: String,
    },
    logo: {
      type: String,
      required: true,
    },
    favicon: { type: String },
    logoEmailHeader: {
      type: String,
    },
    logoInvoiceHeader: {
      type: String,
    },
    offeringTitle: {
      type: String,
      required: true,
    },
    colors: {
      type: Object,
      default: {
        PRIMARY: "#004AAD",
        LAUNCH_BG: "#FEDC5A",
        LAUNCH_TEXT: "#004AAD",
        DARKBLUE: "#004AAD",
      },
    },
    theme: {
      type: String,
      default: "light",
    },
    appName: { type: String },
    emailDomain: {
      type: String,
    },
    offeringTitles: {
      type: String,
      required: true,
    },
    brandname: {
      type: String,
    },
    supportAddress: {
      type: String,
    },
    androidShareLink: { type: String },
    iosShareLink: { type: String },
    androidDeepLinkConfig: {
      type: Object,
      default: {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.tagmango.app",
          sha256_cert_fingerprints: [
            "72:2C:BF:A9:80:A7:53:ED:BF:10:39:6C:27:72:24:99:33:F9:DC:7B:5D:64:08:99:04:02:58:EA:07:C8:2F:54",
            "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
            "26:5D:F6:40:FD:0A:53:11:A2:5A:34:34:11:68:EE:B1:ED:20:59:08:8A:09:5B:A5:57:66:21:89:AC:31:93:3D",
          ],
        },
      },
    },
    iosDeepLinkConfig: {
      type: Object,
      default: {
        applinks: {
          apps: [],
          details: [
            {
              appID: "UK3JSUMFQ9.com.tagmango.app",
              paths: ["NOT /zoom*", "*"],
            },
          ],
        },
      },
    },
    // **
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
    deploymentDetails: {
      appLogo: String,
      appName: String,
    },
    //** */
    versionDetails: {
      type: Object,
      default: {
        minimum_required_version: 32,
        version_name: "2.2.3",
        minIosBuildVersion: 33,
        minAndroidBuildVersion: 32,
        isUnderReview: false,
        latestIosBuildVersion: 44,
      },
    },
    gcpConfig: {
      clientId: { type: String },
      apiKey: { type: String },
    },
    customSupportLink: {
      type: String,
    },
    whatsappApiKey: {
      type: String,
    },
    whatsappProvider: {
      type: String,
    },
    disableWhatsapp: {
      type: Boolean,
      default: false,
    },
    disableSMS: {
      type: Boolean,
      default: false,
    },
    customTemplateConfig: { type: Object },
    isFreeMangoEnabled: { type: Boolean },
    hidePopularServices: { type: Boolean, default: true },
    zoomgalleryViewCode: { type: String },
    hotjarCode: { type: String },
    clarityCode: { type: String },
    loginScreenTitle: { type: String },
    pwaManifest: {
      type: Object,
      default: {
        short_name: "TagMango",
        name: "TagMango | Creator's Platform to host live workshops and launch courses.",
        description:
          "TagMango helps content creators monetize better. It helps them host live workshops and launch their courses.",
        icons: [
          {
            src: "tagmango.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "maskable_icon_x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "maskable_icon_x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        id: ".",
        start_url: ".",
        display: "standalone",
        theme_color: "#f18926",
        background_color: "#ffffff",
      },
    },
    whatsappAccountId: {
      type: String,
    },
    whatsappSecretKey: {
      type: String,
    },
    whatsappChannelId: {
      type: String,
    },
    whatsappBrandName: {
      type: String,
    },
    sku: { type: String },
    isIAPEnabled: { type: Boolean },

    autoWhiteLable: { type: Boolean },
    isWhitelbleLive: { type: Boolean },
    distributionId: { type: String },
    certificateArn: { type: String },
    pwaDistributionId: { type: String },
    whitelableStatus: { type: String, default: "drafted" },

    enableCache: { type: Boolean, default: false },
    isPWAEnabled: { type: Boolean, default: true },
    supportWidget: [
      {
        type: { type: String },
        value: { type: String },
      },
    ],
    enableSupportWidget: { type: Boolean },
    sendGridDomainAccountId: { type: Number },
    sendGridDomainVerified: { type: Boolean },
    rootLevelLandingPageHost: { type: String },

    appIconUrl: { type: String },
    appGenericHeaders: [{ type: String }],
    whitelabelPlanType: { type: String },
    platformSuspended: { type: Boolean },
    maximumOverlapsAllowed: { type: Number },
    isCommunityEnabled: { type: Boolean },
    pointsConfig: {
      type: Object,
    },
    gamifiedMangoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "mango" }],
    communityEnabledMangoes: [
      { type: mongoose.Schema.Types.ObjectId, ref: "mango" },
    ],
    iapMangoes: { type: Object },
    onesignalAppId: { type: String },
    domainVerificationRecords: { type: Object },
    emailDomainVerificationRecords: { type: Object },
    routingConfig: {
      type: Object,
    },
  },
  { timestamps: true },
);

const CustomHostModel = mongoose.model<CustomHostDocument>(
  "customhost",
  CustomHostSchema,
);

export default CustomHostModel;
