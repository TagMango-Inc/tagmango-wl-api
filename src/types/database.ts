import { ObjectId } from "mongodb";

export const Collections = {
  ADMIN_USER: "adminusers",
  CUSTOM_HOST: "customhosts",
  DEPLOYMENT: "wldeployments",
  METADATA: "customhostmetadatas",
} as const;

export const Platform = {
  ANDROID: "android",
  IOS: "ios",
} as const;

export type Platform = (typeof Platform)[keyof typeof Platform];

export const Status = {
  PENDING: "pending",
  PROCESSING: "processing",
  FAILED: "failed",
  SUCCESS: "success",
  CANCELLED: "cancelled",
  WARNING: "warning",
} as const;

export type Status = (typeof Status)[keyof typeof Status];

export interface IAdminUser {
  approved: boolean;
  email: string;
  name: string;
  password: string;
  isRestricted: boolean;
  customhostDashboardAccess: {
    role: string;
    isRestricted: boolean;
  };
}

export interface IDeploymentTask {
  id: string;
  name: string;
  status: Exclude<Status, "warning" | "cancelled">;
  logs: {
    message: string;
    type: Exclude<Status, "pending" | "processing" | "cancelled">;
    timestamp: Date;
  }[];
  duration: number;
}
export interface IDeployment {
  host: ObjectId;
  user: ObjectId;
  platform: Platform;
  versionName: string;
  buildNumber: number;
  tasks: IDeploymentTask[];
  status: Exclude<Status, "warning">;
  cancelledBy: ObjectId | null;
}

export interface IMetaData {
  host: ObjectId;
  appName: string;

  //   assetDomain: string;
  logo: string;

  backgroundType: "color" | "gradient";
  backgroundStartColor: string;
  backgroundEndColor: string;
  backgroundGradientAngle: number;
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

export interface ICustomHost {
  creator: ObjectId; // ! PopulatedDoc<UserDocument>;
  aliasCreator: ObjectId; // ! PopulatedDoc<UserDocument>;
  tagmangoCreator: ObjectId; // ! PopulatedDoc<UserDocument>;
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

  gamifiedMangoes: ObjectId; // !! PopulatedDoc<MangoDocument>[];
  communityEnabledMangoes?: ObjectId; // ! PopulatedDoc<MangoDocument>[];
  iapMangoes?: Record<string, string>;
  onesignalAppId?: string;
  domainVerificationRecords?: any;
  emailDomainVerificationRecords?: any;

  routingConfig?: RoutingConfig;

  deploymentMetadata: ObjectId;
}

// Route

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

// points

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
