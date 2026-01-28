#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const githubrepo = "TagMangoApp";
const rootProjectDir = `root/${githubrepo}`;
const detoxBuildOutputPath =
  "ios/build/Build/Products/Release-iphonesimulator/TagMango.app";

// Function to execute shell commands with error handling
const execute = (command, options = {}) => {
  try {
    console.log(`\n🔄 Running: ${command}\n`);
    execSync(command, {
      stdio: "inherit",
      shell: "/bin/zsh",
      ...options,
    });
    return true;
  } catch (error) {
    console.error(`\n❌ Error executing command: ${command}`);
    console.error(`Error details: ${error.message}\n`);
    return false;
  }
};

// Function to ensure directory exists
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Main function to build detox
const buildDetox = async () => {
  try {
    // Read version from release.json
    const releaseJsonPath = path.join(process.cwd(), "data", "release.json");
    if (!fs.existsSync(releaseJsonPath)) {
      throw new Error("data/release.json not found");
    }

    const releaseData = JSON.parse(fs.readFileSync(releaseJsonPath, "utf-8"));
    const { versionName } = releaseData;

    if (!versionName) {
      throw new Error("versionName not found in release.json");
    }

    console.log("\n🚀 Starting Detox build process...");
    console.log(`📦 Version: ${versionName}`);

    // Create builds/detox/{versionName} directory
    const detoxBuildDir = path.join(
      process.cwd(),
      "builds",
      "detox",
      versionName,
    );
    ensureDir(detoxBuildDir);

    console.log(`📂 Build output directory: ${detoxBuildDir}`);

    // Check if root project exists
    const rootProjectPath = path.join(process.cwd(), rootProjectDir);
    if (!fs.existsSync(rootProjectPath)) {
      throw new Error(`Root project not found at ${rootProjectPath}`);
    }

    // Step 1: Copy root project to builds directory (excluding dependencies and build artifacts)
    console.log("\n📋 Step 1: Copying root project to builds directory...");
    const buildProjectDir = path.join(detoxBuildDir, githubrepo);

    // Remove existing build project if present
    if (fs.existsSync(buildProjectDir)) {
      console.log("🗑️  Removing existing build project directory...");
      fs.rmSync(buildProjectDir, { recursive: true, force: true });
    }

    // Use rsync to copy while excluding build artifacts
    // Note: vendor/ is included to reuse pre-compiled Ruby gems
    const rsyncExcludes = [
      "node_modules",
      "ios/Pods",
      "ios/build",
      "android/build",
      "android/app/build",
      "android/.gradle",
    ]
      .map((dir) => `--exclude='${dir}'`)
      .join(" ");

    if (
      !execute(
        `rsync -a ${rsyncExcludes} "${rootProjectPath}/" "${buildProjectDir}/"`,
      )
    ) {
      throw new Error("Failed to copy root project to builds directory");
    }

    console.log(`📂 Build project directory: ${buildProjectDir}`);

    // Step 2: Checkout correct version branch and pull latest
    console.log("\n📥 Step 2: Checking out version branch...");
    if (
      !execute(
        `cd "${buildProjectDir}" && git fetch --all && git checkout v/${versionName} && git pull origin v/${versionName}`,
      )
    ) {
      throw new Error("Failed to checkout version branch");
    }

    // Step 3: Install node dependencies
    console.log("\n📦 Step 3: Installing node dependencies...");
    if (
      !execute(
        `cd "${buildProjectDir}" && npm install --reset-cache --include=dev`,
      )
    ) {
      throw new Error("Failed to install node dependencies");
    }

    // Step 4: Install Ruby bundle
    console.log("\n💎 Step 4: Installing Ruby bundle...");
    if (
      !execute(`cd "${buildProjectDir}" && source ~/.zshrc && bundle install`)
    ) {
      throw new Error("Failed to install Ruby bundle");
    }

    // Step 5: Install CocoaPods
    console.log("\n🍫 Step 5: Installing CocoaPods...");
    if (
      !execute(
        `cd "${buildProjectDir}" && source ~/.zshrc && bundle exec "NO_FLIPPER=1 pod install --project-directory=ios"`,
      )
    ) {
      throw new Error("Failed to install CocoaPods");
    }

    // Step 6: Build Detox app
    console.log("\n🔨 Step 6: Building Detox app...");
    if (
      !execute(
        `cd "${buildProjectDir}" && detox build --configuration ios.sim.release | xcbeautify`,
      )
    ) {
      throw new Error("Failed to build Detox app");
    }

    // Step 7: Copy built app to builds/detox/{versionName}/
    console.log("\n📋 Step 7: Copying built app to cache directory...");
    const builtAppPath = path.join(buildProjectDir, detoxBuildOutputPath);
    const destAppPath = path.join(detoxBuildDir, "TagMango.app");

    if (!fs.existsSync(builtAppPath)) {
      throw new Error(`Built app not found at ${builtAppPath}`);
    }

    // Remove existing cached app if present
    if (fs.existsSync(destAppPath)) {
      fs.rmSync(destAppPath, { recursive: true, force: true });
    }

    // Copy the app
    if (!execute(`cp -r "${builtAppPath}" "${destAppPath}"`)) {
      throw new Error("Failed to copy built app to cache directory");
    }

    // Step 8: Cleanup build project directory
    console.log("\n🧹 Step 8: Cleaning up build project directory...");
    fs.rmSync(buildProjectDir, { recursive: true, force: true });

    console.log("\n✅ Detox build completed successfully!");
    console.log(`📂 Cached app location: ${destAppPath}`);
    console.log(
      `\n💡 This build will be reused for all deployments using version ${versionName}\n`,
    );
  } catch (error) {
    console.error("\n❌ Error during Detox build:");
    console.error(error.message);
    process.exit(1);
  }
};

buildDetox();
