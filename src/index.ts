import 'dotenv/config';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

import { serve } from '@hono/node-server';

import customHostRouter from './routers/customHostRouter';
import databaseConntect from './utils/database';

const app = new Hono().basePath('/wl');

app.use(logger());
app.use('/*', cors());

/**
** Auth Router
/wl/auth/login [ POST ]
/wl/auth/register [ POST ]

*! Protected Routes
** User Management Router
/wl/user-management/assign-role [ POST ]
/wl/user-management/revoke-role [ POST ]
/wl/user-management/roles [ GET ]
/wl/user-management/users [ GET ]

*! Protected Routes
** App Router 
/wl/apps/
/wl/apps/{:id} [ GET PATCH ]
/wl/apps/{:id}/deploy/{:target} [ GET ]  [sse]  [ fetching all the required data for the build process  from database without passing it through query params ]
/wl/apps/{:id}/upload/asset [ POST ]  [ ":id" is for future purpose, may be someday we may have to upload the asset to S3 and store the URL in the database.]

*/

app.route('/apps', customHostRouter);

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
