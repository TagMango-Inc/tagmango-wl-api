#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const githubrepo = "TagMangoApp";
const rootProjectDir = `root/${githubrepo}`;
const detoxBuildOutputPath = "ios/build/Build/Products/Release-iphonesimulator/TagMango.app";

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
    const detoxBuildDir = path.join(process.cwd(), "builds", "detox", versionName);
    ensureDir(detoxBuildDir);

    console.log(`📂 Build output directory: ${detoxBuildDir}`);

    // Check if root project exists
    const rootProjectPath = path.join(process.cwd(), rootProjectDir);
    if (!fs.existsSync(rootProjectPath)) {
      throw new Error(`Root project not found at ${rootProjectPath}`);
    }

    // Step 1: Checkout correct version branch and pull latest
    console.log("\n📥 Step 1: Checking out version branch...");
    if (
      !execute(
        `cd ${rootProjectDir} && git fetch --all && git checkout v/${versionName} && git pull origin v/${versionName}`
      )
    ) {
      throw new Error("Failed to checkout version branch");
    }

    // Step 2: Install node dependencies
    console.log("\n📦 Step 2: Installing node dependencies...");
    if (!execute(`cd ${rootProjectDir} && npm install --reset-cache --include=dev`)) {
      throw new Error("Failed to install node dependencies");
    }

    // Step 3: Install Ruby bundle
    console.log("\n💎 Step 3: Installing Ruby bundle...");
    if (!execute(`cd ${rootProjectDir} && source ~/.zshrc && bundle install`)) {
      throw new Error("Failed to install Ruby bundle");
    }

    // Step 4: Install CocoaPods
    console.log("\n🍫 Step 4: Installing CocoaPods...");
    if (
      !execute(
        `cd ${rootProjectDir} && source ~/.zshrc && bundle exec "NO_FLIPPER=1 pod install --project-directory=ios"`
      )
    ) {
      throw new Error("Failed to install CocoaPods");
    }

    // Step 5: Build Detox app
    console.log("\n🔨 Step 5: Building Detox app...");
    if (
      !execute(
        `cd ${rootProjectDir} && detox build --configuration ios.sim.release | xcbeautify`
      )
    ) {
      throw new Error("Failed to build Detox app");
    }

    // Step 6: Copy built app to builds/detox/{versionName}/
    console.log("\n📋 Step 6: Copying built app to cache directory...");
    const builtAppPath = path.join(rootProjectDir, detoxBuildOutputPath);
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

    console.log("\n✅ Detox build completed successfully!");
    console.log(`📂 Cached app location: ${destAppPath}`);
    console.log(`\n💡 This build will be reused for all deployments using version ${versionName}\n`);
  } catch (error) {
    console.error("\n❌ Error during Detox build:");
    console.error(error.message);
    process.exit(1);
  }
};

buildDetox();
