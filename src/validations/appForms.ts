import { z } from "zod";

const rejectFormByIdSchema = z.object({
  reason: z.string(),
  errors: z.record(z.string()),
});

const generateFormValuesAISchema = z.object({
  audience: z.string(),
  purpose: z.string(),
  category: z.string(),
  name: z.string(),
});

const updatAppFormLogoSchema = z.object({
  logo: z.string(),
  customOneSignalIcon: z.string(),
  icon: z.string(),
  background: z.string(),
  foreground: z.string(),
  backgroundType: z.enum(["color", "gradient"]),
  backgroundStartColor: z.string().optional(),
  backgroundEndColor: z.string().optional(),
  backgroundGradientAngle: z.number().optional(),
  logoPadding: z.number(),
});

export {
  generateFormValuesAISchema,
  rejectFormByIdSchema,
  updatAppFormLogoSchema,
};
