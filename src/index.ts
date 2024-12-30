import "dotenv/config";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import Mongo from "./database";
import authenticationMiddleware from "./middleware/authentication";
import appFormsRouter from "./routers/appFormsRouter";
import authenticationRouter from "./routers/authenticationRouter";
import customHostRouter from "./routers/customHostRouter";
import developerAccountsRouter from "./routers/developerAccountsRouter";
import iapRouter from "./routers/iapRouter";
import metadataRouter from "./routers/metadataRouter";
import outputRouter from "./routers/outputRouter";
import releaseRouter from "./routers/releaseRouter";
import sseRouter from "./routers/sse";
import userManagementRouter from "./routers/userManagementRouter";

const app = new Hono().basePath("/wl");

Mongo.connect().then(() => {
  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.use("/*", async (c, next) => {
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    );
    if (c.req.method === "OPTIONS") {
      return c.text("", 204);
    }
    await next();
  });

  app.use("/user-management/*", authenticationMiddleware);
  app.use("/apps/*", authenticationMiddleware);
  app.use("/iap/*", authenticationMiddleware);
  app.use("/metadata/*", authenticationMiddleware);
  app.use("/output/*", authenticationMiddleware);
  app.use("/release/*", authenticationMiddleware);
  app.use("/developer-accounts/*", authenticationMiddleware);
  // app.use("/forms", authenticationMiddleware);

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
        return `./assets/${paths.slice(3).join("/")}`;
      },
    }),
  );

  // serving static files from the form assets folder
  app.get(
    "/form-assets/*",
    serveStatic({
      root: "./",
      rewriteRequestPath: (path) => {
        const paths = path.split("/");
        return `./forms/${paths.slice(3).join("/")}`;
      },
    }),
  );

  // serving static files from the outputs folder
  app.get(
    "/outputs/*",
    serveStatic({
      root: "./",
      rewriteRequestPath: (path) => {
        const paths = path.split("/");
        return `./outputs/${paths.slice(3).join("/")}`;
      },
    }),
  );

  app.route("/apps", customHostRouter);
  app.route("/auth", authenticationRouter);
  app.route("/user-management", userManagementRouter);
  app.route("/iap", iapRouter);
  app.route("/metadata", metadataRouter);
  app.route("/output", outputRouter);
  app.route("/release", releaseRouter);
  app.route("/sse", sseRouter);
  app.route("/developer-accounts", developerAccountsRouter);
  app.route("/forms", appFormsRouter);

  app.use(prettyJSON());

  const port = Number(process.env.PORT) || 3000;
  console.log(`Server is running on port ${port}`);

  serve({
    fetch: app.fetch,
    port,
  });
});

export default app;
