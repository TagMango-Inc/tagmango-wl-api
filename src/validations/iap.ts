import { z } from "zod";

const patchIapProductIdsSchema = z.object({
  mangoIds: z.array(z.string()),
  action: z.enum(["assign", "unassign"]),
  host: z.string(),
});

const patchMangoIapDetailsSchema = z.object({
  iapDescription: z.string().optional().nullable(),
  iapPrice: z.number().optional().nullable(),
});

const createOrRevokeSubscriptionSchema = z.object({
  action: z.enum(["create", "revoke"]),
  host: z.string(),
});

export {
  createOrRevokeSubscriptionSchema,
  patchIapProductIdsSchema,
  patchMangoIapDetailsSchema,
};
