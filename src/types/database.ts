import { ObjectId } from "mongodb";

export const Collections = {
  ADMIN_USER: "adminusers",
  CUSTOM_HOST: "customhosts",
  DEPLOYMENT: "wldeployments",
  METADATA: "customhostmetadatas",
  MANGO: "mangos",
  POST: "posts",
  COURSE: "courses",
  SUBSCRIPTION: "subscriptions",
  USER: "users",
  MANGO_ROOM: "rooms",
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

  createdAt: Date;
  updatedAt: Date;
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

enum CURRENCY {
  USD = "USD",
  INR = "INR",
  EUR = "EUR",
}
export interface IMango {
  creator: any;
  title: string;
  start: Date;
  end: Date;
  price: number;
  currency: CURRENCY;
  inr: number; // manual currency amount
  usd: number; // manual currency amount
  eur: number; // manual currency amount
  inrAmount: number;
  usdAmount: number;
  eurAmount: number;
  description: string;
  styledDescription: string;
  isStopTakingPayment: boolean;
  isHidden: boolean;
  isDeleted: boolean;
  recurringType:
    | "monthly"
    | "onetime"
    | "weekly"
    | "daily"
    | "yearly"
    | "onetime"
    | "quarterly"
    | "halfyearly";
  noOfDays: number;
  isLifeTime: boolean;
  content: boolean;
  chat: boolean;
  webinar: boolean;
  videocall: number;
  razorpayPlanId: string;
  razorpayPlanIdUSD: string;
  razorpayPlanIdEUR: string;
  isPublic: boolean;
  isFree: boolean;

  whatsapp?: string;
  imgUrl?: string;
  videoUrl?: string;
  videoThumbnail?: string;
  additionalCoverContent?: string[];
  gstEnabled: boolean;
  excludegst: boolean;
  includegst: boolean;
  activeSubscribers: number;
  // expiredSubscribers: number,
  totalEarning: number;
  playlistArr: any[];
  shortUrl: string;
  mangoSlug: string;
  certificateSentOn: string;
  disableMoe: boolean;
  mangoPageId: string;
  disableReciept: boolean;
  mangoPageUploadedLink: string;
  landingPagePublished: boolean;
  oldMigratedMangoId: any;
  thankYouContent: string;
  maxSubscriber: string;
  usdStripeProductPriceId: string;
  eurStripeProductPriceId: string;
  disableEngagement: boolean;
  customFields: [any];
  otpLess: boolean;
  affiliateEnabled: boolean;
  affiliatePercentage: number;
  lifetimeLinkingEnabled: boolean;
  aliasCreator: any;
  customHeaderTags: any;
  trialPeriod: number;
  additionalMangoes: any[];
  offers: [string];
  emailToCreatorOnEveryPurchase: boolean;
  emailToCreatorOnPurchaseFailure: boolean;
  hideCouponCodeInput: boolean;
  defaultPaymentGateway: "indian" | "international";
  repurchaseOneTime: boolean;
  zeroCostMango: boolean;
  mangoFacebookPixelId: string;
  accountSettingsMangoTier: "tier1" | "tier2" | "tier3";
  accountSettingsMangoCommission: number;
  affiliatedMangoes: any[];
  allowMultipleQuantity?: boolean;
  strikeThroughPrice: {
    inr: number;
    usd: number;
    eur: number;
  };
  maxBillingCycle: number;
  isLevelUpEnabled?: boolean;
  upsellTitle: string;
  upsellDetails: any[];
  customAffiliateLink: string;
  isPriceIncludedGst: boolean;
  openEndedMango: boolean;
  freebieMangoes: any;

  // IAP
  iapProductId?: string;
  iapDescription?: string | null;
  iapPrice?: number | null;
}

export interface IPost {
  creator: ObjectId;
  mango: ObjectId;
  caption: string;
  contentUrl: string;
  contentType: string;
  createdAt: Date;
  updatedAt: Date;
  carousal: string[];
  isLiveNotificationPushed: boolean;
  isWhatsappLive: boolean;
  isAssetsMigrated: boolean;
  commentCount: number;
  replyCount: number;
  mangoArr: ObjectId[];
  shortUrl: string;
  isEmailNotificationPushed: boolean;
  isWhatsappNotificationPushed: boolean;
}

export interface ICourse {
  _id: ObjectId;
  title: string;
  creator: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  mangoArr: ObjectId[];
  isPublished: boolean;
  firstChapter: ObjectId;
  coverImage: string;
  description: string;
  expireIn: number;
  publishDate: Date;
}

export interface ISubscription {
  creator: ObjectId;
  fan: ObjectId;
  mango: ObjectId;
  status: "active" | "cancelled" | "initiated" | "expired";
  isPublic: boolean;
  createdAt: Date;
  expiredAt: Date;
  orders: any[];
}

export interface IUser {
  isEmailVerified: boolean;
  mangoes: ObjectId[];
  showtwitter: boolean;
  showfacebook: boolean;
  showinstagram: boolean;
  showyoutube: boolean;
  showlinkedin: boolean;
  isDeactivated: boolean;
  fanCompleted: boolean;
  phone: number;
  onboarding: string;
  otp: string;
  expireIn: string;
  createdAt: Date;
  updatedAt: Date;
  email: string;
  name: string;
  profilePicUrl: string;
  userSlug: string;
  firebaseSync: number;
  syncFirebase: boolean;
  refreshTokens: any[];
  country: string;
  isHiddenFromDiscovery: boolean;
  showSubscriberCount: boolean;
  isAssetsMigrated: boolean;
  currency: string;
  videoUploadEnabled: boolean;
  convenienceFee: number;
  host: string;
  mangoCreditsAvailable: number;
  drmEnabled: boolean;
}

export interface IMangoRoom {
  participants: ObjectId[];
  lastMessage: ObjectId[];
  blockedParticipants: ObjectId[];
  enableSubscriberMessaging: boolean;
  peerConversation: boolean;
  mango: ObjectId;
  creator: ObjectId;
  roomType: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessageTime: Date;
}
