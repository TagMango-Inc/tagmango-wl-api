import { z } from 'zod';

const updateReleaseDetailsSchema = z.object({
  versionName: z.string().optional(),
  buildNumber: z.number().optional(),
  releaseNotes: z.string().optional(),
});

export { updateReleaseDetailsSchema };
