import "dotenv/config";

import { DelayedError, Job, Processor, Worker } from "bullmq";
import { execFile, spawn } from "child_process";
import fs from "fs-extra";
import {
  MongoNetworkError,
  MongoServerSelectionError,
  ObjectId,
  UpdateFilter,
} from "mongodb";
import os from "os";
import path from "path";
import pino from "pino";

import Mongo from "../../src/database";
import { IDeploymentTask, IMetaData } from "../../src/types/database";
import {
  customhostDeploymentDir,
  deploymentFolderName,
  githubrepo,
} from "../constants";
import { BuildJobPayloadType, JobProgressType } from "../types";
import {
  iosPipelineFor,
  resolveAppGroupsEnabled,
  saveAppGroupsEnabled,
} from "../utils/iosDeployment";
import {
  clearActiveTask,
  consumeCancelRequest,
  isCancelRequested,
  registerActiveTask,
  startCancellationListener,
} from "./cancellation";
import { ANDROID_BUILD_QUEUE, queueRedisOptions } from "./config";
import { ensureGradleCacheRetention } from "./gradleCache";
import {
  APP_PRIVACY_HASH_FIELD,
  appPrivacyMarker,
  ascApiKeyEnv,
  hashAppPrivacy,
} from "./appStoreConnect";
import { iosCreateAppCommands } from "./iosPipelines";
import { withRootRepo, withSimulator } from "./lanes";
import { trashStaleExternalPods } from "../utils/podCache";
import {
  hashScreenshots,
  screenshotsReady,
  uploadedHashField,
} from "./screenshotUploads";
import { createTaskPerf, diskFreeGb, instrumentCommands } from "./taskPerf";
import {
  DEPLOYMENT_TRASH,
  GEM_CACHE_DIR,
  LOW_PRIORITY,
  XCODE_DERIVED_DATA,
  purgeTrashInBackgroundCommand,
  shutdownSimulatorsCommand,
  trashArchivesCommand,
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
// The *.noindex caches at the top of DerivedData (ModuleCache, and
// CompilationCache when it is on) have no size limit of their own. Pods
// modules are built from each app's own path, so the module cache mostly
// fills with per-app copies nobody reuses. Each is moved to trash between
// builds once it passes this cap, and refills on the next iOS build.
const XCODE_CACHE_MAX_GB = Number(process.env.WL_XCODE_CACHE_MAX_GB ?? 10);
const LOW_DISK_RETRY_MS = 10 * 60 * 1000;
// Without Mongo or DNS every queued job fails within ~30s, and a failed job is
// removed from Redis while Mongo still shows it pending (784 deployments on
// 15 Oct 2026). Such a job is put back and the worker pauses instead.
const UNREACHABLE_RETRY_MS = 5 * 60 * 1000;
// DNS lookups only; a reset or timeout can be one flaky upload, and pausing
// for that would hold up every other job
const NETWORK_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);
let pausedUntil = 0;

/** Mongo, or the network itself, is unreachable: not the deployment's fault */
const isUnreachable = (error: unknown) =>
  error instanceof MongoServerSelectionError ||
  error instanceof MongoNetworkError ||
  NETWORK_ERROR_CODES.has((error as NodeJS.ErrnoException)?.code ?? "");


/**
 * The app's iOS account and App Group setting as they are now. Falls back to
 * the job's copy only when the app has no account saved. The resolved App
 * Group setting is saved on the metadata and the deployment.
 */
const currentIosSettings = async (data: BuildJobPayloadType) => {
  const host = new ObjectId(data.hostId);
  const metadata = await Mongo.metadata.findOne(
    { host },
    {
      projection: {
        iosDeveloperAccount: 1,
        "iosDeploymentDetails.appGroupsEnabled": 1,
      },
    },
  );
  const deployment = await Mongo.deployment.findOne(
    { _id: new ObjectId(data.deploymentId) },
    { projection: { appGroupsEnabled: 1 } },
  );

  let iosDeveloperAccount = data.iosDeveloperAccount ?? null;
  if (
    metadata?.iosDeveloperAccount &&
    !metadata.iosDeveloperAccount.equals(iosDeveloperAccount?._id)
  ) {
    iosDeveloperAccount = await Mongo.developer_accounts_ios.findOne({
      _id: metadata.iosDeveloperAccount,
    });
    logger.info(
      `iOS account for ${data.bundle} changed since the job was queued; using ${iosDeveloperAccount?.name}`,
    );
  }

  // a restart keeps the pipeline its deployment started with
  const appGroupsEnabled =
    deployment?.appGroupsEnabled ??
    (metadata
      ? resolveAppGroupsEnabled(metadata, data.isFirstDeployment)
      : (data.appGroupsEnabled ?? !data.isFirstDeployment));
  if (metadata) await saveAppGroupsEnabled(host, metadata, appGroupsEnabled);
  if (deployment?.appGroupsEnabled === undefined) {
    await Mongo.deployment.updateOne(
      { _id: new ObjectId(data.deploymentId) },
      { $set: { appGroupsEnabled } },
    );
  }

  return { iosDeveloperAccount, appGroupsEnabled };
};

