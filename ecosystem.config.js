const { exec } = require("child_process");

module.exports = {
  apps: [
    {
      name: "tagmango-api",
      script: "dist/src/index.js",
      instances: 1,
      autorestart: true,
      watch: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        MONGO_URI:
          "mongodb+srv://root:ddMOVpFOLD5S3DvH@tagmango-production.4rzm3.mongodb.net/tagmango-production?retryWrites=true&w=majority&readPreference=secondaryPreferred",
        GMAIL_APP_PASSWORD: "vctp gnkj vtbm fsze",
        JWT_SECRET: "asdfasdfapsdfpoas9dpf9auspq9pqwre9q8we9vsanvlnaisdvasd",
      },
    },
    {
      name: "tagmango-worker",
      script: "dist/src/job/worker.js",
      instances: 4,
      autorestart: true,
      watch: true,
      max_memory_restart: "1G",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        MONGO_URI:
          "mongodb+srv://root:ddMOVpFOLD5S3DvH@tagmango-production.4rzm3.mongodb.net/tagmango-production?retryWrites=true&w=majority&readPreference=secondaryPreferred",

        MATCH_PASSWORD: "aayush123",
        FASTLANE_PASSWORD: "KylixMedusa@19122001",
        FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD: "ybut-zkny-pohm-sgda",
      },
    },
  ],
};
