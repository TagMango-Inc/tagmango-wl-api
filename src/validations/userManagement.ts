import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'read', 'write']),
});
const updateUserSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'read', 'write']).optional(),
});

const roleActionSchema = z.object({
  userId: z.string(),
  action: z.enum(['assign', 'revoke']).optional(),
  role: z.enum(['admin', 'read', 'write']).optional(),
});

const updatePasswordSchema = z.object({
  userId: z.string(),
  password: z.string(),
});

export {
  createUserSchema,
  roleActionSchema,
  updatePasswordSchema,
  updateUserSchema,
};