const sizeGb = (dir: string) =>
  new Promise<number>((resolve) =>
    execFile("du", ["-sk", dir], (error, stdout) =>
      resolve(error ? 0 : Number(stdout.split("\t")[0]) / 1024 ** 2),
    ),
  );

/** runs before each iOS job; only the iOS lane uses Xcode, one job at a time, so nothing is using the caches */
const capXcodeCaches = async () => {
  if (!(await fs.pathExists(XCODE_DERIVED_DATA))) return;
  const caches = (await fs.readdir(XCODE_DERIVED_DATA)).filter((n) => n.endsWith(".noindex"));
  for (const name of caches) {
    const gb = await sizeGb(path.join(XCODE_DERIVED_DATA, name));
    if (gb <= XCODE_CACHE_MAX_GB) continue;
    logger.info(`Xcode ${name} at ${gb.toFixed(1)} GB (cap ${XCODE_CACHE_MAX_GB} GB): moving it to trash`);
    await fs.ensureDir(XCODE_TRASH);
    await fs
      .rename(path.join(XCODE_DERIVED_DATA, name), path.join(XCODE_TRASH, `${name}-${Date.now()}`))
      .catch((error) => logger.error(error, `Failed to trash ${name}`));
  }
};

/** frees what is already in trash; low priority, the other lane may be building */
const purgeTrashNow = () =>
  new Promise<void>((resolve) =>
    execFile(
      "/bin/zsh",
      ["-c", `${LOW_PRIORITY.join(" ")} rm -rf ${DEPLOYMENT_TRASH}/*(DN) ${XCODE_TRASH}/*(DN)`],
      () => resolve(),
    ),
  );

