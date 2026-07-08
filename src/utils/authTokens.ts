import { createHash, randomBytes } from "crypto";
import { sign } from "hono/jwt";
import { ObjectId } from "mongodb";

import Mongo from "../database";
import { JWTPayloadType } from "../types";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 2; // 2 hours
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const hashRefreshToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * Issue an access + refresh token pair and persist the refresh-token hash on
 * the admin user (rotating any previous one, so refresh tokens are revocable
 * and single-use).
 */
export const issueTokenPair = async (user: {
  _id: ObjectId | string;
  email: string;
}): Promise<{ token: string; refreshToken: string }> => {
  const secret = process.env.JWT_SECRET as string;
  const now = Math.floor(Date.now() / 1000);

  const accessPayload: JWTPayloadType = {
    id: user._id.toString(),
    email: user.email,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };
  const refreshPayload: JWTPayloadType & { jti: string } = {
    id: user._id.toString(),
    email: user.email,
    exp: now + REFRESH_TOKEN_TTL_SECONDS,
    type: "refresh",
    // nonce — JWTs are deterministic, so same-second rotations would
    // otherwise produce an identical token and defeat single-use rotation
    jti: randomBytes(8).toString("hex"),
  };

  const [token, refreshToken] = await Promise.all([
    sign(accessPayload, secret),
    sign(refreshPayload, secret),
  ]);

  await Mongo.user.updateOne(
    { _id: new ObjectId(user._id.toString()) },
    {
      $set: {
        "customhostDashboardAccess.refreshTokenHash":
          hashRefreshToken(refreshToken),
      },
    },
  );

  return { token, refreshToken };
};
