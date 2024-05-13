import { createFactory } from "hono/factory";
import { verify } from "hono/jwt";
import { ObjectId } from "mongodb";
import Mongo from "src/database";
import { Response } from "src/utils/statuscode";

import { JWTPayloadType } from "../types";

const factory = createFactory();

const authenticationMiddleware = factory.createMiddleware(async (c, next) => {
  try {
    const authorizationHeader = c.req.header("authorization");
    if (!authorizationHeader) {
      return c.json(
        { message: "unauthorized access" },
        {
          status: 401,
          statusText: "Unauthorized",
        },
      );
    }
    const token = authorizationHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET as string;
    const payload: JWTPayloadType = await verify(token, secret);
    const user = await Mongo.user.findOne({
      _id: new ObjectId(payload.id),
    });

    if (!user) {
      return c.json({ message: "unauthorized access" }, Response.UNAUTHORIZED);
    }
    c.set("jwtPayload", payload);
    await next();
  } catch (error) {
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

export default authenticationMiddleware;