(async () => {
  Mongo.connect()
    .then(() => {
      /** puts the job back in its queue and pauses both lanes for retryMs */
      const putBackAndPause = async (
        job: Job<BuildJobPayloadType>,
        token: string | undefined,
        retryMs: number,
      ): Promise<never> => {
        await job.moveToDelayed(Date.now() + retryMs, token);
        if (Date.now() > pausedUntil) {
          pausedUntil = Date.now() + retryMs;
          for (const worker of workers) worker.pause(true);
          setTimeout(() => workers.forEach((worker) => worker.resume()), retryMs);
        }
        throw new DelayedError();
      };

      const runBuildJob: Processor<BuildJobPayloadType> = async (job, token) => {
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
            isFirstDeployment,
          } = job.data;
          // A job can wait in the queue for days (bulk redeploys), and the
          // app's iOS account or App Group setting can change meanwhile, so
          // both are read again now instead of trusted from the payload.
          const { iosDeveloperAccount, appGroupsEnabled } =
            platform === "ios"
              ? await currentIosSettings(job.data)
              : { iosDeveloperAccount: null, appGroupsEnabled: false };

          if (platform === "ios") {
            await capXcodeCaches();
            // the iOS lane is idle and the simulator turn rules out a Detox
            // pod install in the other lane (see utils/podCache)
            const movedPods = await withSimulator(() => trashStaleExternalPods(Date.now())).catch(
              (error) => (logger.error(error, "Failed to trim the CocoaPods cache"), 0),
            );
            if (movedPods) logger.info(`Moved ${movedPods} stale CocoaPods local-path pod entries to trash`);
          }

          let freeGb = await diskFreeGb();
          if (freeGb !== null && freeGb < MIN_FREE_DISK_GB) {
            await purgeTrashNow();
            freeGb = await diskFreeGb();
          }
          if (freeGb !== null && freeGb < MIN_FREE_DISK_GB) {
            logger.error(
              `Only ${freeGb} GB free (floor ${MIN_FREE_DISK_GB} GB): putting deployment ${deploymentId} back and pausing for ${LOW_DISK_RETRY_MS / 60000} min`,
            );
            await putBackAndPause(job, token, LOW_DISK_RETRY_MS);
          }


          const formatedAppName = name.replace(/ /g, "");

          // find the paths to remove after successful deployment
          // this ensures space is freed up after successful deployment
          const username = os.userInfo().username;
          const archivesPath = `/Users/${username}/Library/Developer/Xcode/Archives`;
          const derivedDataPath = `/Users/${username}/Library/Developer/Xcode/DerivedData`;
          const gymLogsPath = `/Users/${username}/Library/Logs/gym`;

          // get screenshots values from DB as the job starts instead of getting a copy when the job is created
          // assumption: one deployment per app and platform at a time, so we can get the latest values from the DB
          // NOTE: each lane runs one job at a time; do not raise a worker's concurrency

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
          // passed to the iOS build and upload tasks only
          const ascKeyEnv = ascApiKeyEnv(iosDeveloperAccount, privateKey);

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

          const workspaceFolder = deploymentFolderName(bundle, platform);
          const workspaceDir = `${customhostDeploymentDir}/${workspaceFolder}`;
          const customHostAppDir = `${workspaceDir}/${githubrepo}`;

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
              trashCommand(workspaceDir, DEPLOYMENT_TRASH),
              `mkdir -p ${workspaceDir}`,
              `cp -r root/${githubrepo} ${workspaceDir}`,
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
              `node ./scripts/create-icons.js ${hostId} ${workspaceFolder}`,
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
                // always explicit: app-build.js treats a missing value as true
                appGroups: appGroupsEnabled,
              })}`,
            ],

            [taskNames[6].id]:
              platform === "android"
                ? [`echo "Skipping this step for android"`]
                : isFirstDeployment
                  ? [
                      // node_modules is already installed by the pre-deploy task
                      `cd ${customHostAppDir}`,
                      ...iosCreateAppCommands(
                        iosPipelineFor(appGroupsEnabled),
                        bundle,
                      ),
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
            // step 7: Removing the deployments/<bundle>-<platform> folder after successful deployment
            // the workspace is moved to trash and deleted at background
            // priority, so the next build doesn't wait for it. Xcode output
            // older than an hour goes too; the *.noindex caches at the top of
            // DerivedData stay (module cache, compilation cache): they are
            // shared and content-addressed, so the next build reuses them.
            [taskNames[9].id]:
              platform === "ios"
                ? [
                    `echo "Removing deployment folder"`,
                    trashCommand(workspaceDir, DEPLOYMENT_TRASH),
                    // gym exported the .ipa into the workspace and it's uploaded;
                    // only this lane archives, so every archive here is done
                    trashArchivesCommand(archivesPath, XCODE_TRASH),
                    trashStaleEntriesCommand(derivedDataPath, XCODE_TRASH, { keep: "*.noindex" }),
                    // gym's full xcodebuild logs, ~19 GB before this; kept 3 days for debugging
                    trashStaleEntriesCommand(gymLogsPath, XCODE_TRASH, { olderThanMin: 3 * 24 * 60 }),
                    purgeTrashInBackgroundCommand(DEPLOYMENT_TRASH, XCODE_TRASH),
                  ]
                : [
                    trashCommand(workspaceDir, DEPLOYMENT_TRASH),
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

          // a restart resumes after its finished tasks only if this deployment's
          // own workspace (deployments/<bundle>-<platform>) is still there;
          // otherwise every task runs again from the beginning
          const isBundleFolderPresentForRestart = fs.existsSync(workspaceDir);

          for (const task of taskNames) {
            if (task.status === "success" || task.status === "processing") {
              // skipping the task if it is already successful or processing only if the workspace folder is still there
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

              // App privacy details need the Apple ID; skip them once this app
              // has the current file (see appStoreConnect)
              const isIosUpload = platform === "ios" && task.id === taskNames[8].id;
              const appPrivacyHash = isIosUpload
                ? await hashAppPrivacy(customHostAppDir)
                : null;
              const skipAppPrivacy =
                appPrivacyHash !== null &&
                appPrivacyHash === metadata?.iosDeploymentDetails?.uploadedAppPrivacyHash &&
                process.env.WL_FORCE_APP_PRIVACY_UPLOAD !== "1";
              if (isIosUpload) await fs.remove(appPrivacyMarker(customHostAppDir));
              const usesAscKey =
                platform === "ios" &&
                (task.id === taskNames[7].id || task.id === taskNames[8].id);

              // executing the tasks; the ones that touch root/<repo> or the
              // simulator take turns with the other lane
              const usesRootRepo =
                task.id === taskNames[0].id || task.id === taskNames[1].id;
              const usesSimulator = task.id === taskNames[3].id;
              // Metro bundles here (detox build, gradle bundleRelease, Xcode
              // archive) and both RN's gradle plugin and react-native-xcode.sh
              // pass --reset-cache. Its cache lives in $TMPDIR/metro-cache, so
              // with two lanes one build cleared it while the other wrote to
              // it (ENOTEMPTY). Each workspace gets its own TMPDIR, removed
              // with the workspace.
              const usesMetro =
                task.id === taskNames[3].id || task.id === taskNames[7].id;
              const tmpDir = path.resolve(workspaceDir, ".tmp");
              if (usesMetro) await fs.ensureDir(tmpDir);
              const runTask = (taskCommands = commands[task.id]) => executeTask({
                commands: taskCommands,
                taskId: task.id,
                taskName: task.name,
                job,
                deploymentId,
                hostId,
                env: {
                  ...(usesMetro ? { TMPDIR: tmpDir } : {}),
                  ...(usesAscKey ? ascKeyEnv : {}),
                  ...(skipScreenshots ? { WL_SKIP_SCREENSHOTS: "1" } : {}),
                  ...(skipAppPrivacy ? { WL_SKIP_APP_PRIVACY: "1" } : {}),
                  // a later deploy keeps going if only the Apple ID step fails
                  ...(isIosUpload && !isFirstDeployment
                    ? { WL_APP_PRIVACY_OPTIONAL: "1" }
                    : {}),
                },
              });
              await (usesRootRepo
                ? withRootRepo(runTask)
                : usesSimulator
                  ? withSimulator(async () => {
                      // the app's deploy for the other platform may have
                      // generated and uploaded them while this one waited for
                      // the simulator; the metadata above was read at job start
                      if (!generateIAPScreenshot && !screenshotsReady(metadata, platform)) {
                        const latest = await Mongo.metadata.findOne(
                          { host: new ObjectId(hostId) },
                          { projection: { androidScreenshots: 1, iosScreenshots: 1, androidFeatureGraphic: 1 } },
                        );
                        if (screenshotsReady(latest, platform)) {
                          logger.info("Screenshots were generated by this app's other deployment, skipping");
                          return runTask([`echo "Screenshots were generated by this app's other deployment"`]);
                        }
                      }
                      return runTask();
                    })
                  : runTask());

              if (screenshotsHash && !skipScreenshots) {
                await Mongo.metadata.updateOne(
                  { host: new ObjectId(hostId) },
                  { $set: { [uploadedHashField(platform)]: screenshotsHash } },
                );
              }

              if (
                appPrivacyHash &&
                !skipAppPrivacy &&
                (await fs.pathExists(appPrivacyMarker(customHostAppDir)))
              ) {
                await Mongo.metadata.updateOne(
                  { host: new ObjectId(hostId) },
                  { $set: { [APP_PRIVACY_HASH_FIELD]: appPrivacyHash } },
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
          clearActiveTask(deploymentId);
          logger.info("Deployment Process Completed");
        };

      const processBuildJob: Processor<BuildJobPayloadType> = async (job, token) => {
        try {
          return await runBuildJob(job, token);
        } catch (error) {
          if (!isUnreachable(error)) throw error;
          logger.error(
            error,
            `Mongo or the network is unreachable: putting deployment ${job.data.deploymentId} back and pausing for ${UNREACHABLE_RETRY_MS / 60000} min`,
          );
          return putBackAndPause(job, token, UNREACHABLE_RETRY_MS);
        }
      };

      ensureGradleCacheRetention()
        .then((changed) => changed && logger.info("Gradle build-cache retention init script written"))
        .catch((error) => logger.error(error, "Failed to write the Gradle build-cache retention init script"));

      const workers = ["buildQueue", ANDROID_BUILD_QUEUE].map(
        (queueName) =>
          new Worker<BuildJobPayloadType>(queueName, processBuildJob, {
            connection: queueRedisOptions,
            concurrency: 1,
          }),
      );
      for (const worker of workers) {
        worker.on("stalled", (job) => {
          logger.error(`Job has been stalled ${job}`);
        });
      }

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
  clearActiveTask(deploymentId);
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
