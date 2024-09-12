import { z } from "zod";

const createDeveloperAccountAndroidSchema = z.strictObject({
  name: z.string(),
  organizationalUnit: z.string(),
  organization: z.string(),
  city: z.string(),
  state: z.string(),
  countryCode: z.string(),

  keyAlias: z.string(),
  keyPassword: z.string(),

  fastlaneConfig: z.string(),
});

export { createDeveloperAccountAndroidSchema };
