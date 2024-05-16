import 'dotenv/config';

import {
  Job,
  Worker,
} from 'bullmq';
import { exec } from 'child_process';
import fs from 'fs-extra';
import {
  ObjectId,
  UpdateFilter,
} from 'mongodb';
import pino from 'pino';

import Mongo from '../../src/database';
import {
  IDeploymentTask,
  IMetaData,
} from '../../src/types/database';
import {
  customhostDeploymentDir,
  githubrepo,
  ROOT_BRANCH,
} from '../constants';
import {
  BuildJobPayloadType,
  JobProgressType,
} from '../types';
import { queueRedisOptions } from './config';

const logger = pino({
  level: "debug",
  msgPrefix: "[ WORKER ] ",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

// import {
// copyAppAssets,
// fixJavaFilesPackageName,
// modifiyFastlaneConfigs,
// modifyPlist,
// modifyXmlFile,
// replaceInFile,
// updateLaunchScreenColor,
// updatePbxproj
// } from './utils';

const { readFile, writeFile } = fs.promises;

const worker = new Worker<BuildJobPayloadType>(
  "buildQueue",
  async (job) => {
    const {
      deploymentId,
      hostId,
      platform,
      name,
      bundle,
      domain,
      color,
      bgColor,
      onesignal_id,
      buildNumber,
      versionName,
    } = job.data;

    const formatedAppName = name.replace(/ /g, "");

    logger.info("Fetching Deployment Details");

    /**
     * Fetching the task names for the deployment
     */
    const results = await Mongo.deployment
      .aggregate([
        {
          $match: {
            _id: new ObjectId(deploymentId),
          },
        },
        {
          $project: {
            _id: 0,
            taskNames: {
              $map: {
                input: "$tasks",
                as: "task",
                in: {
                  id: "$$task.id",
                  name: "$$task.name",
                },
              },
            },
          },
        },
      ])
      .toArray();

    const { taskNames } = results[0] as {
      taskNames: {
        id: string;
        name: string;
      }[];
    };

    /**
      // Define various paths and constants used across multiple steps
    */

    const onesignalExtension = "OneSignalNotificationServiceExtension";
    const domains = ["tagmango.app", domain];
    const androidManifestPath = "./android/app/src/main/AndroidManifest.xml";
    const stringsPath = "./android/app/src/main/res/values/strings.xml";
    const infoPlistPath = `./ios/${formatedAppName}/Info.plist`;
    const entitlementsPath = `./ios/${formatedAppName}/${formatedAppName}.entitlements`;
    const oneSignalEntitlementsPath = `./ios/${onesignalExtension}/${onesignalExtension}.entitlements`;
    const launchScreenPath = `./ios/${formatedAppName}/LaunchScreen.storyboard`;
    const mainActivityPath = `./android/app/src/main/java/${bundle.replace(
      /\./g,
      "/",
    )}/MainActivity.java`;
    const appDelegatePath = `./ios/${formatedAppName}/AppDelegate.mm`;
    const javaFilesPath = `./android/app/src/main/java/${bundle
      .split(".")
      .join("/")}`;
    const drawableFolders = ["hdpi", "mdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
    const removeDrawableFolders = drawableFolders.map(
      (folder) => `rm -rf android/app/src/main/res/drawable-${folder}`,
    );
    const customHostDir = `${customhostDeploymentDir}/${bundle}/${githubrepo}`;

    /**
     * Combining commands with their respective task names and is
     */
    const commands = {
      // step: 1: Fetching lastest changes to root TagMango project ( for testing fetching lastest changes from test-build-m1)
      [taskNames[0].id]: [
        `cd root/${githubrepo}`,
        `git checkout origin/${ROOT_BRANCH}`,
        `git pull origin ${ROOT_BRANCH}`,
      ],
      // step: 2: Copying the lastest root project to deployment/{bundleId} folder
      [taskNames[1].id]: [
        `mkdir -p ${customhostDeploymentDir}/${bundle}`,
        `cp -r root/${githubrepo} ${customhostDeploymentDir}/${bundle}`,
      ],
      // step: 3: Copying the WL assets from WLApps/{formatedName} to deployment/{bundleId}/WLApps/{formatedName}
      [taskNames[2].id]: [
        `cd ${customHostDir}`,
        `mkdir -p icons`,
        `cd icons`,
        `cp ../../../../assets/${hostId}/icon.png .`,
        `cp ../../../../assets/${hostId}/foreground.png .`,
        `cp ../../../../assets/${hostId}/background.png .`,
        `mkdir -p android ios`,
        `npx icon-set-creator create`,
      ],
      //TODO
      // step: 4: Running the pre deployment and bundle script for the deployment/{bundleId} folder
      [taskNames[3].id]: [
        `cd ${customhostDeploymentDir}/${bundle}/${githubrepo}`,
        `npm install`,
        `node ./scripts/app-build.js ${JSON.stringify({ name, bundle, domain, color, bgColor, onesignal_id, buildNumber })}`,
      ],

      // // Step 4: Rename the app and bundle
      // [taskNames[3].id]: [
      //   `cd ${customHostDir}`,
      //   `npx react-native-rename ${name} -b ${bundle}`,
      // ],

      // // Step 5: Fix custom Java files package name issue

      // // Step 6: Clear node_modules and reinstall dependencies
      // [taskNames[5].id]: [
      //   `cd ${customHostDir}`,
      //   `rm -rf node_modules`,
      //   `npm install --reset-cache`,
      // ],

      // //Step 7: Create a production JavaScript bundle for android
      // [taskNames[6].id]: [`cd ${customHostDir}`, `npm run bundle`],

      // // Step 8: Remove old drawable directories
      // [taskNames[7].id]: [`cd ${customHostDir}`, ...removeDrawableFolders],

      // // Step 9: Create a production JavaScript bundle for iOS
      // [taskNames[8].id]: [`cd ${customHostDir}`, `npm run bundle-ios`],

      // // Step 10: Copy the main.jsbundle file to the iOS project
      // [taskNames[9].id]: [
      //   `cd ${customHostDir}`,
      //   `cp ./main.jsbundle ./ios/main.jsbundle`,
      // ],
      //TODO
      // step 11: Running the fastlane build for specific targer platform
      [taskNames[4].id]:
        platform === "android"
          ? [
              `cd ${customHostDir}`,
              `fastlane ${platform} build`,
              `cp -r android/app/build/outputs/bundle/release/app-release.aab ../../../outputs/android/${hostId}.aab`,
              `node ../../../outputs/android-aab.js ${JSON.stringify({ hostId, versionName, buildNumber })}`,
            ]
          : [`cd ${customHostDir}`, `fastlane ${platform} build`],
      // step 12: Running the fastlane upload for specific targer platform
      // TODO
      [taskNames[5].id]: [`cd ${customHostDir}`, `fastlane ${platform} upload`],
      // [taskNames[5].id]: [`cd ${customHostDir}`],
      // step 13: Removing the deployment/{bundleId} folder after successful deployment
      [taskNames[6].id]: [`rm -rf ${customhostDeploymentDir}/${bundle}`],
      // [taskNames[6].id]: [],
    };

    logger.info("Initiated Deployment Process");

    try {
      // Changing deployment status to processing from pending
      await Mongo.deployment.updateOne(
        {
          _id: new ObjectId(deploymentId),
        },
        {
          $set: {
            status: "processing",
            updatedAt: new Date(),
          },
        },
      );

      logger.info("Deployment Status Changed to Processing");

      // executing the tasks
      for (const task of taskNames) {
        await executeTask({
          commands: commands[task.id],
          taskId: task.id,
          taskName: task.name,
          job,
          deploymentId,
          hostId,
        });
      }

      // updating the version details for the target platform after successful deployment
      await updateVersionDetails({ deploymentId, hostId, platform });
    } catch (error) {
      logger.error(error, "Failed to execute Deployment Process");

      // if we are getting any erro (throw error) then we need to remove the deployment/{bundleId} folder
      const task = taskNames.slice(-1)[0];
      await executeTask({
        commands: commands[task.id],
        taskId: task.id,
        taskName: task.name,
        job,
        deploymentId,
        hostId,
      });
      // updating the deployment status to failed
      await Mongo.deployment.updateOne(
        {
          _id: new ObjectId(deploymentId),
        },
        {
          $set: {
            status: "failed",
            updatedAt: new Date(),
          },
        },
      );

      logger.info("Deployment Status Changed to Failed");
    }

    logger.info("Deployment Process Completed");
  },
  {
    connection: queueRedisOptions,
    concurrency: 1,
  },
);

worker.on("stalled", (job) => {
  logger.error(`Job has been stalled ${job}`);
});

logger.info("Worker Started");

(async () => {
  await Mongo.connect();
})();

const executeTask = async ({
  commands,
  taskId,
  taskName,
  job,
  deploymentId,
  hostId,
  onError,
}: {
  commands: string[];
  taskId: string;
  taskName: string;
  job: Job<BuildJobPayloadType, any, string>;
  deploymentId: string;
  hostId: string;
  // will be a async function that will be called if the task is failed
  onError?: () => Promise<void>;
}) => {
  logger.info(`Executing Task [ ${taskName} ]`);

  // sending job progress to sse
  job.updateProgress({
    task: {
      id: taskId,
      name: taskName,
      type: "initialised",
      duration: 0,
    },
    type: "success",
    message: `Initialized task [ ${taskName} ]`,
    timestamp: new Date(),
  } as JobProgressType);

  // updating task status to processing
  await Mongo.deployment.updateOne(
    {
      _id: new ObjectId(deploymentId),
      "tasks.id": taskId,
    },
    {
      $set: {
        "tasks.$.status": "processing",
        updatedAt: new Date(),
      },
    },
  );

  logger.info(`Task [ ${taskName} ] started executing`);

  // started executing the task
  const e = exec(commands.join(" && "), {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 5,
    env: {
      ...process.env,
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
    },
    shell: "/bin/zsh",
  });
  const { stdout, stderr } = e;
  // start time of the task
  const startTime = Date.now();

  let outputLogs: Pick<IDeploymentTask, "logs">["logs"] = [];
  let errorLogs: Pick<IDeploymentTask, "logs">["logs"] = [];

  if (stdout) {
    stdout.on("data", (data) => {
      logger.info(data);

      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
        task: {
          id: taskId,
          name: taskName,
          type: "processing",
          duration: Date.now() - startTime,
        },
        type: "success",
        message: data,
        timestamp: new Date(),
      } as JobProgressType);

      // adding logs to the task
      outputLogs.push({
        message: data,
        type: "success",
        timestamp: new Date(),
      });
    });
  }
  if (stderr) {
    stderr.on("data", (data) => {
      const warningRegex = /\b(?:warn(?:ing)?|deprecated)\b/i;
      logger.error(data);
      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
        task: {
          id: taskId,
          name: taskName,
          type: "processing",
          duration: Date.now() - startTime,
        },
        type: warningRegex.test(data) ? "warning" : "failed",
        message: data,
        timestamp: new Date(),
      } as JobProgressType);

      // adding logs to the task
      errorLogs.push({
        message: data,
        type: "failed",
        timestamp: new Date(),
      });
    });
  }

  // waiting for the task to complete
  // if the task is completed then we will get the code
  const code = await new Promise((resolve, reject) => {
    e.on("close", resolve);
    e.on("error", reject);
  });

  // if the code is 0 then the task is completed successfully
  if (code === 0) {
    // sending job progress to sse
    job.updateProgress({
      task: {
        id: taskId,
        name: taskName,
        type: "success",
        duration: Date.now() - startTime,
      },
      type: "success",
      message: `Task [ ${taskName} ] executed successfully`,
      timestamp: new Date(),
    } as JobProgressType);

    // update the task status to success and add logs to the task
    await Mongo.deployment.updateOne(
      {
        _id: new ObjectId(deploymentId),
        "tasks.id": taskId,
      },
      {
        $set: {
          "tasks.$.status": "success",
          "tasks.$.logs": outputLogs,
          "tasks.$.duration": Date.now() - startTime,
          updatedAt: new Date(),
        },
      },
    );

    logger.info(`Task [ ${taskName} ] executed successfully`);

    // removing aab file from the root project
    // exec(`rm -rf outputs/android/${hostId}.aab`);
  } else {
    // running async callback if provided
    if (onError) {
      await onError();
    }

    // add logs to the task and update the status to failed
    job.updateProgress({
      task: {
        id: taskId,
        name: taskName,
        type: "failed",
        duration: Date.now() - startTime,
      },
      type: "failed",
      message: `Failed to execute task [ ${taskName} ]`,
      timestamp: new Date(),
    } as JobProgressType);

    // update the task status to failed and add logs to the task
    await Mongo.deployment.updateOne(
      {
        _id: new ObjectId(deploymentId),
        "tasks.id": taskId,
      },
      {
        $set: {
          "tasks.$.status": "failed",
          "tasks.$.logs": errorLogs,
          "tasks.$.duration": Date.now() - startTime,
          updatedAt: new Date(),
        },
      },
    );

    logger.error(`Failed to execute task [ ${taskName} ]`);
  }

  // after all updates (success or failed) are done in the database then we can return error
  if (code !== 0) {
    throw new Error(`Failed to execute task [ ${taskName} ]`);
  }

  return code;
};

