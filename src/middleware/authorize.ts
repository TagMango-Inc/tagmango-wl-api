import { createFactory } from "hono/factory";

import { Response } from "../utils/statuscode";

const factory = createFactory();

/**
 * Role-based route authorization — mirrors what the dashboard UI enforces
 * (read = view-only; write = everything except user management, release and
 * iOS review submission and iOS app transfers;
 * admin = all). Runs after authenticationMiddleware, which sets `userRole`.
 *
 * Closes the hole where any valid token could call any endpoint directly.
 */
const authorizeMiddleware = factory.createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();

  // reads are allowed for every authenticated role
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }

  const role = c.get("userRole") as string | undefined;

  if (role === "admin") {
    await next();
    return;
  }

  const path = c.req.path;

  // own-password change is open to every role (used by the invite flow too)
  const isOwnPasswordChange = path.endsWith("/users/update-password");

  // submitting apps for App Store review is admin-only; scans are read-only
  const isIosReviewSubmit =
    path.startsWith("/wl/ios-review/") && path.endsWith("/submit");

  const adminOnlyArea =
    (path.startsWith("/wl/user-management") && !isOwnPasswordChange) ||
    path.startsWith("/wl/release") ||
    isIosReviewSubmit ||
    // deletes and registers bundle IDs on Apple's side
    path.endsWith("/settings/ios/transfer-to-tagmango");

  if (adminOnlyArea) {
    return c.json(
      { message: "You do not have permission to perform this action" },
      Response.FORBIDDEN,
    );
  }

  if (role === "write") {
    await next();
    return;
  }

  // read role: no mutations
  return c.json(
    { message: "You do not have permission to perform this action" },
    Response.FORBIDDEN,
  );
});

export default authorizeMiddleware;
