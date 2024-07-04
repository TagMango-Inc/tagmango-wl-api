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

export { generateFormValuesAISchema, rejectFormByIdSchema };
