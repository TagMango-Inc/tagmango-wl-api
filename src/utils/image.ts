import fs from "fs-extra";

const writeFile = fs.promises.writeFile;

async function base64ToImage(base64Str: string, path: string) {
  // Remove header
  const base64Data = base64Str.replace(/^data:image\/png;base64,/, "");

  // Write file
  await writeFile(path, base64Data, "base64");
}

export { base64ToImage };
