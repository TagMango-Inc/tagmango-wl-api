import mongoose, { PopulatedDoc } from "mongoose";

enum CURRENCY {
  USD = "USD",
  INR = "INR",
  EUR = "EUR",
}

export type MangoType = mongoose.Document & {
  creator: PopulatedDoc<Document>;
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
  playlistArr: [PopulatedDoc<Document>];
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
  aliasCreator: PopulatedDoc<Document>;
  customHeaderTags: any;
  trialPeriod: number;
  additionalMangoes: [MangoType];
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
  affiliatedMangoes: [
    {
      mango: PopulatedDoc<Document>;
      affiliatePercentage: number;
      affiliateEnabled: boolean;
    },
  ];
  allowMultipleQuantity?: boolean;
  strikeThroughPrice: {
    inr: number;
    usd: number;
    eur: number;
  };
  maxBillingCycle: number;
  isLevelUpEnabled?: boolean;
  upsellTitle: string;
  upsellDetails: [
    {
      // eslint-disable-next-line no-use-before-define
      mango: PopulatedDoc<MangoDocument & Document>;
      newTitle: string;
      newDescription: string;
      newCoverImage: string;
      backgroundColor: string;
      borderColor: string;
      borderWidth: string;
      borderStyle: string;
      corner: string;
      markDownDescription: string;
    },
  ];
  customAffiliateLink: string;
  isPriceIncludedGst: boolean;
  openEndedMango: boolean;
  freebieMangoes: [PopulatedDoc<MangoDocument & Document>];

  // IAP
  iapProductId?: string;
  iapDescription?: string | null;
  iapPrice?: number | null;
};

export type MangoDocument = mongoose.Document & MangoType;
const MangoSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    title: { type: String, required: true },
    start: { type: Date },
    end: { type: Date },
    price: { type: Number },
    currency: { type: String, enum: Object.values(CURRENCY) },
    inr: { type: Number },
    usd: { type: Number },
    eur: { type: Number },
    inrAmount: { type: Number },
    usdAmount: { type: Number },
    eurAmount: { type: Number },
    description: { type: String },
    styledDescription: { type: String },
    isStopTakingPayment: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    recurringType: { type: String }, // onetime,monthly,quaterly,annualy
    noOfDays: { type: Number },
    isLifeTime: { type: Boolean },
    content: { type: Boolean, default: true },
    chat: { type: Boolean, default: true },
    videocall: { type: Number, default: 0 },
    webinar: { type: Boolean, default: true },
    whatsapp: { type: String }, // requested,approved,rejected
    razorpayPlanId: { type: String },
    razorpayPlanIdUSD: { type: String },
    razorpayPlanIdEUR: { type: String },
    isPublic: { type: Boolean, default: false },
    // whatsappRequestStatus: { type: String }, // requested,approved,rejected
    imgUrl: { type: String },
    videoUrl: { type: String },
    videoThumbnail: { type: String },
    additionalCoverContent: [{ type: String }],
    gstEnabled: { type: Boolean },
    excludegst: { type: Boolean, default: false },
    includegst: { type: Boolean, default: false },
    activeSubscribers: { type: Number, default: 0 },
    // expiredSubscribers: { type: Number, default: 0 },
    totalEarning: { type: Number, default: 0 },
    playlistArr: [{ type: mongoose.Schema.Types.ObjectId, ref: "playlist" }],
    shortUrl: { type: String, default: "shorturl.com" },
    mangoSlug: { type: String },
    certificateSentOn: { type: Date },
    disableMoe: { type: Boolean, default: false },
    mangoPageId: { type: mongoose.Schema.Types.ObjectId, ref: "landingpage" },
    disableReciept: { type: Boolean, default: false },
    mangoPageUploadedLink: { type: String },
    landingPagePublished: { type: Boolean, default: false },
    oldMigratedMangoId: { type: mongoose.Schema.Types.ObjectId, ref: "mango" },
    thankYouContent: { type: String },
    maxSubscriber: { type: Number },
    isFree: { type: Boolean },
    usdStripeProductPriceId: { type: String },
    eurStripeProductPriceId: { type: String },
    disableEngagement: { type: Boolean },
    otpLess: { type: Boolean },
    customFields: [
      {
        fieldType: String,
        fieldName: String,
        validation: String,
        helpText: String,
        dropdownValues: [String],
      },
    ],
    affiliateEnabled: { type: Boolean },
    affiliatePercentage: { type: Number },
    lifetimeLinkingEnabled: { type: Boolean },
    aliasCreator: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    customHeaderTags: { type: Object },
    trialPeriod: { type: Number, default: 0 },
    additionalMangoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "mango" }],
    offers: [{ type: String }],
    emailToCreatorOnEveryPurchase: { type: Boolean, default: false },
    emailToCreatorOnPurchaseFailure: { type: Boolean, default: false },
    hideCouponCodeInput: { type: Boolean },
    defaultPaymentGateway: { type: String },
    repurchaseOneTime: { type: Boolean },
    zeroCostMango: { type: Boolean, default: false },
    mangoFacebookPixelId: { type: String },

    accountSettingsMangoTier: { type: String },
    accountSettingsMangoCommission: { type: Number },
    affiliatedMangoes: [
      {
        mango: { type: mongoose.Schema.Types.ObjectId, ref: "mango" },
        affiliatePercentage: { type: Number },
        affiliateEnabled: { type: Boolean },
      },
    ],
    allowMultipleQuantity: { type: Boolean, default: false },
    strikeThroughPrice: {
      inr: { type: Number },
      usd: { type: Number },
      eur: { type: Number },
    },
    maxBillingCycle: { type: Number },
    isLevelUpEnabled: { type: Boolean },
    upsellTitle: { type: String },
    upsellDetails: [
      {
        mango: { type: mongoose.Schema.Types.ObjectId, ref: "mango" },
        newTitle: { type: String },
        newDescription: { type: String },
        newCoverImage: { type: String },
        backgroundColor: { type: String },
        borderColor: { type: String },
        borderWidth: { type: String },
        borderStyle: { type: String },
        corner: { type: String },
        markDownDescription: { type: String },
      },
    ],
    customAffiliateLink: { type: String },
    isPriceIncludedGst: { type: Boolean, default: false },
    openEndedMango: { type: Boolean },
    freebieMangoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "mango" }],

    // IAP
    iapProductId: { type: String },
    iapDescription: { type: String },
    iapPrice: { type: Number },
  },
  { timestamps: true },
);
MangoSchema.index({ isHidden: 1 });
MangoSchema.index({ isStopTakingPayment: 1 });
MangoSchema.index({ creator: 1 });
MangoSchema.index({ start: 1, end: 1 });
MangoSchema.index({
  isHidden: 1,
  isStopTakingPayment: 1,
  start: 1,
  end: 1,
});
MangoSchema.index({ creator: 1, end: 1 });
MangoSchema.pre("find", function (): void {
  this.where({ isPublic: { $ne: true } });
});

export default mongoose.model<MangoDocument>("mango", MangoSchema);
