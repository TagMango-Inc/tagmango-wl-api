import 'dotenv/config';

import bcrypt from 'bcrypt';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';

import { zValidator } from '@hono/zod-validator';

import Mongo from '../../src/database';
import { JWTPayloadType } from '../../src/types';
import { Response } from '../utils/statuscode';
import { loginDataSchema } from '../validations/authentication';

const router = new Hono();

router.post("/login", zValidator("json", loginDataSchema), async (c) => {
  try {
    const { email, password } = c.req.valid("json");
    const user = await Mongo.user.findOne({
      email,
      customhostDashboardAccess: { $exists: true },
      "customhostDashboardAccess.isRestricted": { $ne: true },
    });

    if (!user) {
      return c.json(
        {
          message: "User not found",
        },
        Response.NOT_FOUND,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return c.json(
        {
          message: "Invalid password",
        },
        {
          status: 401,
          statusText: "Unauthorized",
        },
      );
    }

    const payload: JWTPayloadType = {
      id: user._id.toString(),
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * (60 * 24 * 15), // 15 days
    };

    const secret = process.env.JWT_SECRET as string;

    const token = await sign(payload, secret);

    return c.json(
      {
        message: "Login successful",
        result: {
          token,
          user: {
            _id: user._id,
            email: user.email,
            name: user.name,
            role: user.customhostDashboardAccess.role,
          },
        },
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      {
        message: "Internal Server Error",
      },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

export default router;
