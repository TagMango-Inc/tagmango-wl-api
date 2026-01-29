import { z } from "zod";

export const updateDeploymentRequestStatusSchema = z.object({
  platform: z.enum(["android", "ios"]),
  status: z.enum(["pending", "processing", "success", "failed"]),
});

export const listDeploymentRequestsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z
    .enum(["pending", "processing", "success", "failed", "all"])
    .optional(),
  platform: z.enum(["android", "ios", "all"]).optional(),
});