const updateVersionDetails = async ({
  deploymentId,
  hostId,
  platform,
}: {
  deploymentId: string;
  hostId: string;
  platform: "android" | "ios";
}) => {
  logger.info("Updating Deployment Status after successful deployment");

  try {
    const deployment = await Mongo.deployment.findOne({
      _id: new ObjectId(deploymentId),
    });

    if (!deployment) {
      logger.warn(`Deployment with ID ${deploymentId} not found`);
      return;
    }

    // for deployment success then update the status to success
    // and updating last deployment details for custom host

    await Mongo.deployment.updateOne(
      {
        _id: new ObjectId(deploymentId),
      },
      {
        $set: {
          status: "success",
          updatedAt: new Date(),
        },
      },
    );

    const updateQuery: UpdateFilter<IMetaData> =
      platform === "android"
        ? {
            $set: {
              "androidDeploymentDetails.buildNumber": deployment.buildNumber,
              "androidDeploymentDetails.versionName": deployment.versionName,
            },
          }
        : {
            $set: {
              "iosDeploymentDetails.buildNumber": deployment.buildNumber,
              "iosDeploymentDetails.versionName": deployment.versionName,
            },
          };

    await Mongo.metadata.updateOne({ host: new ObjectId(hostId) }, updateQuery);

    logger.info(
      `Deployment ${deploymentId} status updated to ${deployment.status}`,
    );
  } catch (error) {
    logger.error(
      error,
      "Failed to update Deployment Status after successful deployment",
    );
  }
};
