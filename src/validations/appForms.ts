import { z } from "zod";

const rejectFormByIdSchema = z.object({
  reason: z.string(),
  errors: z.record(z.string()),
});

export { rejectFormByIdSchema };
