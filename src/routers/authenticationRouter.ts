import 'dotenv/config';

import bcrypt from 'bcrypt';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { JWTPayloadType } from 'src/types';

import { zValidator } from '@hono/zod-validator';

import AdminUserModel from '../models/adminUser.model';
import { loginDataSchema } from '../validations/authentication';

const router = new Hono();

router.post('/login', zValidator('json', loginDataSchema), async (c) => {
  try {
    const { email, password } = c.req.valid('json');
    const user = await AdminUserModel.findOne({ email });
    if (!user) {
      return c.json(
        {
          message: 'User not found',
        },
        {
          status: 404,
          statusText: 'Not Found',
        }
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return c.json(
        {
          message: 'Invalid password',
        },
        {
          status: 401,
          statusText: 'Unauthorized',
        }
      );
    }

    const payload: JWTPayloadType = {
      id: user._id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * (60 * 24 * 15), // 15 days
    };

    const secret = process.env.JWT_SECRET as string;

    const token = await sign(payload, secret);

    return c.json(
      {
        message: 'Login successful',
        authToken: token,
      },
      {
        status: 200,
        statusText: 'OK',
      }
    );
  } catch (error) {
    return c.json(
      {
        message: 'Internal Server Error',
      },
      {
        status: 500,
        statusText: 'Internal Server Error',
      }
    );
  }
});

export default router;
