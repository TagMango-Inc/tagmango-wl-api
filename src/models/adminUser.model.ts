import { Document, model, Schema } from 'mongoose';

export interface IAdminUser extends Document {
  approved: Boolean; // true
  email: String;
  name: String;
  password: String;
  allowedFunctions: [String]; // optional
  sensitiveAllowedActions: [String]; // optional
  isRestricted: Boolean; // optional
  customhostDashboardAccess: {
    role: String;
    isRestricted: Boolean;
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
