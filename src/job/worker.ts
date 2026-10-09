import "dotenv/config";

import { DelayedError, Job, Worker } from "bullmq";
import { execFile, spawn } from "child_process";
import fs from "fs-extra";
import { ObjectId, UpdateFilter } from "mongodb";
import os from "os";
import pino from "pino";

import Mongo from "../../src/database";
import { IDeploymentTask, IMetaData } from "../../src/types/database";
import { customhostDeploymentDir, githubrepo } from "../constants";
import { BuildJobPayloadType, JobProgressType } from "../types";
import {
  clearActiveTask,
  consumeCancelRequest,
  isCancelRequested,
  registerActiveTask,
  startCancellationListener,
} from "./cancellation";
import { queueRedisOptions } from "./config";
import { hashScreenshots, uploadedHashField } from "./screenshotUploads";
import { createTaskPerf, diskFreeGb, instrumentCommands } from "./taskPerf";
import {
  DEPLOYMENT_TRASH,
  GEM_CACHE_DIR,
  purgeTrashInBackgroundCommand,
  shutdownSimulatorsCommand,
  trashCommand,
  trashStaleEntriesCommand,
  XCODE_TRASH,
} from "../utils/trash";

/** thrown by executeTask when the task's process died to a user cancel —
 *  lets the task loop distinguish "stop quietly" from a real failure */
