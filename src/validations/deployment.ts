import { z } from 'zod';

const updateFailedAndroidDeploymentSchema = z.object({
  deploymentId: z.string(),
});

export { updateFailedAndroidDeploymentSchema };
