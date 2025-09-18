#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");

// Function to execute shell commands with error handling
const execute = (command) => {
  try {
    execSync(command, { stdio: "inherit" });
    return true;
  } catch (error) {
    console.error(`\n❌ Error executing command: ${command}`);
    console.error(`Error details: ${error.message}\n`);
    return false;
  }
};

// Function to download a file from URL
const downloadFile = (url, destPath) => {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Failed to download: ${url} (Status: ${response.statusCode})`,
            ),
          );
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });

        fileStream.on("error", (err) => {
          fs.unlink(destPath, () => {}); // Clean up failed download
          reject(err);
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {}); // Clean up failed download
        reject(err);
      });
  });
};

// Function to ensure directory exists
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Function to display usage instructions
const showUsage = () => {
  console.log("\n📝 Usage:");
  console.log("  node scripts/create-icons.js <hostId> <bundle>\n");
  console.log("Arguments:");
  console.log("  hostId    The ID of the host to create icons for");
  console.log("  bundle    The bundle identifier for the app\n");
  console.log("Example:");
  console.log("  node scripts/create-icons.js host123 com.example.app\n");
  process.exit(1);
};

// Main function to create icons
const createIcons = async (hostId, bundle) => {
  try {
    // Validate hostId
    if (!hostId || typeof hostId !== "string" || hostId.trim() === "") {
      console.error("\n❌ Error: Please provide a valid hostId");
      showUsage();
    }

    // Validate bundle
    if (!bundle || typeof bundle !== "string" || bundle.trim() === "") {
      console.error("\n❌ Error: Please provide a valid bundle identifier");
      showUsage();
    }

    console.log("\n🚀 Starting icon creation process...");
    console.log(`📂 Host ID: ${hostId}`);
    console.log(`📦 Bundle: ${bundle}`);

    const baseUrl = `https://tagmango.com/appzap-assets/metadata/${hostId}`;
    const customHostAppDir = `deployments/${bundle}/TagMangoApp`;
    const iconsDir = path.join(process.cwd(), customHostAppDir, "icons");

    // Create icons directories
    ensureDir(path.join(iconsDir, "android"));
    ensureDir(path.join(iconsDir, "ios"));

    // Required files to download
    const requiredFiles = [
      "icon.png",
      "foreground.png",
      "background.png",
      "iosIcon.png",
      "customOneSignalIcon.png",
    ];

    // Download all required files directly to icons directory
    console.log("\n📥 Downloading assets...");
    try {
      await Promise.all(
        requiredFiles.map(async (file) => {
          const url = `${baseUrl}/${file}`;
          const destPath = path.join(iconsDir, file);
          console.log(`Downloading ${file}...`);
          await downloadFile(url, destPath);
        }),
      );
    } catch (error) {
      console.error("\n❌ Error downloading assets:");
      console.error(error.message);
      process.exit(1);
    }

    // Create Android icons
    console.log("\n🤖 Creating Android icons...");
    if (
      !execute(
        `cd ${iconsDir} && npx icon-set-creator create -A --adaptive-icon-background ${path.join(iconsDir, "background.png")} --adaptive-icon-foreground ${path.join(iconsDir, "foreground.png")} ${path.join(iconsDir, "icon.png")}`,
      )
    ) {
      throw new Error("Failed to create Android icons");
    }

    // Create iOS icons
    console.log("\n🍎 Creating iOS icons...");
    if (
      !execute(
        `cd ${iconsDir} && npx icon-set-creator create -I ${path.join(iconsDir, "iosIcon.png")}`,
      )
    ) {
      throw new Error("Failed to create iOS icons");
    }

    console.log("\n✨ Icons created successfully!\n");
  } catch (error) {
    console.error("\n❌ Error during icon creation:");
    console.error(error.message);
    process.exit(1);
  }
};

// Check if required arguments are provided
if (process.argv.length < 4) {
  console.error("\n❌ Error: Missing required arguments");
  showUsage();
}

// Get arguments from command line and start the process
const [hostId, bundle] = process.argv.slice(2);
createIcons(hostId, bundle);
