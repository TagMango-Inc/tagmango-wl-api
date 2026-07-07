import bcrypt from "bcrypt";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";

import { zValidator } from "@hono/zod-validator";

import Mongo from "../../src/database";
import { JWTPayloadType } from "../../src/types";
import { issueTokenPair } from "../utils/authTokens";
import { escapeRegExp } from "../utils/regex";
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

    const searchRegex = new RegExp(escapeRegExp(SEARCH), "i");
    const query = {
      ...(ROLE ? { "customhostDashboardAccess.role": ROLE } : {}),
      ...(SEARCH
        ? {
            $or: [
              { name: { $regex: searchRegex } },
              { email: { $regex: searchRegex } },
            ],
          }
        : {}),
      _id: { $ne: new ObjectId(payload.id) },
    };

    const [totalUsersCount, totalSearchResultsCount, users] = await Promise.all([
      Mongo.user.countDocuments({}),
      Mongo.user.countDocuments(query),
      Mongo.user
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
        .toArray(),
    ]);

    const hasNextPage = totalSearchResultsCount > PAGE * LIMIT;

    return c.json(
      {
        message: "All Users",
        result: {
          users,
          totalSearchResults: totalSearchResultsCount,
          totalUsers: totalUsersCount,
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

      const payload: JWTPayloadType = c.get("jwtPayload");
      if (userId === payload.id) {
        return c.json(
          { message: "You cannot modify your own access" },
          Response.FORBIDDEN,
        );
      }

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

      // use bcrypt to hash the password
      const salt = await bcrypt.genSalt(5);

      const hashedPassword = await bcrypt.hash(password, salt);

      const updatedUser = await Mongo.user.findOneAndUpdate(
        {
          _id: new ObjectId(userId),
        },
        {
          $set: {
            password: hashedPassword,
          },
        },
        { returnDocument: "after", projection: { email: 1 } },
      );

      if (!updatedUser) {
        return c.json(
          {
            message: "User not found",
          },
          Response.NOT_FOUND,
        );
      }

      const { token, refreshToken } = await issueTokenPair({
        _id: updatedUser._id,
        email: updatedUser.email,
      });

      return c.json(
        {
          message: "Password updated successfully",
          result: {
            user: {
              _id: updatedUser?._id,
            },
            token,
            refreshToken,
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
