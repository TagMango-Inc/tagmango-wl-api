import { z } from "zod";

export const createNewDeploymentSchema = z.object({
  target: z.enum(["android", "ios"]),
});