class DeploymentCancelledError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment ${deploymentId} cancelled by user`);
    this.name = "DeploymentCancelledError";
  }
}

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

// A full disk fails every queued job within seconds (1,771 deployments on
// 23 and 26 Sep 2026). Below this floor a job is put back and the worker
// pauses instead. An Android build needs ~9 GB while it runs.
const MIN_FREE_DISK_GB = Number(process.env.WL_MIN_FREE_DISK_GB ?? 40);
// Xcode's compilation cache (CompilationCache.noindex) grows with every new
// release / pod version and has no size limit of its own. Past this it is
// moved to trash between builds and refills on the next iOS build.
const XCODE_CACHE_MAX_GB = Number(process.env.WL_XCODE_CACHE_MAX_GB ?? 25);
const LOW_DISK_RETRY_MS = 10 * 60 * 1000;
let lowDiskPausedUntil = 0;

/** runs between jobs (one at a time), so nothing is using the cache */
const capXcodeCompilationCache = () =>
  new Promise<void>((resolve) => {
    const cas = `${os.homedir()}/Library/Developer/Xcode/DerivedData/CompilationCache.noindex`;
    execFile("du", ["-sk", cas], (error, stdout) => {
      const gb = error ? 0 : Number(stdout.split("\t")[0]) / 1024 ** 2;
      if (gb <= XCODE_CACHE_MAX_GB) return resolve();
      logger.info(`Xcode compilation cache at ${gb.toFixed(1)} GB (cap ${XCODE_CACHE_MAX_GB} GB): moving it to trash`);
      execFile(
        "/bin/zsh",
        ["-c", `mkdir -p ${XCODE_TRASH} && mv ${cas} ${XCODE_TRASH}/CompilationCache-$(date +%s)`],
        () => resolve(),
      );
    });
  });

/** frees what is already in trash; nothing is building, so at normal priority */
const purgeTrashNow = () =>
  new Promise<void>((resolve) =>
    execFile(
      "/bin/zsh",
      ["-c", `rm -rf ${DEPLOYMENT_TRASH}/*(DN) ${XCODE_TRASH}/*(DN)`],
      () => resolve(),
    ),
  );

(async () => {
  Mongo.connect()
    .then(() => {
      const worker = new Worker<BuildJobPayloadType>(
        "buildQueue",
        async (job, token) => {
          const {
            deploymentId,
            hostId,
            platform,
            name,
            appName,
            bundle,
            domain,
            color,
            bgColor,
            onesignal_id,
            buildNumber,
            versionName,
            appleId,

            androidStoreSettings,

            iosStoreSettings,
            iosInfoSettings,
            iosReviewSettings,

            generateIAPScreenshot,

            androidDeveloperAccount,
            iosDeveloperAccount,
            isFirstDeployment,
          } = job.data;

          if (platform === "ios") await capXcodeCompilationCache();

          let freeGb = await diskFreeGb();
          if (freeGb !== null && freeGb < MIN_FREE_DISK_GB) {
            await purgeTrashNow();
            freeGb = await diskFreeGb();
          }
          if (freeGb !== null && freeGb < MIN_FREE_DISK_GB) {
            logger.error(
              `Only ${freeGb} GB free (floor ${MIN_FREE_DISK_GB} GB): putting deployment ${deploymentId} back and pausing for ${LOW_DISK_RETRY_MS / 60000} min`,
            );
            await job.moveToDelayed(Date.now() + LOW_DISK_RETRY_MS, token);
            if (Date.now() > lowDiskPausedUntil) {
              lowDiskPausedUntil = Date.now() + LOW_DISK_RETRY_MS;
              worker.pause(true);
              setTimeout(() => worker.resume(), LOW_DISK_RETRY_MS);
            }
            throw new DelayedError();
          }

          const formatedAppName = name.replace(/ /g, "");

          // find the paths to remove after successful deployment
          // this ensures space is freed up after successful deployment
          const username = os.userInfo().username;
          const archivesPath = `/Users/${username}/Library/Developer/Xcode/Archives`;
          const derivedDataPath = `/Users/${username}/Library/Developer/Xcode/DerivedData`;
          const gymLogsPath = `/Users/${username}/Library/Logs/gym`;

          // get screenshots values from DB as the job starts instead of getting a copy when the job is created
          // assumption: only 1 deployment is running at a time, so we can get the latest values from the DB
          // NOTE: do not increase max concurrency of the worker to more than 1

          const metadata = await Mongo.metadata.findOne({
            host: new ObjectId(hostId),
          });

          const androidScreenshots = metadata?.androidScreenshots;
          const iosScreenshots = metadata?.iosScreenshots;
          const androidFeatureGraphic = metadata?.androidFeatureGraphic;

          const isAndroidScreenshotsAvailable =
            androidScreenshots && androidScreenshots?.length > 0;
          const isIosScreenshotsAvailable =
            iosScreenshots && iosScreenshots?.iphone_65?.length > 0;
          const isFeatureGraphicAvailable =
            androidFeatureGraphic && androidFeatureGraphic?.length > 0;

          logger.info("Fetching Deployment Details");

          const releaseBuffer = await fs.promises.readFile(
            `./data/release.json`,
            "utf-8",
          );
          const releaseDetails = JSON.parse(releaseBuffer) as {
            versionName: string;
            buildNumber: number;
          };

          let privateKey = null;
          if (platform === "ios") {
            privateKey = await fs.promises.readFile(
              `./developer_accounts/ios/${iosDeveloperAccount?._id}/asc_api_pk.p8`,
              "base64",
            );
          }

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
                        status: "$$task.status",
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
              status: string;
            }[];
          };

          const customHostAppDir = `${customhostDeploymentDir}/${bundle}/${githubrepo}`;

          // Check if pre-built Detox app exists for this version
          const preBuiltDetoxAppPath = `builds/detox/${releaseDetails.versionName}/TagMango.app`;
          const isPreBuiltDetoxAppAvailable =
            fs.existsSync(preBuiltDetoxAppPath);

          if (isPreBuiltDetoxAppAvailable) {
            logger.info(
              `Using pre-built Detox app from ${preBuiltDetoxAppPath}`,
            );
          } else {
            logger.info(
              "Pre-built Detox app not found, will build from scratch",
            );
          }

          /**
           * Combining commands with their respective task names and is
           */
          const commands = {
            // step: 1: Fetching lastest changes to root TagMango project ( for testing fetching lastest changes from test-build-m1)
            [taskNames[0].id]: [
              `cd root/${githubrepo}`,
              `git checkout main`,
              `git reset --hard origin/main`,
              `git fetch --all`,
            ],
            // step: 2: Copying the lastest root project to deployment/{bundleId} folder
            [taskNames[1].id]: [
              // a leftover folder from an earlier attempt is moved aside, not
              // deleted inline (see utils/trash)
              trashCommand(`${customhostDeploymentDir}/${bundle}`, DEPLOYMENT_TRASH),
              `mkdir -p ${customhostDeploymentDir}/${bundle}`,
              `cp -r root/${githubrepo} ${customhostDeploymentDir}/${bundle}`,
              `cd ${customHostAppDir}`,
              `git fetch --all`,
              `git checkout v/${releaseDetails.versionName}`,
              `git pull origin v/${releaseDetails.versionName}`,
              // gems go to one shared folder per Ruby version + Gemfile.lock
              // instead of vendor/bundle in every workspace (~18 s per
              // deployment). Set in this workspace's .bundle/config: the
              // repo's local config would win over a BUNDLE_PATH env var.
              // touch marks the folder as used; the cleanup cron removes
              // folders unused for GEM_CACHE_RETENTION_DAYS.
              `source ~/.zshrc && gems="${GEM_CACHE_DIR}/ruby-$(ruby -e 'print RUBY_VERSION')-$(shasum -a 256 Gemfile.lock | cut -c1-16)" && mkdir -p "$gems" && touch "$gems" && bundle config set --local path "$gems" > /dev/null`,
            ],
            // step: 3: Copying the WL assets from WLApps/{formatedName} to deployment/{bundleId}/WLApps/{formatedName}
            [taskNames[2].id]: [
              `node ./scripts/create-icons.js ${hostId} ${bundle}`,
            ],
            // Generating screenshots
            // Cases
            // 1. Screenshots are available and generateIAPScreenshot is false -> will not run the task
            // 2. Screenshots are available and generateIAPScreenshot is true -> will run the task
            // 3. Screenshots are not available -> Run task only if its platform screenshots are not available
            // 4. If pre-built Detox app is available, use it instead of building from scratch
            [taskNames[3].id]:
              isAndroidScreenshotsAvailable &&
              isIosScreenshotsAvailable &&
              isFeatureGraphicAvailable &&
              !generateIAPScreenshot
                ? [`echo "Screenshots are available"`]
                : isAndroidScreenshotsAvailable &&
                    isFeatureGraphicAvailable &&
                    platform === "android" &&
                    !generateIAPScreenshot
                  ? [`echo "Android screenshots are available"`]
                  : isIosScreenshotsAvailable &&
                      platform === "ios" &&
                      !generateIAPScreenshot
                    ? [`echo "iOS screenshots are available"`]
                    : isPreBuiltDetoxAppAvailable
                      ? [
                          // Use pre-built Detox app (skips bundle install, pod install, detox build)
                          `cd ${customHostAppDir}`,
                          `echo "Removing node_modules"`,
                          `rm -rf node_modules`,
                          `echo "Using Node Version"`,
                          `node -v`,
                          `echo "Reinstalling node_modules"`,
                          `npm install --include=dev --prefer-offline --no-audit --no-fund`,
                          `echo "Using ruby version"`,
                          `source ~/.zshrc && ruby -v`,
                          `echo "Using bundle version"`,
                          `source ~/.zshrc && bundle --version`,
                          `echo "Installing bundle"`,
                          `source ~/.zshrc && bundle install`,
                          `echo "Using pre-built Detox app from builds/detox/${releaseDetails.versionName}"`,
                          `mkdir -p ios/build/Build/Products/Release-iphonesimulator`,
                          `cp -r ../../../builds/detox/${releaseDetails.versionName}/TagMango.app ios/build/Build/Products/Release-iphonesimulator/`,
                          `echo "Removing artifacts"`,
                          `rm -rf artifacts`,
                          `echo "Renaming app"`,
                          `${generateIAPScreenshot === true ? "node ./scripts/app-screenshots.js --generateIAPScreenshot" : 'echo  "IAP Screenshot"'}`,
                          `node ./scripts/app-screenshots.js --rename "${appName}"`,
                          `echo "Running e2e tests"`,
                          `detox test --configuration ios.sim.release --artifacts-location artifacts/`,
                          `echo "Generating screenshots"`,
                          `node ./scripts/app-screenshots.js --config ${JSON.stringify(
                            {
                              hostId,
                              domain,
                              appName,
                              androidScreenshots:
                                JSON.stringify(androidScreenshots),
                              iosScreenshots: JSON.stringify(iosScreenshots),
                              androidFeatureGraphic: androidFeatureGraphic,
                              generateIAPScreenshot,
                            },
                          )}`,
                          // Detox leaves the simulator booted (found running for 3 days)
                          shutdownSimulatorsCommand(),
                        ]
                      : [
                          // Full build from scratch (fallback when no pre-built app)
                          `cd ${customHostAppDir}`,
                          `echo "Removing node_modules"`,
                          `rm -rf node_modules`,
                          `echo "Using Node Version"`,
                          `node -v`,
                          `echo "Reinstalling node_modules"`,
                          `npm install --include=dev --prefer-offline --no-audit --no-fund`,
                          `echo "Using ruby version"`,
                          `source ~/.zshrc && ruby -v`,
                          `echo "Using bundle version"`,
                          `source ~/.zshrc && bundle --version`,
                          `echo "Installing bundle"`,
                          `source ~/.zshrc && bundle install`,
                          `echo "Using pod version"`,
                          `source ~/.zshrc && bundle exec pod --version`,
                          `echo "Installing pods"`,
                          `source ~/.zshrc && bundle exec "NO_FLIPPER=1 pod install --project-directory=ios"`,
                          `echo "Building app for e2e testing"`,
                          `detox build --configuration ios.sim.release | xcbeautify`,
                          `echo "Removing artifacts"`,
                          `rm -rf artifacts`,
                          `echo "Renaming app"`,
                          `${generateIAPScreenshot === true ? "node ./scripts/app-screenshots.js --generateIAPScreenshot" : 'echo  "IAP Screenshot"'}`,
                          `node ./scripts/app-screenshots.js --rename "${appName}"`,
                          `echo "Running e2e tests"`,
                          `detox test --configuration ios.sim.release --artifacts-location artifacts/`,
                          `echo "Generating screenshots"`,
                          `node ./scripts/app-screenshots.js --config ${JSON.stringify(
                            {
                              hostId,
                              domain,
                              appName,
                              androidScreenshots:
                                JSON.stringify(androidScreenshots),
                              iosScreenshots: JSON.stringify(iosScreenshots),
                              androidFeatureGraphic: androidFeatureGraphic,
                              generateIAPScreenshot,
                            },
                          )}`,
                          // Detox leaves the simulator booted (found running for 3 days)
                          shutdownSimulatorsCommand(),
                        ],
            [taskNames[4].id]: [
              `node ./scripts/create-metadata.js ${JSON.stringify({
                hostId,
                rootPath: `${customHostAppDir}`,
                fastlanePath: `${customHostAppDir}/fastlane`,
                androidStoreSettings: JSON.stringify(androidStoreSettings),
                iosStoreSettings: JSON.stringify(iosStoreSettings),
                iosInfoSettings: JSON.stringify(iosInfoSettings),
                iosReviewSettings: JSON.stringify(iosReviewSettings),
                androidScreenshots: isAndroidScreenshotsAvailable
                  ? JSON.stringify(androidScreenshots)
                  : null,
                iosScreenshots: isIosScreenshotsAvailable
                  ? JSON.stringify(iosScreenshots)
                  : null,
                androidFeatureGraphic: isFeatureGraphicAvailable
                  ? androidFeatureGraphic
                  : null,
                androidDeveloperAccount: JSON.stringify(
                  androidDeveloperAccount ?? {},
                ),
              })}`,
            ],
            // step: 4: Running the pre deployment and bundle script for the deployment/{bundleId} folder
            [taskNames[5].id]: [
              `cd ${customHostAppDir}`,
              `npm install --include=dev --prefer-offline --no-audit --no-fund`,
              `node ./scripts/app-build.js ${JSON.stringify({
                name,
                bundle,
                domain,
                color,
                bgColor,
                onesignal_id,
                buildNumber,
                platform,
                androidDeveloperAccount: JSON.stringify(
                  androidDeveloperAccount ?? {},
                ),
                iosDeveloperAccount: JSON.stringify(iosDeveloperAccount ?? {}),
              })}`,
            ],

            [taskNames[6].id]:
              platform === "android"
                ? [`echo "Skipping this step for android"`]
                : isFirstDeployment
                  ? [
                      // node_modules is already installed by the pre-deploy task
                      `cd ${customHostAppDir}`,
                      // create ios apps on apple dev center and app store connect, skips if already created
                      `source ~/.zshrc && bundle exec fastlane ios create`,
                      // create app group for ios bundle, skips if already created
                      `source ~/.zshrc && bundle exec fastlane produce group -g group.${bundle}.onesignal -n "group ${bundle.split(".").join(" ")} onesignal"`,
                      // associate bundle with app group, skips if already associated
                      `source ~/.zshrc && bundle exec fastlane produce associate_group -a ${bundle} group.${bundle}.onesignal`,
                      // associate bundle with app group, skips if already associated
                      `source ~/.zshrc && bundle exec fastlane produce associate_group -a ${bundle}.OneSignalNotificationServiceExtension group.${bundle}.onesignal`,
                      `node ./scripts/appstore-metadata.js ${JSON.stringify({
                        hostId,
                        bundle,
                        privateKey,
                        issuer: iosDeveloperAccount?.ascApiKeyIssuer,
                        keyid: iosDeveloperAccount?.ascApiKeyId,
                        appleId,
                        isFirstDeployment,
                      })}`,
                    ]
                  : [
                      `echo "Skipping app and app groups creations"`,
                      // node_modules is already installed by the pre-deploy task
                      `cd ${customHostAppDir}`,
                      `node ./scripts/appstore-metadata.js ${JSON.stringify({
                        hostId,
                        bundle,
                        privateKey,
                        issuer: iosDeveloperAccount?.ascApiKeyIssuer,
                        keyid: iosDeveloperAccount?.ascApiKeyId,
                        appleId,
                        isFirstDeployment,
                      })}`,
                    ],

            // step 5: Running the fastlane build for specific targer platform
            [taskNames[7].id]:
              platform === "android"
                ? [
                    `cd ${customHostAppDir}`,
                    `source ~/.zshrc && bundle exec fastlane ${platform} build`,
                    `cp -r android/app/build/outputs/bundle/release/app-release.aab ../../../outputs/android/${hostId}.aab`,
                    `node ../../../scripts/android-aab.js ${JSON.stringify({ hostId, versionName, buildNumber })}`,
                  ]
                : [
                    `cd ${customHostAppDir}`,
                    `source ~/.zshrc && bundle exec fastlane ${platform} build`,
                  ],
            // step 6: Running the fastlane upload for specific targer platform
            // TODO
            [taskNames[8].id]:
              platform === "android" && isFirstDeployment
                ? [
                    `echo "Skipping this step for android as this is first deployment. Download .aab bundle from the dashboard"`,
                  ]
                : [
                    `cd ${customHostAppDir}`,
                    `source ~/.zshrc && bundle exec fastlane ${platform} upload`,
                  ],
            // step 7: Removing the deployment/{bundleId} folder after successful deployment
            // the workspace is moved to trash and deleted at background
            // priority, so the next build doesn't wait for it. Xcode output
            // older than an hour goes too; the *.noindex caches at the top of
            // DerivedData stay (module cache, compilation cache): they are
            // shared and content-addressed, so the next build reuses them.
            [taskNames[9].id]:
              platform === "ios"
                ? [
                    `echo "Removing deployment folder"`,
                    trashCommand(`${customhostDeploymentDir}/${bundle}`, DEPLOYMENT_TRASH),
                    trashStaleEntriesCommand(archivesPath, XCODE_TRASH),
                    trashStaleEntriesCommand(derivedDataPath, XCODE_TRASH, { keep: "*.noindex" }),
                    // gym's full xcodebuild logs, ~19 GB before this; kept 3 days for debugging
                    trashStaleEntriesCommand(gymLogsPath, XCODE_TRASH, { olderThanMin: 3 * 24 * 60 }),
                    purgeTrashInBackgroundCommand(DEPLOYMENT_TRASH, XCODE_TRASH),
                  ]
                : [
                    trashCommand(`${customhostDeploymentDir}/${bundle}`, DEPLOYMENT_TRASH),
                    purgeTrashInBackgroundCommand(DEPLOYMENT_TRASH),
                  ],
          };

          logger.info("Initiated Deployment Process");

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

          let isFailedDeployment = false;

          // we need to check if the bundle folder is present in the deployments/{hostId} during the restart deployment process
          // if the folder is present then only we can skip the task
          // if the folder is not present then we need to execute the tasks from the beginning
          const isBundleFolderPresentForRestart = fs.existsSync(
            `${customhostDeploymentDir}/${bundle}`,
          );

          for (const task of taskNames) {
            if (task.status === "success" || task.status === "processing") {
              // skipping the task if it is already successful or processing only if the bundle folder is present in the deployments/{hostId}
              if (isBundleFolderPresentForRestart) {
                continue;
              }
            }
            try {
              // The upload task skips screenshots that are byte-identical to
              // the last ones uploaded for this app (see screenshotUploads).
              // Android's first deployment has no upload step, so nothing is
              // recorded for it.
              const uploadsToStore =
                task.id === taskNames[8].id &&
                !(platform === "android" && isFirstDeployment);
              const screenshotsHash = uploadsToStore
                ? await hashScreenshots(customHostAppDir, platform)
                : null;
              const lastUploadedHash =
                platform === "ios"
                  ? metadata?.iosDeploymentDetails?.uploadedScreenshotsHash
                  : metadata?.androidDeploymentDetails?.uploadedScreenshotsHash;
              const skipScreenshots =
                screenshotsHash !== null &&
                screenshotsHash === lastUploadedHash &&
                process.env.WL_FORCE_SCREENSHOT_UPLOAD !== "1";
              if (skipScreenshots) {
                logger.info("Screenshots unchanged since the last upload, skipping them");
              }

              // executing the tasks
              await executeTask({
                commands: commands[task.id],
                taskId: task.id,
                taskName: task.name,
                job,
                deploymentId,
                hostId,
                env: skipScreenshots ? { WL_SKIP_SCREENSHOTS: "1" } : {},
              });

              if (screenshotsHash && !skipScreenshots) {
                await Mongo.metadata.updateOne(
                  { host: new ObjectId(hostId) },
                  { $set: { [uploadedHashField(platform)]: screenshotsHash } },
                );
              }

              // updating the version details for the target platform after successful deployment
            } catch (error) {
              if (error instanceof DeploymentCancelledError) {
                // task doc already marked cancelled by executeTask; the
                // controller set the deployment status/cancelledBy when it
                // published the cancel — $ne guard covers a direct kill
                await Mongo.deployment.updateOne(
                  {
                    _id: new ObjectId(deploymentId),
                    status: { $ne: "cancelled" },
                  },
                  {
                    $set: {
                      status: "cancelled",
                      updatedAt: new Date(),
                    },
                  },
                );
                logger.info("Deployment Status Changed to Cancelled");
                isFailedDeployment = true;
                break;
              }

              logger.error(error, `Failed to execute task -> ${task.name}`);

              // commenting this for now
              // adding a new command in the beginning of the task
              // to remove the deployment / { bundleId } folder when new deployment is started
              // // if we are getting any erro (throw error) then we need to remove the deployment/{bundleId} folder
              // const task = taskNames.slice(-1)[0];
              // await executeTask({
              //   commands: commands[task.id],
              //   taskId: task.id,
              //   taskName: task.name,
              //   job,
              //   deploymentId,
              //   hostId,
              // });
              // updating the deployment status to failed
              const currentDeployment = await Mongo.deployment.findOne({
                _id: new ObjectId(deploymentId),
              });

              const currentTask = currentDeployment?.tasks?.find(
                (t) => t.id === task.id,
              );

              // add the logs to the task
              let curentTaskLogs =
                currentTask?.logs && currentTask?.logs.length > 0
                  ? currentTask.logs
                  : [];

              // adding only this error to logs because something else has failed
              // inside the executeTask function
              curentTaskLogs.push({
                message: error instanceof Error ? error.message : String(error),
                type: "failed",
                timestamp: new Date(),
              });

              await Mongo.deployment.updateOne(
                {
                  _id: new ObjectId(deploymentId),
                  "tasks.id": task.id,
                },
                {
                  $set: {
                    updatedAt: new Date(),
                    "tasks.$.status": "failed",
                    "tasks.$.logs": curentTaskLogs,
                  },
                },
              );
              // separate write so a concurrent cancel is never overwritten
              await Mongo.deployment.updateOne(
                {
                  _id: new ObjectId(deploymentId),
                  status: { $ne: "cancelled" },
                },
                {
                  $set: {
                    status: "failed",
                    updatedAt: new Date(),
                  },
                },
              );

              logger.info("Deployment Status Changed to Failed");
              isFailedDeployment = true;
              break;
            }
          }

          if (!isFailedDeployment) {
            await updateVersionDetails({ deploymentId, hostId, platform });
          }
          consumeCancelRequest(deploymentId);
          clearActiveTask();
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

      startCancellationListener();
      logger.info("Worker Started");
    })
    .catch((error) => {
      logger.error(error, "Failed to connect to the database");
    });
})();

