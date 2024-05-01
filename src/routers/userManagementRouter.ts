import 'dotenv/config';

import bcrypt from 'bcrypt';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { JWTPayloadType } from 'src/types';
import sendMail from 'src/utils/sendMail';

import { zValidator } from '@hono/zod-validator';

import AdminUserModel from '../models/adminUser.model';
import {
  createUserSchema,
  roleActionSchema,
  updatePasswordSchema,
} from '../validations/userManagement';

const router = new Hono();

/**
    GET /wl/user-management/users
    Getting all the Dashboard Users
*/
router.get("/users", async (c) => {
  try {
    const allUsers = await AdminUserModel.aggregate([
      {
        $match: {
          isRestricted: { $ne: true },
        },
      },
      {
         $project: {
          _id: 1,
          name: 1,
          email: 1,
          role: "$customhostDashboardAccess.role",
          isRestricted: "$customhostDashboardAccess.isRestricted"
        }
      },
    ]);
    return c.json({
      message: "All Users",
      users: allUsers,
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
router.post("/users", zValidator("json", createUserSchema), async (c) => {
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
});

/** 
    PATCH /wl/user-management/users/:id
    Updating a Dashboard User
*/

router.patch("/users", zValidator("json", roleActionSchema), async (c) => {
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
});
/**
    PATCH /wl/user-management/users/:id/update-password
    Updating a Dashboard User Password
*/

router.patch(
  "/users/update-password",
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
    DELETE /wl/user-management/users/:id
    Deleting a Dashboard User
*/

router.delete("/users/:id", async (c) => {
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
router.post("/users/:id/resend-verification-email", async (c) => {
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
router.get("/users/me", async (c) => {
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

export default router;
