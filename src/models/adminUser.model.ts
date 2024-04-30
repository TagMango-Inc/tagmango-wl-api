import { Document, model, Schema } from 'mongoose';

export interface IAdminUser extends Document {
  approved: boolean; // true
  email: string;
  name: string;
  password: string;
  allowedFunctions: [string]; // optional
  sensitiveAllowedActions: [string]; // optional
  isRestricted: boolean; // optional
  customhostDashboardAccess: {
    role: string;
    isRestricted: boolean;
  };
}

const adminUserSchema = new Schema<IAdminUser>(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    password: {
      type: String,
    },
    approved: {
      type: Boolean,
      default: true,
    },
    allowedFunctions: {
      type: [String],
      default: [],
    },
    isRestricted: {
      type: Boolean,
      default: false,
    },
    customhostDashboardAccess: {
      role: {
        type: String,
        required: true,
        enum: ['admin', 'write', 'read'],
        default: 'read',
      },
      isRestricted: {
        type: Boolean,
        default: true,
        required: true,
      },
      active: {
        type: Boolean,
        default: false,
      },
    },
  },
  { timestamps: true }
);

const AdminUserModel = model<IAdminUser>('adminusers', adminUserSchema);
export default AdminUserModel;