// A deployment document carries the logs of all its tasks and Mongo caps a
// document at 16MB, so each task only keeps its tail. The previous 20-entry cap
// was small enough that a successful fastlane run kept nothing but the summary
// table - the screenshot upload section, where CST-3770 lives, was always gone
// by the time anyone looked. Bound the tail by characters as well as entries so
// a chatty task (xcodebuild) cannot blow the document limit on its own:
// 10 tasks * 400k chars leaves plenty of headroom.
const MAX_TASK_LOG_ENTRIES = 500;
const MAX_TASK_LOG_CHARS = 400_000;

type TaskLogs = Pick<IDeploymentTask, "logs">["logs"];

const trimTaskLogs = (logs: TaskLogs): TaskLogs => {
  const recent = logs.slice(-MAX_TASK_LOG_ENTRIES);

  let chars = 0;
  let start = recent.length;

  while (start > 0) {
    const next = chars + (recent[start - 1].message?.length ?? 0);
    // always keep the newest entry, however long it is
    if (next > MAX_TASK_LOG_CHARS && start < recent.length) break;
    chars = next;
    start -= 1;
  }

  return recent.slice(start);
};

const executeTask = async ({
  commands,
  taskId,
  taskName,
  job,
  deploymentId,
  hostId,
  env = {},
  onError,
}: {
  commands: string[];
  taskId: string;
  taskName: string;
  job: Job<BuildJobPayloadType, any, string>;
  deploymentId: string;
  hostId: string;
  /** extra environment for this task's shell */
  env?: Record<string, string>;
  // will be a async function that will be called if the task is failed
  onError?: () => Promise<void>;
}) => {
  logger.info(`Executing Task [ ${taskName} ]`);

  // sending job progress to sse
  job.updateProgress({
    deploymentId,
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
  // spawn (not exec): output is consumed via streams so exec's buffering adds
  // nothing, and detached:true puts the shell in its own process group so a
  // cancel can kill the whole tree (zsh + fastlane + xcodebuild)
  const diskFreeStart = await diskFreeGb();
  const perf = createTaskPerf(commands);

  const e = spawn(instrumentCommands(commands).join(" && "), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
    },
    shell: "/bin/zsh",
    detached: true,
  });
  registerActiveTask(deploymentId, e);
  // exec used to set utf8 for us; spawn emits Buffers without this
  e.stdout?.setEncoding("utf8");
  e.stderr?.setEncoding("utf8");
  const { stdout, stderr } = e;
  // start time of the task
  const startTime = Date.now();

  let outputLogs: Pick<IDeploymentTask, "logs">["logs"] = [];
  let errorLogs: Pick<IDeploymentTask, "logs">["logs"] = [];

  if (stdout) {
    stdout.on("data", (raw: string) => {
      const data = perf.onStdout(raw);
      if (!data) return;
      logger.info(data);

      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
    deploymentId,
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

      // create an error regex that checks words like failed, exit, error, etc
      const errorRegex = /\b(?:fail(?:ed|ure)?|exit|error|abort)\b/i;

      const type = errorRegex.test(data)
        ? "error"
        : warningRegex.test(data)
          ? "warning"
          : "info";

      if (type === "error") {
        logger.error(data);
        errorLogs.push({
          message: data,
          type: "failed",
          timestamp: new Date(),
        });
      } else {
        logger.info(data);
        outputLogs.push({
          message: data,
          type: "success",
          timestamp: new Date(),
        });
      }
      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
    deploymentId,
        task: {
          id: taskId,
          name: taskName,
          type: "processing",
          duration: Date.now() - startTime,
        },
        type: errorRegex.test(data)
          ? "failed"
          : warningRegex.test(data)
            ? "warning"
            : "success",
        message: data,
        timestamp: new Date(),
      } as JobProgressType);
    });
  }

  // waiting for the task to complete
  // if the task is completed then we will get the code
  const code = await new Promise((resolve, reject) => {
    e.on("close", resolve);
    e.on("error", reject);
  });
  clearActiveTask();
  const taskPerf = await perf.finish(diskFreeStart);

  // the non-zero exit may be our own SIGTERM — report cancelled, not failed
  if (code !== 0 && isCancelRequested(deploymentId)) {
    job.updateProgress({
      deploymentId,
      task: {
        id: taskId,
        name: taskName,
        type: "failed",
        duration: Date.now() - startTime,
      },
      type: "failed",
      message: `Task [ ${taskName} ] cancelled by user`,
      timestamp: new Date(),
    } as JobProgressType);

    await Mongo.deployment.updateOne(
      {
        _id: new ObjectId(deploymentId),
        "tasks.id": taskId,
      },
      {
        $set: {
          "tasks.$.status": "cancelled",
          "tasks.$.logs": [
            ...trimTaskLogs(outputLogs),
            {
              message: `Task [ ${taskName} ] cancelled by user`,
              type: "failed" as const,
              timestamp: new Date(),
            },
          ],
          "tasks.$.duration": Date.now() - startTime,
          "tasks.$.perf": taskPerf,
          updatedAt: new Date(),
        },
      },
    );

    logger.info(`Task [ ${taskName} ] cancelled`);
    throw new DeploymentCancelledError(deploymentId);
  }

  // if the code is 0 then the task is completed successfully
  if (code === 0) {
    // sending job progress to sse
    job.updateProgress({
    deploymentId,
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

    // shrink the outputLogs array since mongo has a limit of 16mb per document
    outputLogs = trimTaskLogs(outputLogs);

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
          "tasks.$.perf": taskPerf,
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
    deploymentId,
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

    // shrink the outputLogs array since mongo has a limit of 16mb per document
    const combinedLogs = trimTaskLogs([...outputLogs, ...errorLogs]);

    // update the task status to failed and add logs to the task
    await Mongo.deployment.updateOne(
      {
        _id: new ObjectId(deploymentId),
        "tasks.id": taskId,
      },
      {
        $set: {
          "tasks.$.status": "failed",
          "tasks.$.logs": combinedLogs,
          "tasks.$.duration": Date.now() - startTime,
          "tasks.$.perf": taskPerf,
          updatedAt: new Date(),
        },
      },
    );

    logger.error(`Failed to execute task [ ${taskName} ]`);
  }

  // after all updates (success or failed) are done in the database then we can return error
  if (code !== 0) {
    throw new Error(`[ ${taskName} ] task failed with code -> ${code}`);
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

    // $ne guard: a cancel that landed in the final moments must not be
    // overwritten to success
    await Mongo.deployment.updateOne(
      {
        _id: new ObjectId(deploymentId),
        status: { $ne: "cancelled" },
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
