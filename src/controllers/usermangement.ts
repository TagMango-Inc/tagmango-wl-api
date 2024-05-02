import bcrypt from "bcrypt";
import { createFactory } from "hono/factory";
import { sign } from "hono/jwt";
import AdminUserModel from "src/models/adminUser.model";
import { JWTPayloadType } from "src/types";
import sendMail from "src/utils/sendMail";
import {
  createUserSchema,
  roleActionSchema,
  updatePasswordSchema,
} from "src/validations/userManagement";

import { zValidator } from "@hono/zod-validator";

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

    const totalUsers = await AdminUserModel.find({
      isRestricted: { $ne: true },
    }).countDocuments();

    const users = await AdminUserModel.aggregate([
      {
        $match: {
          isRestricted: { $ne: true },
          "customhostDashboardAccess.role": ROLE ? ROLE : { $ne: null },
          $or: [
            { name: { $regex: new RegExp(SEARCH, "i") } },
            { email: { $regex: new RegExp(SEARCH, "i") } },
          ],
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          role: "$customhostDashboardAccess.role",
          isRestricted: "$customhostDashboardAccess.isRestricted",
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
    ]);

    const totalSearchResults = await AdminUserModel.find({
      isRestricted: { $ne: true },
      $or: [
        { name: { $regex: new RegExp(SEARCH, "i") } },
        { email: { $regex: new RegExp(SEARCH, "i") } },
      ],
    }).countDocuments();

    const hasNextPage = totalSearchResults > PAGE * LIMIT;

    return c.json({
      message: "All Users",
      result: {
        users,
        totalSearchResults,
        totalUsers,
        currentPage: PAGE,
        nextPage: hasNextPage ? PAGE + 1 : -1,
        limit: LIMIT,
        hasNext: hasNextPage,
      },
    });
  } catch (error) {
    return c.json(
      {
        message: "Internal Server Error",
      },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
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
      const user = c.req.valid("json");

      const userExists = await AdminUserModel.findOne({ email: user.email });
      if (userExists) {
        return c.json({
          message: "User already exists",
          status: 400,
        });
      }
      const createdUser = await AdminUserModel.create({
        name: user.name,
        email: user.email,
        customhostDashboardAccess: {
          role: user.role,
          isRestricted: false,
        },
      });

      const payload: JWTPayloadType = {
        id: createdUser._id,
        email: createdUser.email,
        exp: Math.floor(Date.now() / 1000) + 60 * (60 * 24 * 15), // 15 days
      };

      const secret = process.env.JWT_SECRET as string;

      const authToken = sign(payload, secret);

      // Send an email with the authToken to the user
      sendMail({
        recipient: createdUser.email,
        subject: "Welcome to WL Dashboard",
        text: `Here is your authToken: ${authToken}`,
      });

      return c.json(
        {
          message: "User created successfully",
          user: createdUser,
        },
        {
          status: 201,
          statusText: "Created",
        },
      );
    } catch (error) {
      return c.json(
        {
          message: "Internal Server Error",
        },
        {
          status: 500,
          statusText: "Internal Server Error",
        },
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

      const user = await AdminUserModel.findById(userId);

      if (!user) {
        return c.json(
          {
            message: "User not found",
          },
          {
            status: 404,
            statusText: "Not Found",
          },
        );
      }

      if (action && action === "assign") {
        user.customhostDashboardAccess.isRestricted = false;
      } else {
        user.customhostDashboardAccess.isRestricted = true;
      }

      if (role) {
        user.customhostDashboardAccess.role = role;
      }

      const updatedUser = await user.save();

      return c.json({
        message: `${action}ed access for user successfully`,
        user: updatedUser,
      });
    } catch (error) {
      console.log(error);
      return c.json(
        {
          message: "Internal Server Error",
        },
        {
          status: 500,
          statusText: "Internal Server Error",
        },
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
      const { password, userId } = c.req.valid("json");

      const user = await AdminUserModel.findById(userId);

      if (!user) {
        return c.json(
          {
            message: "User not found",
          },
          {
            status: 404,
            statusText: "Not Found",
          },
        );
      }

      // use bcrypt to hash the password

      const salt = await bcrypt.genSalt(5);

      console.log(salt);

      const hashedPassword = await bcrypt.hash(password, salt);

      user.password = hashedPassword;

      const updatedUser = await user.save();

      const payload: JWTPayloadType = {
        id: user._id,
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + 60 * (60 * 24 * 15), // 15 days
      };

      const secret = process.env.JWT_SECRET as string;

      const token = await sign(payload, secret);

      return c.json(
        {
          message: "Password updated successfully",
          user: {
            _id: updatedUser._id,
            email: updatedUser.email,
            name: updatedUser.name,
            role: updatedUser.customhostDashboardAccess.role,
          },
          token,
        },
        {
          status: 200,
          statusText: "OK",
        },
      );
    } catch (error) {
      return c.json(
        {
          message: "Internal Server Error",
        },
        {
          status: 500,
          statusText: "Internal Server Error",
        },
      );
    }
  },
);

/**
    DELETE /wl/user-management/users/:id
    Deleting a Dashboard User
*/
const deleteDashboardUser = factory.createHandlers(async (c) => {
  try {
    const { id } = c.req.param();
    const deletedUser = await AdminUserModel.findByIdAndDelete(id);
    if (!deletedUser) {
      return c.json(
        {
          message: "User not found",
        },
        {
          status: 404,
          statusText: "Not Found",
        },
      );
    }
    return c.json({
      message: "User deleted successfully",
      user: deletedUser,
    });
  } catch (error) {
    return c.json(
      {
        message: "Internal Server Error",
      },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
    );
  }
});

/**
 * POST /wl/user-management/users/:id/resend-verification-email
 * Resend Auth Token to the User
 */
const resendEmailVerification = factory.createHandlers(async (c) => {
  try {
    const { id } = c.req.param();
    const user = await AdminUserModel.findById(id);
    if (!user) {
      return c.json(
        {
          message: "User not found",
        },
        {
          status: 404,
          statusText: "Not Found",
        },
      );
    }

    const payload: JWTPayloadType = {
      id: user._id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * (60 * 24 * 15), // 15 days
    };

    const secret = process.env.JWT_SECRET as string;

    const authToken = sign(payload, secret);

    // Send an email with the authToken to the user
    sendMail({
      recipient: user.email,
      subject: "Welcome to WL Dashboard",
      text: `Here is your authToken: ${authToken}`,
    });

    return c.json({
      message: "Auth Token resent successfully",
    });
  } catch (error) {
    return c.json(
      {
        message: "Internal Server Error",
      },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
    );
  }
});

// api to get the current user
/**
 * GET /wl/user-management/users/me
 * Get the current user
 */
const getCurrentUser = factory.createHandlers(async (c) => {
  try {
    const { id } = c.get("jwtPayload");
    const user = await AdminUserModel.findOne({
      _id: id,
      isRestricted: { $ne: true },
    });
    if (!user) {
      return c.json(
        {
          message: "User not found",
        },
        {
          status: 404,
          statusText: "Not Found",
        },
      );
    }
    return c.json({
      message: "Current User",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.customhostDashboardAccess.role,
      },
    });
  } catch (error) {
    return c.json(
      {
        message: "Internal Server Error",
      },
      {
        status: 500,
        statusText: "Internal Server Error",
      },
    );
  }
});

export {
  createNewDashboardUser,
  deleteDashboardUser,
  getAllDashboardUsers,
  getCurrentUser,
  resendEmailVerification,
  updateDashboardUser,
  updateDashboardUserPassword,
};
