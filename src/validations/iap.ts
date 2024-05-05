import { z } from "zod";

const patchIapProductIdsSchema = z.object({
  mangoIds: z.array(z.string()),
  action: z.enum(["assign", "unassign"]),
});

const patchMangoIapDetailsSchema = z.object({
  iapDescription: z.string().optional().nullable(),
  iapPrice: z.number().optional().nullable(),
});

export { patchIapProductIdsSchema, patchMangoIapDetailsSchema };
