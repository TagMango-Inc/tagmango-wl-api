// import fs from "fs-extra";
// import path from "path";
// import plist from "plist";
// import xcode from "xcode";
// import xml2js from "xml2js";

// const parser = new xml2js.Parser();
// const builder = new xml2js.Builder({
//   xmldec: { version: "1.0", encoding: "UTF-8" },
// });

// // Promisify readFile and writeFile operations
// const readFileAsync = fs.promises.readFile;
// const writeFileAsync = fs.promises.writeFile;

// async function modifyXmlFile(
//   filePath: string,
//   modifications: (arg: any) => void,
// ) {
//   const data = await readFileAsync(filePath);
//   const result = await parser.parseStringPromise(data);
//   modifications(result);
//   const xml = builder.buildObject(result);
//   await writeFileAsync(filePath, xml, "utf8");
//   console.log(`Updated ${filePath} successfully!`);
// }

// // Helper function to modify Plist files
// async function modifyPlist(
//   filePath: string,
//   modifications: (arg: any) => void,
// ) {
//   const data = await readFileAsync(filePath, "utf8");
//   const result = plist.parse(data);
//   modifications(result);
//   const newData = plist.build(result);
//   await writeFileAsync(filePath, newData, "utf8");
//   console.log(`Updated ${filePath} successfully!`);
// }

// // Helper function to update project.pbxproj file
// async function updatePbxproj(
//   filePath: string,
//   modifications: (arg: any) => void,
// ) {
//   const project = xcode.project(filePath);
//   await new Promise<void>((resolve, reject) =>
//     project.parse((err: any) => (err ? reject(err) : resolve())),
//   );
//   modifications(project);
//   await writeFileAsync(filePath, project.writeSync());
//   console.log("Updated project.pbxproj successfully!");
// }

// // Function to replace a specific pattern in a file
// async function replaceInFile(filePath: string, pattern: any, replacement: any) {
//   const data = await readFileAsync(filePath, "utf8");
//   const updatedData = data.replace(pattern, replacement);
//   await writeFileAsync(filePath, updatedData, "utf8");
//   console.log(`Updated ${filePath} successfully!`);
// }

// // Function to update the launch screen color in an iOS storyboard file
// async function updateLaunchScreenColor(filePath: any, colorHex: string) {
//   const data = await readFileAsync(filePath, "utf8");
//   const result = await parser.parseStringPromise(data);

//   // Navigate to the view of the viewController
//   const viewController =
//     result.document.scenes[0].scene[0].objects[0].viewController[0];
//   const mainView = viewController.view[0];

//   // Update the backgroundColor key
//   mainView.color[0].$ = {
//     key: "backgroundColor",
//     red: parseInt(colorHex.substring(1, 3), 16) / 255,
//     green: parseInt(colorHex.substring(3, 5), 16) / 255,
//     blue: parseInt(colorHex.substring(5, 7), 16) / 255,
//     alpha: "1",
//     colorSpace: "custom",
//     customColorSpace: "displayP3",
//   };

//   const xml = builder.buildObject(result);
//   await writeFileAsync(filePath, xml, "utf8");
//   console.log("Launch screen background color updated successfully!");
// }

// // Function to asynchronously fix custom Java files package name issues
// async function fixJavaFilesPackageName(javaFilesPath: any, bundle: any) {
//   const files = await fs.promises.readdir(javaFilesPath);

//   for (const file of files) {
//     const filePath = path.join(javaFilesPath, file);
//     let content = await fs.promises.readFile(filePath, "utf8");
//     content = content.replace(
//       /package com\.tagmango\.app;/g,
//       `package ${bundle};`,
//     );
//     await fs.promises.writeFile(filePath, content, "utf8");
//     console.log(`Updated package name in ${file}`);
//   }
// }

// // Async function to copy app assets
// async function copyAppAssets(formattedName: string) {
//   try {
//     // Copy entire directories
//     await fs.copy(
//       "./icons/android/app/src/main/res",
//       "./android/app/src/main/res",
//     );
//     await fs.copy(
//       "./icons/ios/AppName/Images.xcassets/AppIcon.appiconset/",
//       `./ios/${formattedName}/Images.xcassets/AppIcon.appiconset/`,
//     );

//     // Copy individual files
//     await fs.copy(
//       "./icons/icon.png",
//       "./android/app/src/main/res/drawable/ic_launcher.png",
//     );
//     await fs.copy(
//       "./icons/ios/AppName/Images.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png",
//       `./ios/${formattedName}/Images.xcassets/ic_launcher-playstore.imageset/ic_launcher-playstore.png`,
//     );

//     console.log("Assets copied successfully.");
//   } catch (error) {
//     console.error("Error copying assets:", error);
//   }
// }

// // Async function to update bundle id in fastlane files
// async function modifiyFastlaneConfigs(bundleId: any, formattedName: any) {
//   const paths = ["fastlane/Appfile", "fastlane/Fastfile"];
//   paths.forEach(async (pathname) => {
//     const data = await readFileAsync(pathname, "utf8");

//     const replacements = {
//       "com.tagmango.app": bundleId,
//       TagMango: formattedName,
//     };

//     const modifiedData = Object.entries(replacements).reduce(
//       (acc, [key, value]) => {
//         return acc.replace(new RegExp(key, "g"), value);
//       },
//       data,
//     );

//     await writeFileAsync(pathname, modifiedData);
//   });
//   console.log(`Modified Fastlane config file for bundle id ${bundleId}`);
// }

// export {
//   copyAppAssets,
//   fixJavaFilesPackageName,
//   modifiyFastlaneConfigs,
//   modifyPlist,
//   modifyXmlFile,
//   replaceInFile,
//   updateLaunchScreenColor,
//   updatePbxproj,
// };
