import { Hono } from 'hono';

import { zValidator } from '@hono/zod-validator';

import AdminUserModel from '../models/adminUser.model';
import {
  createUserSchema,
  roleActionSchema,
} from '../validations/userManagement';

const router = new Hono();

/**
    GET /wl/user-management/users
    Getting all the Dashboard Users
*/
router.get('/users', async (c) => {
  try {
    const allUsers = await AdminUserModel.aggregate([
      {
        $match: {
          customhostDashboardAccess: { $exists: true },
        },
      },
      {
        $project: {
          name: 1,
          email: 1,
          customhostDashboardAccess: 1,
          isRestricted: 1,
        },
      },
    ]);
    return c.json({
      message: 'All Users',
      users: allUsers,
    });
  } catch (error) {
    return c.json({
      message: 'Internal Server Error',
      status: 500,
    });
  }
});

/**
    POST /wl/user-management/users
    Creating a new Dashboard User (Admin, Read, Write)
*/
router.post('/users', zValidator('json', createUserSchema), async (c) => {
  try {
    const user = c.req.valid('json');

    const userExists = await AdminUserModel.findOne({ email: user.email });
    if (userExists) {
      return c.json({
        message: 'User already exists',
        status: 400,
      });
    }
    const createdUser = await AdminUserModel.create({
      name: user.name,
      email: user.email,
      customhostDashboardAccess: {
        role: user.role,
      },
    });
    return c.json(
      {
        message: 'User created successfully',
        user: createdUser,
      },
      {
        status: 201,
        statusText: 'Created',
      }
    );
  } catch (error) {
    return c.json({
      message: 'Internal Server Error',
      status: 500,
    });
  }
});

/** 
    PATCH /wl/user-management/users/:id
    Updating a Dashboard User
*/

router.patch('/users', zValidator('json', roleActionSchema), async (c) => {
  try {
    const { action, userId, role } = c.req.valid('json');

    const user = await AdminUserModel.findById(userId);

    if (!user) {
      return c.json({
        message: 'User not found',
        status: 404,
      });
    }

    if (action && action === 'assign') {
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
    return c.json({
      message: 'Internal Server Error',
      status: 500,
    });
  }
});
/**
    DELETE /wl/user-management/users/:id
    Deleting a Dashboard User
*/

router.delete('/users/:id', async (c) => {
  try {
    const { id } = c.req.param();
    const deletedUser = await AdminUserModel.findByIdAndDelete(id);
    if (!deletedUser) {
      return c.json({
        message: 'User not found',
        status: 404,
      });
    }
    return c.json({
      message: 'User deleted successfully',
      user: deletedUser,
    });
  } catch (error) {
    return c.json({
      message: 'Internal Server Error',
      status: 500,
    });
  }
});

export default router;
