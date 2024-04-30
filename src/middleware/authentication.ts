import { createFactory } from 'hono/factory';
import { verify } from 'hono/jwt';
import AdminUserModel from 'src/models/adminUser.model';

import { JWTPayloadType } from '../types';

const factory = createFactory();

const authenticationMiddleware = factory.createMiddleware(async (c, next) => {
  try {
    const authorizationHeader = c.req.header('authorization');
    if (!authorizationHeader) {
      return c.json(
        { message: 'unauthorized access' },
        {
          status: 401,
          statusText: 'Unauthorized',
        }
      );
    }
    const token = authorizationHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET as string;
    const payload: JWTPayloadType = await verify(token, secret);
    const user = AdminUserModel.findById(payload.id);
    if (!user) {
      return c.json(
        { message: 'unauthorized access' },
        {
          status: 401,
          statusText: 'Unauthorized',
        }
      );
    }
    c.set('jwtPayload', payload);
    await next();
  } catch (error) {
    return c.json(
      { message: 'Internal Server Error' },
      {
        status: 500,
        statusText: 'Internal Server Error',
      }
    );
  }
});

export default authenticationMiddleware;
