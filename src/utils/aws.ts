import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectAttributesCommand,
  GetObjectAttributesCommandOutput,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  ObjectAttributes,
  PutObjectCommand,
  PutObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  SendMessageCommand,
  SendMessageCommandOutput,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { Upload } from "@aws-sdk/lib-storage";
import crypto from "crypto";
import pino from "pino";
import { PassThrough, Readable } from "stream";
import { promisify } from "util";
import zlib from "zlib";

export interface UploadAssetsToS3Param {
  file: Buffer;
  filename: string;
  mimetype?: string;
  directory?: string;
  filePathGenerator?: (fileName: string) => string;
}
export interface UploadAssetsToS3Return {
  filename: string;
  path: string;
  assetUrl: string;
  s3RawResponse: PutObjectCommandOutput;
}

export enum AWSS3Buckets {
  REGULAR = "regular",
  SECURE = "secure",
  ASSET = "asset",
}

export class AWSService {
  private sqsClient: SQSClient;
  private s3Client: S3Client;
  private region = "ap-south-1";
  private sqsQueueUrl: string;
  private credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  private s3Bucket: string;
  private secureS3Bucket: string;
  private assetBucket: string;
  private logger: pino.Logger;

  private deflate = promisify(zlib.deflate);

  constructor() {
    this.logger = pino({
      level: "debug",
      msgPrefix: "[ AWS_SERVICE ] ",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    });

    this.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    };

    this.sqsQueueUrl = process.env.SQS_QUEUE_URL || "";

    if (!this.credentials.accessKeyId || !this.credentials.secretAccessKey) {
      this.logger.error(
        "AWS credentials not found, Cannot configure AWS services with proper credentials",
      );
    }

