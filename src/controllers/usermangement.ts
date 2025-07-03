import bcrypt from "bcrypt";
import { createFactory } from "hono/factory";
import { sign } from "hono/jwt";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../../src/database";
import { JWTPayloadType } from "../../src/types";
import { Response } from "../../src/utils/statuscode";
import {
  createUserSchema,
  roleActionSchema,
  updatePasswordSchema,
} from "../../src/validations/userManagement";

const factory = createFactory();

/**
    GET /wl/user-management/users
    Getting all the Dashboard Users
*/
const getAllDashboardUsers = factory.createHandlers(async (c) => {
  try {
    const { page, limit, search, role } = c.req.query();
    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 10;
    let SEARCH = search ? (search as string) : "";
    let ROLE = role ? (role as string) : "";

    const payload: JWTPayloadType = c.get("jwtPayload");

    const totalUsers = await Mongo.user.find().toArray();

    const query = {
      ...(ROLE ? { "customhostDashboardAccess.role": ROLE } : {}),
      $or: [
        { name: { $regex: new RegExp(SEARCH, "i") } },
        { email: { $regex: new RegExp(SEARCH, "i") } },
      ],
      _id: { $ne: new ObjectId(payload.id) },
    };

    const users = await Mongo.user
      .aggregate([
        {
          $match: query,
        },
        {
          $project: {
            _id: 1,
            name: 1,
            email: 1,
            role: "$customhostDashboardAccess.role",
            isRestricted: "$customhostDashboardAccess.isRestricted",
            isEmailVerified: {
              $cond: {
                if: { $eq: [{ $type: "$password" }, "string"] },
                then: true,
                else: false,
              },
            },
            createdAt: 1,
            updatedAt: 1,
          },
        },
        {
          $sort: { updatedAt: -1 },
        },
        {
          $skip: (PAGE - 1) * LIMIT,
        },
        {
          $limit: LIMIT,
        },
      ])
      .toArray();

    const totalSearchResults = await Mongo.user.find(query).toArray();

    const hasNextPage = totalSearchResults.length > PAGE * LIMIT;

    return c.json(
      {
        message: "All Users",
        result: {
          users,
          totalSearchResults: totalSearchResults.length,
          totalUsers: totalUsers.length,
          currentPage: PAGE,
          nextPage: hasNextPage ? PAGE + 1 : -1,
          limit: LIMIT,
          hasNext: hasNextPage,
        },
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      {
        message: "Internal Server Error",
      },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

/**
    POST /wl/user-management/users
    Creating a new Dashboard User (Admin, Read, Write)
*/
const createNewDashboardUser = factory.createHandlers(
  zValidator("json", createUserSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");

      const userExists = await Mongo.user.findOne({ email: body.email });
      if (userExists) {
        // add customhostDashboardAccess to the admin user to give access to appzap
        await Mongo.user.updateOne(
          { _id: userExists._id },
          {
            $set: {
              "customhostDashboardAccess.role": body.role,
              "customhostDashboardAccess.isRestricted": false,
            },
          },
        );

        return c.json(
          {
            message: "User created successfully",
            result: {
              user: {
                _id: userExists._id,
                email: userExists.email,
                name: userExists.name,
                role: body.role,
                isRestricted: false,
                isEmailVerified: true,
              },
            },
          },
          Response.CREATED,
        );
      }

      return c.json(
        {
          message: "Use admin password to create a new user",
        },
        Response.BAD_REQUEST,
      );
    } catch (error) {
      return c.json(
        {
          message: "Internal Server Error",
        },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
    PATCH /wl/user-management/users/:id
    Updating a Dashboard User
*/
const updateDashboardUser = factory.createHandlers(
  zValidator("json", roleActionSchema),
  async (c) => {
    try {
      const { action, userId, role } = c.req.valid("json");

      const updatedUser = await Mongo.user.findOneAndUpdate(
        {
          _id: new ObjectId(userId),
        },
        {
          $set: {
            "customhostDashboardAccess.isRestricted":
              action === "assign" ? false : true,
            "customhostDashboardAccess.role": role ?? "read",
          },
        },
      );

      return c.json(
        {
          message: `${action}ed access for user successfully`,
          result: {
            user: {
              _id: updatedUser?._id,
              role,
            },
          },
        },
        Response.OK,
      );
    } catch (error) {
      return c.json(
        {
          message: "Internal Server Error",
        },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
    PATCH /wl/user-management/users/:id/update-password
    Updating a Dashboard User Password
*/
const updateDashboardUserPassword = factory.createHandlers(
  zValidator("json", updatePasswordSchema),
  async (c) => {
    try {
      const jwtPayload: JWTPayloadType = c.get("jwtPayload");

      const userId = jwtPayload.id;

      const { password } = c.req.valid("json");

      const user = await Mongo.user.findOne({
        _id: new ObjectId(userId),
      });

      if (!user) {
        return c.json(
          {
            message: "User not found",
          },
          Response.NOT_FOUND,
        );
      }

      // use bcrypt to hash the password

      const salt = await bcrypt.genSalt(5);

      const hashedPassword = await bcrypt.hash(password, salt);

      user.password = hashedPassword;

      const updatedUser = await Mongo.user.findOneAndUpdate(
        {
          _id: new ObjectId(userId),
        },
        {
          $set: {
            password: hashedPassword,
          },
        },
      );

      const payload: JWTPayloadType = {
        id: user._id.toString(),
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + 60 * (60 * 24 * 15), // 15 days
      };

      const secret = process.env.JWT_SECRET as string;

      const token = await sign(payload, secret);

      return c.json(
        {
          message: "Password updated successfully",
          result: {
            user: {
              _id: updatedUser?._id,
            },
            token,
          },
        },
        Response.OK,
      );
    } catch (error) {
      return c.json(
        {
          message: "Internal Server Error",
        },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

// api to get the current user
/**
 * GET /wl/user-management/users/me
 * Get the current user
 */
const getCurrentUser = factory.createHandlers(async (c) => {
  try {
    const { id } = c.get("jwtPayload");
    const user = await Mongo.user.findOne({
      _id: new ObjectId(id),
    });
    if (!user) {
      return c.json(
        {
          message: "User not found",
        },
        Response.NOT_FOUND,
      );
    }
    return c.json(
      {
        message: "Current User",
        result: {
          user: {
            _id: user._id,
            email: user.email,
            name: user.name,
            role: user.customhostDashboardAccess.role,
            isRestricted: user.customhostDashboardAccess.isRestricted,
          },
        },
      },
      Response.OK,
    );
  } catch (error) {
    return c.json(
      {
        message: "Internal Server Error",
      },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

export {
  createNewDashboardUser,
  getAllDashboardUsers,
  getCurrentUser,
  updateDashboardUser,
  updateDashboardUserPassword,
};
