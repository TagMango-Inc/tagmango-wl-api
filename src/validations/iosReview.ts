import { z } from "zod";

const submitIosReviewSchema = z.object({
  // App Store Connect app ids, as shown in the latest scan
  appleIds: z
    .array(z.string().regex(/^\d+$/, "invalid App Store Connect app id"))
    .min(1)
    .max(2000),
});

export { submitIosReviewSchema };
