import { z } from 'zod';

const loginDataSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export { loginDataSchema };