    this.sqsClient = new SQSClient({
      region: this.region,
      credentials: {
        accessKeyId: this.credentials.accessKeyId,
        secretAccessKey: this.credentials.secretAccessKey,
      },
    });

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.credentials.accessKeyId,
        secretAccessKey: this.credentials.secretAccessKey,
      },
    });

    this.s3Bucket = process.env.BUCKET || "";
    this.secureS3Bucket = process.env.SECURE_BUCKET || "";
    this.assetBucket = process.env.BUCKET || "";
  }

  async enqueueMessage(
    event: string,
    body: unknown,
    attributes: Record<string, string> = {},
  ): Promise<SendMessageCommandOutput | null> {
    try {
      const message = (await this.deflate(JSON.stringify(body))).toString(
        "base64",
      );
      const params = {
        ...attributes,
        event,
      } as Record<string, unknown>;
      const messageAttributes = Object.keys(params).reduce(
        (acc, key) => {
          acc[key] = {
            DataType: "String",
            StringValue: `${params[key]}`,
          };
          return acc;
        },
        {} as Record<
          string,
          {
            DataType: "String";
            StringValue: string;
          }
        >,
      );
      const sendMessageCommand = new SendMessageCommand({
        DelaySeconds: 1,
        MessageAttributes: messageAttributes,
        MessageBody: message,
        QueueUrl: this.sqsQueueUrl,
      });

      const response = await this.sqsClient.send(sendMessageCommand);
      this.logger.info("Enqueued message", response);
      return response;
    } catch (error) {
      this.logger.error("Error while enqueuing message", error);
      return null;
    }
  }

  async uploadToSecureBucket({
    file,
    dir = "secure_dir",
    name,
  }: {
    file: Buffer;
    dir: string;
    name: string;
  }): Promise<{
    key: string;
    response: PutObjectCommandOutput;
  }> {
    try {
      const splittedFilename = name.split(".");
      const extension = splittedFilename.pop();

      if (!extension) throw new Error("Extension not allowed");

      const fileKey = `${dir}/${splittedFilename.join("-")}-${crypto
        .randomBytes(16)
        .toString("hex")}.${extension}`;

      const command = new PutObjectCommand({
        Body: file,
        Bucket: this.secureS3Bucket,
        Key: fileKey,
      });

      const response = await this.s3Client.send(command);
      return {
        key: fileKey,
        response,
      };
    } catch (error) {
      throw new Error("Upload operation failed for bucket");
    }
  }

  async getSecureObject(key: string): Promise<GetObjectCommandOutput> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.secureS3Bucket,
        Key: key,
      });

      const resp = await this.s3Client.send(command);
      return resp;
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new Error("Object for key not found");
      }
      throw new Error("Bucket get operation failed");
    }
  }

  async deleteSecureObject(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.secureS3Bucket,
        Key: key,
      });

      await this.s3Client.send(command);

      //verifing whether this obejct exists or not
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: this.secureS3Bucket,
          Key: key,
        });

        const resp = await this.s3Client.send(headCommand);
        return !resp;
      } catch (error) {
        // if it throws not found that means it is successfully deleted
        if (error instanceof NotFound) return true;

        throw new Error("Bucket object metadata verification operation failed");
      }
    } catch (error) {
      throw new Error("Bucket delete operation failed");
    }
  }

  // TODO: make a system using args which can take multiple buckets as options -> like regular, secure or asset bucket, then perform based on that bucket
  async deleteAssetFromS3(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      throw new Error("Bucket delete operation failed");
    }
  }

  getS3Client(): S3Client {
    return this.s3Client;
  }

  getS3Bucket(): string {
    return this.s3Bucket;
  }

  private _generateCompleteAssetPath(s3Key: string): string {
    return `https://${process.env.DOMAIN_NAME || ""}/${s3Key}`;
  }

  async uploadAssetsToS3({
    file,
    filename,
    directory = "assets",
    filePathGenerator,
    mimetype,
  }: UploadAssetsToS3Param): Promise<UploadAssetsToS3Return> {
    try {
      const splittedFilename = filename.split(".");
      const extension = splittedFilename.pop();

      if (!extension) {
        throw new Error("Extension not allowed");
      }

      let fileKey: string;

      if (filePathGenerator) {
        fileKey = filePathGenerator(filename);
      } else {
        // generate unique file key
        fileKey = `${directory}/${splittedFilename.join("-")}-${crypto
          .randomBytes(16)
          .toString("hex")}.${extension}`;
      }

      // upload to s3
      const command = new PutObjectCommand({
        Body: file,
        Bucket: this.assetBucket,
        Key: fileKey,
        StorageClass: "INTELLIGENT_TIERING",

        // Note: this action was there in the old create-post API. So just using it for compatibility
        // to cover for the chrome's bug of incorrect mimetype
        ...(mimetype
          ? { ContentType: mimetype === "audio/mp3" ? "audio/mpeg" : mimetype }
          : {}),
      });
      const s3RawResponse = await this.s3Client.send(command);

      return {
        filename,
        path: fileKey,
        assetUrl: this._generateCompleteAssetPath(fileKey),
        s3RawResponse,
      };
    } catch (error) {
      throw new Error("Upload operation failed for bucket");
    }
  }

  async streamToBucket({
    file,
    key,
    mimetype,
    useSecureBucket,
  }: {
    file: Readable;
    key: string;
    mimetype: string;
    useSecureBucket?: boolean;
  }): Promise<PutObjectCommandOutput> {
    try {
      const passthrough = new PassThrough();
      const parallelUploadS3 = new Upload({
        client: this.s3Client,
        params: {
          Bucket: useSecureBucket ? this.secureS3Bucket : this.s3Bucket,
          Key: key,
          Body: passthrough,
          StorageClass: "INTELLIGENT_TIERING",
          ContentType: mimetype,
        },
      });

      file.pipe(passthrough);

      const response = await parallelUploadS3.done();

      return response;
    } catch (error) {
      throw new Error("Unable put object to bucket");
    }
  }

  async getFileMetadata({
    key,
    useSecureBucket,
    objectAttributes = [
      "Checksum",
      "ETag",
      "ObjectParts",
      "ObjectSize",
      "StorageClass",
    ],
  }: {
    key: string;
    useSecureBucket?: boolean;
    objectAttributes?: ObjectAttributes[];
  }): Promise<GetObjectAttributesCommandOutput> {
    const command = new GetObjectAttributesCommand({
      Bucket: useSecureBucket ? this.secureS3Bucket : this.s3Bucket,
      Key: key,
      ObjectAttributes: objectAttributes,
    });

    return this.s3Client.send(command);
  }

  async checkAssetExists({ key }: { key: string }): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Key: key,
        Bucket: this.s3Bucket,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;

      throw new Error("Unable to check asset exists");
    }
  }

  async syncAppformAssets({
    formId,
    hostId,
    asset,
  }: {
    formId: string;
    hostId: string;
    asset: string;
  }): Promise<void> {
    try {
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: this.s3Bucket,
          CopySource: `${this.s3Bucket}/appzap-assets/appforms/${formId}/${asset}`,
          Key: `appzap-assets/metadata/${hostId}/${asset}`,
          ContentType: "image/png",
          CacheControl: "no-cache, no-store, must-revalidate",
        }),
      );
      return;
    } catch (error) {
      throw new Error("Failed to sync files");
    }
  }
}
