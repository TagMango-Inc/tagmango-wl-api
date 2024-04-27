import 'dotenv/config';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

import { serve } from '@hono/node-server';

import { buildRouter } from './routers';

const app = new Hono().basePath('/wl');

app.use(logger());
app.use('/*', cors());

app.get('/', (c) => {
  const DB_URI = process.env.DB_URI;
  console.log('DB_URI:', DB_URI);
  return c.json({
    message: 'Hello World',
    DB_URI,
  });
});
app.route('/build', buildRouter);

app.use(prettyJSON());

const port = Number(process.env.PORT) || 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
