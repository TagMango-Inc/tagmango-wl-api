import FormData from "form-data";
import fs from "fs-extra";
import { createFactory } from "hono/factory";
import mime from "mime";
import path from "path";
import { Readable } from "stream";
import unzipper from "unzipper";

import {
  convertSHA256HashToUUID,
  convertToDictionaryItemsRepresentation,
  createNoUpdateAvailableDirectiveAsync,
  getAssetMetadataAsync,
  getLatestUpdateBundlePathForRuntimeVersionAsync,
  getMetadataAsync,
  getPrivateKeyAsync,
  NoUpdateAvailableError,
  signRSASHA256,
} from "../utils/otaHelpers";
import { Response } from "../utils/statuscode";

const structuredHeaders = require("structured-headers");

const { readFile } = fs.promises;

const factory = createFactory();

const handleManifestRequest = factory.createHandlers(async (c) => {
  if (c.req.method !== "GET") {
    return c.json(
      {
        error: "Expected GET.",
        message: "Expected GET.",
        result: null,
      },
      Response.METHOD_NOT_ALLOWED,
    );
  }

  const channel = c.req.header("expo-channel-name");
  if (!channel || typeof channel !== "string") {
    return c.json(
      {
        error: "No channel provided.",
        message: "No channel provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  const protocolVersionMaybeArray = c.req.header("expo-protocol-version");
  if (protocolVersionMaybeArray && Array.isArray(protocolVersionMaybeArray)) {
    return c.json(
      {
        error: "Unsupported protocol version. Expected either 0 or 1.",
        message: "Unsupported protocol version. Expected either 0 or 1.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }
  const protocolVersion = parseInt(protocolVersionMaybeArray ?? "0", 10);

  const platform = c.req.header("expo-platform") ?? c.req.query("platform");
  if (platform !== "ios" && platform !== "android") {
    return c.json(
      {
        error: "Unsupported platform. Expected either ios or android.",
        message: "Unsupported platform. Expected either ios or android.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  const runtimeVersion =
    c.req.header("expo-runtime-version") ?? c.req.query("runtime-version");
  if (!runtimeVersion || typeof runtimeVersion !== "string") {
    return c.json(
      {
        error: "No runtimeVersion provided.",
        message: "No runtimeVersion provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  let updateBundlePath: string;
  try {
    updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(
      runtimeVersion,
      channel,
    );
  } catch (error: any) {
    return c.json(
      {
        error: error.message,
        message: error.message,
        result: null,
      },
      Response.NOT_FOUND,
    );
  }

  try {
    try {
      const currentUpdateId = c.req.header("expo-current-update-id");
      const { metadataJson, createdAt, id } = await getMetadataAsync({
        updateBundlePath,
        runtimeVersion,
      });

      // NoUpdateAvailable directive only supported on protocol version 1
      // for protocol version 0, serve most recent update as normal
      if (
        currentUpdateId === convertSHA256HashToUUID(id) &&
        protocolVersion === 1
      ) {
        throw new NoUpdateAvailableError();
      }

      // const expoConfig = await getExpoConfigAsync({
      //   updateBundlePath,
      //   runtimeVersion,
      // });

      const platformSpecificMetadata = metadataJson.fileMetadata[platform];
      const manifest = {
        id: convertSHA256HashToUUID(id),
        createdAt,
        runtimeVersion,
        assets: await Promise.all(
          (platformSpecificMetadata.assets as any[]).map((asset: any) =>
            getAssetMetadataAsync({
              updateBundlePath,
              filePath: asset.path,
              ext: asset.ext,
              runtimeVersion,
              platform,
              isLaunchAsset: false,
            }),
          ),
        ),
        launchAsset: await getAssetMetadataAsync({
          updateBundlePath,
          filePath: platformSpecificMetadata.bundle,
          isLaunchAsset: true,
          runtimeVersion,
          platform,
          ext: null,
        }),
        metadata: {},
        // extra: {
        //   expoClient: expoConfig,
        // },
      };

      let signature = null;
      const expectSignatureHeader = c.req.header("expo-expect-signature");
      if (expectSignatureHeader) {
        const privateKey = await getPrivateKeyAsync();
        if (!privateKey) {
          return c.json(
            {
              error:
                "Code signing requested but no key supplied when starting server.",
              message:
                "Code signing requested but no key supplied when starting server.",
              result: null,
            },
            Response.BAD_REQUEST,
          );
        }
        const manifestString = JSON.stringify(manifest);
        const hashSignature = signRSASHA256(manifestString, privateKey);
        const dictionary = convertToDictionaryItemsRepresentation({
          sig: hashSignature,
          keyid: "main",
        });
        signature = structuredHeaders.serializeDictionary(dictionary);
      }

      const assetRequestHeaders: { [key: string]: object } = {};
      [...manifest.assets, manifest.launchAsset].forEach((asset) => {
        assetRequestHeaders[asset.key] = {
          "test-header": "test-header-value",
        };
      });

      const form = new FormData();
      form.append("manifest", JSON.stringify(manifest), {
        contentType: "application/json",
        header: {
          "content-type": "application/json; charset=utf-8",
          ...(signature ? { "expo-signature": signature } : {}),
        },
      });
      form.append("extensions", JSON.stringify({ assetRequestHeaders }), {
        contentType: "application/json",
      });

      c.status(200);
      c.header("expo-protocol-version", String(protocolVersion));
      c.header("expo-sfv-version", "0");
      c.header("cache-control", "private, max-age=0");
      c.header(
        "content-type",
        `multipart/mixed; boundary=${form.getBoundary()}`,
      );
      return c.body(form.getBuffer());
    } catch (maybeNoUpdateAvailableError) {
      if (maybeNoUpdateAvailableError instanceof NoUpdateAvailableError) {
        if (protocolVersion === 0) {
          throw new Error(
            "NoUpdateAvailable directive not available in protocol version 0",
          );
        }
        const directive = await createNoUpdateAvailableDirectiveAsync();

        let signature = null;
        const expectSignatureHeader = c.req.header("expo-expect-signature");
        if (expectSignatureHeader) {
          const privateKey = await getPrivateKeyAsync();
          if (!privateKey) {
            return c.json(
              {
                error:
                  "Code signing requested but no key supplied when starting server.",
                message:
                  "Code signing requested but no key supplied when starting server.",
                result: null,
              },
              Response.BAD_REQUEST,
            );
          }
          const directiveString = JSON.stringify(directive);
          const hashSignature = signRSASHA256(directiveString, privateKey);
          const dictionary = convertToDictionaryItemsRepresentation({
            sig: hashSignature,
            keyid: "main",
          });
          signature = structuredHeaders.serializeDictionary(dictionary);
        }

        const form = new FormData();
        form.append("directive", JSON.stringify(directive), {
          contentType: "application/json",
          header: {
            "content-type": "application/json; charset=utf-8",
            ...(signature ? { "expo-signature": signature } : {}),
          },
        });

        c.status(200);
        c.header("expo-protocol-version", String(protocolVersion));
        c.header("expo-sfv-version", "0");
        c.header("cache-control", "private, max-age=0");
        c.header(
          "content-type",
          `multipart/mixed; boundary=${form.getBoundary()}`,
        );
        return c.body(form.getBuffer());
      }
      throw maybeNoUpdateAvailableError;
    }
  } catch (error) {
    console.error(error);
    return c.json(
      {
        error: error,
        message: "Internal server error",
        result: null,
      },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const handleAssetsRequest = factory.createHandlers(async (c) => {
  const { asset: assetName, runtimeVersion, platform } = c.req.query();

  if (!assetName || typeof assetName !== "string") {
    return c.json(
      {
        error: "No asset name provided.",
        message: "No asset name provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  const channel = c.req.header("expo-channel-name");
  if (!channel || typeof channel !== "string") {
    return c.json(
      {
        error: "No channel provided.",
        message: "No channel provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  if (platform !== "ios" && platform !== "android") {
    return c.json(
      {
        error: 'No platform provided. Expected "ios" or "android".',
        message: 'No platform provided. Expected "ios" or "android".',
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  if (!runtimeVersion || typeof runtimeVersion !== "string") {
    return c.json(
      {
        error: "No runtimeVersion provided.",
        message: "No runtimeVersion provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  let updateBundlePath: string;
  try {
    updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(
      runtimeVersion,
      channel,
    );
  } catch (error: any) {
    return c.json(
      {
        error: error.message,
        message: error.message,
        result: null,
      },
      Response.NOT_FOUND,
    );
  }

  const { metadataJson } = await getMetadataAsync({
    updateBundlePath,
    runtimeVersion,
  });

  const assetPath = path.resolve(assetName);
  const assetMetadata = metadataJson.fileMetadata[platform].assets.find(
    (asset: any) =>
      asset.path === assetName.replace(`${updateBundlePath}/`, ""),
  );
  const isLaunchAsset =
    metadataJson.fileMetadata[platform].bundle ===
    assetName.replace(`${updateBundlePath}/`, "");

  if (!fs.existsSync(assetPath)) {
    return c.json(
      {
        error: `Asset "${assetName}" does not exist.`,
        message: `Asset "${assetName}" does not exist.`,
        result: null,
      },
      Response.NOT_FOUND,
    );
  }

  try {
    const asset = await readFile(assetPath, null);

    c.status(200);
    c.header(
      "content-type",
      isLaunchAsset
        ? "application/javascript"
        : mime.getType(assetMetadata.ext) ?? "",
    );
    return c.body(asset);
  } catch (error) {
    console.log(error);
    return c.json(
      {
        error: error,
        message: "Internal server error",
        result: null,
      },
      Response.INTERNAL_SERVER_ERROR,
    );
  }
});

const handleUploadUpdateRequest = factory.createHandlers(async (c) => {
  // check for upload-key header
  // this upload key is used to authenticate the upload request
  const uploadKey = c.req.header("upload-key");
  if (!uploadKey) {
    return c.json(
      {
        error: "No upload key provided.",
        message: "No upload key provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  if (uploadKey !== process.env.UPLOAD_KEY) {
    return c.json(
      {
        error: "Invalid upload key.",
        message: "Invalid upload key.",
        result: null,
      },
      Response.UNAUTHORIZED,
    );
  }

  const channel = c.req.header("expo-channel-name");
  if (!channel || typeof channel !== "string") {
    return c.json(
      {
        error: "No channel provided.",
        message: "No channel provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  const body = await c.req.parseBody();

  if (!body) {
    return c.json(
      {
        error: "No body provided.",
        message: "No body provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }
  const file = body.upload as File;
  const runtimeVersion = body.runtimeVersion;
  if (!runtimeVersion || typeof runtimeVersion !== "string") {
    return c.json(
      {
        error: "No runtimeVersion provided.",
        message: "No runtimeVersion provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  if (!file) {
    return c.json(
      {
        error: "No file provided.",
        message: "No file provided.",
        result: null,
      },
      Response.BAD_REQUEST,
    );
  }

  // Extract zip file from buffer
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const filePath = path.resolve(
    `updates/${channel}/${runtimeVersion}/${parseInt(String(Date.now() / 1000), 10)}`,
  );

  fs.rmSync(filePath, { recursive: true, force: true });
  fs.mkdirSync(filePath, { recursive: true });

  try {
    // Use unzipper to extract directly from buffer
    await new Promise<void>((resolve, reject) => {
      const stream = unzipper.Extract({ path: filePath });
      stream.on("close", resolve);
      stream.on("error", reject);

      // Create a readable stream from the buffer
      const readable = new Readable();
      readable._read = () => {}; // No-op
      readable.push(fileBuffer);
      readable.push(null);

      readable.pipe(stream);
    });
  } catch (e) {
    fs.rmSync(filePath, { recursive: true, force: true });
    return c.json(
      {
        error: e,
        message: "Internal server error",
        result: null,
      },
      Response.INTERNAL_SERVER_ERROR,
    );
  }

  return c.json(
    {
      error: null,
      message: "Upload successful",
      result: null,
    },
    Response.OK,
  );
});

export {
  handleAssetsRequest,
  handleManifestRequest,
  handleUploadUpdateRequest,
};
