const fs = require("fs-extra");
const { mergePath } = require("hono/utils/url");

const writeFile = fs.promises.writeFile;
const readFile = fs.promises.readFile;

const path = mergePath(__dirname, "android-aab.json");

const fetchJSON = async () => {
  try {
    const data = await readFile(path, "utf8");
    const json = JSON.parse(data);
    return json;
  } catch (err) {
    console.log(err);
  }
};

const writeJSON = async ({ hostId, versionName, buildNumber }) => {
  const json = await fetchJSON();

  const map = new Map(Object.entries(json));

  map.set(hostId, {
    versionName,
    buildNumber,
    createdAt: new Date().toISOString(),
  });

  const obj = Object.fromEntries(map);

  await writeFile(path, JSON.stringify(obj, null, 2), (err) => {
    if (err) {
      console.log(err);
    }
  });
};

const commandLineArgs = process.argv.slice(2);

if (commandLineArgs) {
  const config = commandLineArgs.reduce((acc, arg) => {
    const [key, value] = arg.split(":");
    acc[key] = value;
    return acc;
  }, {});
  writeJSON(config);
}

module.exports = { fetchJSON, writeJSON };
