import 'dotenv/config';

import bcrypt from 'bcrypt';
import { Hono } from 'hono';
import { verify } from 'hono/jwt';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { zValidator } from '@hono/zod-validator';

import Mongo from '../../src/database';
import { JWTPayloadType } from '../../src/types';
import { hashRefreshToken, issueTokenPair } from '../utils/authTokens';
import { Response } from '../utils/statuscode';
import { loginDataSchema } from '../validations/authentication';

const router = new Hono();

/**
 * POST /wl/auth/refresh
 * Exchange a valid refresh token for a new access + refresh pair.
 * Refresh tokens are rotated (single-use) and revocable via the stored hash.
 */
router.post(
  "/refresh",
  zValidator("json", z.object({ refreshToken: z.string().min(1) })),
  async (c) => {
    try {
      const { refreshToken } = c.req.valid("json");
      const secret = process.env.JWT_SECRET as string;

      let payload: JWTPayloadType;
      try {
        payload = await verify(refreshToken, secret);
      } catch {
        return c.json({ message: "unauthorized access" }, Response.UNAUTHORIZED);
      }

      if (payload.type !== "refresh") {
        return c.json({ message: "unauthorized access" }, Response.UNAUTHORIZED);
      }

      const user = await Mongo.user.findOne(
        {
          _id: new ObjectId(payload.id),
          "customhostDashboardAccess.isRestricted": { $ne: true },
        },
        {
          projection: {
            email: 1,
            "customhostDashboardAccess.refreshTokenHash": 1,
          },
        },
      );

      if (
        !user ||
        user.customhostDashboardAccess?.refreshTokenHash !==
          hashRefreshToken(refreshToken)
      ) {
        return c.json({ message: "unauthorized access" }, Response.UNAUTHORIZED);
      }

      const pair = await issueTokenPair({ _id: user._id, email: user.email });

      return c.json(
        { message: "Token refreshed", result: pair },
        Response.OK,
      );
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

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

    const { token, refreshToken } = await issueTokenPair(user);

    return c.json(
      {
        message: "Login successful",
        result: {
          token,
          refreshToken,
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
