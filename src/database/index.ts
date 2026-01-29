import "dotenv/config";

import { Collection, Db, MongoClient } from "mongodb";

import {
  Collections,
  IAdminUser,
  IAppForm,
  IChapter,
  ICourse,
  ICustomHost,
  IDeployment,
  IDeploymentRequest,
  IDeveloperAccountAndroid,
  IDeveloperAccountIos,
  IMango,
  IMangoRoom,
  IMetaData,
  IPost,
  IRedeployment,
  ISubscription,
  IUser,
} from "../../src/types/database";

abstract class Mongo {
  private static client: MongoClient;
  private static db: Db;
  private static uri: string = process.env.MONGO_URI || "";
  private static dbName: string = this.uri.split("?")[0].split("/").pop() || "";

  // collections
  public static user: Collection<IAdminUser>;
  public static customhost: Collection<ICustomHost>;
  public static deployment: Collection<IDeployment>;
  public static redeployment: Collection<IRedeployment>;
  public static metadata: Collection<IMetaData>;
  public static mango: Collection<IMango>;
  public static post: Collection<IPost>;
  public static course: Collection<ICourse>;
  public static chapter: Collection<IChapter>;
  public static subscription: Collection<ISubscription>;
  public static platform_users: Collection<IUser>;
  public static mango_rooms: Collection<IMangoRoom>;
  public static developer_accounts_android: Collection<IDeveloperAccountAndroid>;
  public static developer_accounts_ios: Collection<IDeveloperAccountIos>;
  public static app_forms: Collection<IAppForm>;
  public static deployment_requests: Collection<IDeploymentRequest>;

  public static async connect(): Promise<void> {
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db(this.dbName);

      // Ping the database to check if the connection is successful
      await this.ping();

      // Initialize collections
      if (!this.db) {
        throw new Error("Database not connected");
      }

      this.user = this.db.collection<IAdminUser>(Collections.ADMIN_USER);
      this.customhost = this.db.collection<ICustomHost>(
        Collections.CUSTOM_HOST,
      );
      this.deployment = this.db.collection<IDeployment>(Collections.DEPLOYMENT);
      this.redeployment = this.db.collection<IRedeployment>(
        Collections.REDEPLOYMENT,
      );
      this.metadata = this.db.collection<IMetaData>(Collections.METADATA);
      this.mango = this.db.collection<IMango>(Collections.MANGO);
      this.post = this.db.collection<IPost>(Collections.POST);
      this.course = this.db.collection<ICourse>(Collections.COURSE);
      this.chapter = this.db.collection<IChapter>(Collections.CHAPTER);
      this.subscription = this.db.collection<ISubscription>(
        Collections.SUBSCRIPTION,
      );
      this.platform_users = this.db.collection<IUser>(Collections.USER);
      this.mango_rooms = this.db.collection<IMangoRoom>(Collections.MANGO_ROOM);
      this.developer_accounts_android =
        this.db.collection<IDeveloperAccountAndroid>(
          Collections.DEVELOPER_ACCOUNT_ANDROID,
        );
      this.developer_accounts_ios = this.db.collection<IDeveloperAccountIos>(
        Collections.DEVELOPER_ACCOUNT_IOS,
      );
      this.app_forms = this.db.collection<IAppForm>(Collections.APP_FORM);
      this.deployment_requests = this.db.collection<IDeploymentRequest>(
        Collections.APP_DEPLOYMENT_REQUESTS,
      );
    } catch (error) {
      console.log(`Error connecting to database: ${error}`);
      throw new Error("Error connecting to database");
    }
  }

  private static async ping(): Promise<void> {
    await this.db.command({ ping: 1 });
    console.log(
      "Ping successful, connected to database: ",
      this.db.databaseName,
    );
  }

  public static async disconnect(): Promise<void> {
    await this.client.close();
  }
}

export default Mongo;
