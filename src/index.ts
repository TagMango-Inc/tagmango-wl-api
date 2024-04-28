import 'dotenv/config';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

import { serve } from '@hono/node-server';

import {
  appRouter,
  buildRouter,
  getAllCustomHostsRouter,
  uploadAssetRouter,
} from './routers';
import databaseConntect from './utils/database';

const app = new Hono().basePath('/wl');

app.use(logger());
app.use('/*', cors());

app.route('/build', buildRouter);
app.route('/apps', getAllCustomHostsRouter);
app.route('/app', appRouter);
app.route('/upload/asset', uploadAssetRouter);

app.use(prettyJSON());

const port = Number(process.env.PORT) || 3000;
console.log(`Server is running on port ${port}`);

serve(
  {
    fetch: app.fetch,
    port,
  },
  async (info) => {
    await databaseConntect();
  }
);
