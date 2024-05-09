import "dotenv/config";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import authenticationMiddleware from "./middleware/authentication";
import authenticationRouter from "./routers/authenticationRouter";
import customHostRouter from "./routers/customHostRouter";
import iapRouter from "./routers/iapRouter";
import sseRouter from "./routers/sse";
import userManagementRouter from "./routers/userManagementRouter";
import databaseConntect from "./utils/database";

const app = new Hono().basePath("/wl");

app.use(logger());
app.use("/*", cors());

app.use("/user-management/*", authenticationMiddleware);
app.use("/apps/*", authenticationMiddleware);
app.use("/iap/*", authenticationMiddleware);
// // server static files
// app.use(
//   "/static/assets/*",
//   serveStatic({
//     root: "./assets/*",
//   }),
// );

/**
** Auth Router
/wl/auth/login [ POST ]
/wl/auth/register [ POST ]

*! Protected Routes
** User Management Router
/wl/user-management/roles [ GET POST DELETE ]
/wl/user-management/users [ GET POST]

*! Protected Routes
** App Router 
/wl/apps/
/wl/apps/{:id} [ GET PATCH ]
/wl/apps/{:id}/deploy/{:target} [ GET ]  [sse]  [ fetching all the required data for the build process  from database without passing it through query params ]
/wl/apps/{:id}/upload/asset [ POST ]  [ ":id" is for future purpose, may be someday we may have to upload the asset to S3 and store the URL in the database.]

*/

app.get("/", async (c) => {
  return c.json({
    message: "Welcome to TagMango App Deployment API",
    version: "1.0.0",
  });
});

// serving static files from the assets folder
app.get(
  "/assets/*",
  serveStatic({
    root: "./",
    rewriteRequestPath: (path) => {
      const paths = path.split("/");
      const appName = paths[paths.length - 2];
      return `/assets/${appName}/icon.png`;
    },
  }),
);

app.route("/apps", customHostRouter);
app.route("/auth", authenticationRouter);
app.route("/user-management", userManagementRouter);
app.route("/iap", iapRouter);
app.route("/sse", sseRouter);

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
  },
);

export default app;
