import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import zod from 'zod';

import executeCommands from '../utils/executeCommands';

const validationSchema = zod.object({
  name: zod.string(),
  bundle: zod.string(),
  domain: zod.string().regex(/\./g),
  color: zod.string(),
  bgColor: zod.string(),
  oneSignalId: zod.string().regex(/-/g),
});

const build = new Hono();

build.get('/', async (c) => {
  const query = c.req.query();

  const {
    error,
    data: queryParams,
    success,
  } = validationSchema.safeParse(query);
  if (error || !success) {
    return c.json(
      { message: 'invalid query params', error: error.errors },
      {
        status: 400,
        statusText: 'Bad Request',
      }
    );
  }

  const {
    name,
    bundle,
    domain,
    color: encodedColor,
    bgColor: encodedBgColor,
    oneSignalId,
  } = queryParams;
  const color = decodeURIComponent(encodedColor);
  const bgColor = decodeURIComponent(encodedBgColor);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: '__________________________ INSTALLING DEPENDENCIES __________________________',
    }); // Send output to client

    await executeCommands(
      ['cd deployments', 'npm install'],
      'Install Dependencies',
      stream
    );

    // Start npm run build process
    await stream.writeSSE({
      data: '__________________________ BUILDING __________________________',
    }); // Send output to client
  });
});

export default build;
