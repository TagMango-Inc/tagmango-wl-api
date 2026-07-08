import { createFactory } from "hono/factory";

import { Response } from "../utils/statuscode";

const factory = createFactory();

/**
 * Role-based route authorization — mirrors what the dashboard UI enforces
 * (read = view-only; write = everything except user management and release;
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

  const adminOnlyArea =
    (path.startsWith("/wl/user-management") && !isOwnPasswordChange) ||
    path.startsWith("/wl/release");

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
