import { execFile } from "child_process";
import fs from "fs-extra";
import { createFactory } from "hono/factory";
import { ObjectId } from "mongodb";
import util from "util";

import { zValidator } from "@hono/zod-validator";

import { Response } from "../../src/utils/statuscode";
import Mongo from "../database";
import { createDeveloperAccountAndroidSchema } from "../validations/developerAccounts";

const factory = createFactory();

// execFile with an argv array — account fields and passwords are user
// input and were previously interpolated into shell strings
const execFileAsync = util.promisify(execFile);
const writeFileAsync = fs.promises.writeFile;

/**
 * GET /developer-accounts/android
 * fetch all developer accounts android
 */
const getAllDeveloperAccountsAndroidHandler = factory.createHandlers(
  async (c) => {
    try {
      // keyAlias/keyPassword are signing credentials — they never leave the
      // server (the dashboard only ever sets them on create)
      const accounts = await Mongo.developer_accounts_android
        .find({}, { projection: { keyAlias: 0, keyPassword: 0 } })
        .toArray();
      return c.json({
        message: "Developer Accounts Android",
        result: accounts ?? [],
      });
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
 * GET /developer-accounts/android/:id
 * fetch developer account android by id
 */
const getDeveloperAccountAndroidByIdHandler = factory.createHandlers(
  async (c) => {
    try {
      const { id } = c.req.param();

      if (!id) {
        return c.json({ message: "Invalid ID" }, Response.BAD_REQUEST);
      }

      const account = await Mongo.developer_accounts_android.findOne(
        { _id: new ObjectId(id) },
        { projection: { keyAlias: 0, keyPassword: 0 } },
      );

      if (!account) {
        return c.json({ message: "Invalid ID" }, Response.BAD_REQUEST);
      }

      return c.json({
        message: "Developer Account Android",
        result: account,
      });
    } catch (error) {
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

/**
 * POST /developer-accounts/android
 * create new developer account android
 */
const createNewDeveloperAccountAndroidHandler = factory.createHandlers(
  zValidator("json", createDeveloperAccountAndroidSchema),
  async (c) => {
    const {
      name,
      organizationalUnit,
      organization,
      city,
      state,
      countryCode,
      keyAlias,
      keyPassword,

      fastlaneConfig,
    } = c.req.valid("json");

    try {
      const account = await Mongo.developer_accounts_android.insertOne({
        name,
        organizationalUnit,
        organization,
        city,
        state,
        countryCode,
        keyAlias,
        keyPassword,
        createdAt: new Date(),
      });

      // keytool -genkey -v -keystore my-key.jks -alias alias_name -keyalg RSA
      // -keysize 2048 -validity 10000 -dname "CN=…" -storepass … -keypass …
      await execFileAsync("keytool", [
        "-genkey",
        "-v",
        "-keystore",
        "keystore.jks",
        "-alias",
        keyAlias,
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "10000",
        "-dname",
        `CN=${name}, OU=${organizationalUnit}, O=${organization}, L=${city}, ST=${state}, C=${countryCode}`,
        "-storepass",
        keyPassword,
        "-keypass",
        keyPassword,
      ]);

      // move the jks file to the required directory
      await fs.ensureDir(`./developer_accounts/android/${account.insertedId}`);
      await fs.move(
        "keystore.jks",
        `./developer_accounts/android/${account.insertedId}/keystore.jks`,
        { overwrite: true },
      );

      // write fastlane config to developer_accounts/android/[account_id]/fastlane-android.json as a json file
      const fastlaneConfigPath = `./developer_accounts/android/${account.insertedId}/fastlane-android.json`;
      // create the file if it doesn't exist
      await fs.ensureFile(fastlaneConfigPath);
      await writeFileAsync(fastlaneConfigPath, fastlaneConfig, "utf-8");

      return c.json({
        message: "Developer Account Android Created",
        result: account,
      });
    } catch (error) {
      console.log(error);
      return c.json(
        { message: "Internal Server Error" },
        Response.INTERNAL_SERVER_ERROR,
      );
    }
  },
);

const getUploadKeyCertificate = factory.createHandlers(async (c) => {
  const { id } = c.req.param();

  try {
    const account = await Mongo.developer_accounts_android.findOne({
      _id: new ObjectId(id),
    });

    if (!account) {
      return c.json({ message: "Account not found" }, Response.BAD_REQUEST);
    }

    const accountDir = `./developer_accounts/android/${account._id}`;
    await fs.ensureDir(accountDir);

    // keytool -export -rfc -keystore keystore.jks -alias upload -file upload_certificate.pem
    await execFileAsync(
      "keytool",
      [
        "-export",
        "-rfc",
        "-keystore",
        "keystore.jks",
        "-alias",
        account.keyAlias,
        "-file",
        "upload_certificate.pem",
        "-storepass",
        account.keyPassword,
        "-keypass",
        account.keyPassword,
      ],
      { cwd: accountDir },
    );

    const certificate = await fs.readFile(
      `${accountDir}/upload_certificate.pem`,
      "utf-8",
    );

    return c.json({
      message: "Upload Certificate",
      result: certificate,
    });
  } catch (error) {
    console.log(error);
    return c.json(
      { message: "Internal Server Error" },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

export {
  createNewDeveloperAccountAndroidHandler,
  getAllDeveloperAccountsAndroidHandler,
  getDeveloperAccountAndroidByIdHandler,
  getUploadKeyCertificate,
};
