import "dotenv/config";

import { Collection, Db, MongoClient } from "mongodb";

import {
  Collections,
  IAdminUser,
  ICustomHost,
  IDeployment,
  IMetaData,
} from "../../src/types/database";

abstract class Mongo {
  private static client: MongoClient;
  private static db: Db;
  private static uri: string = process.env.MONGO_URI || "";
  private static dbName: string = "test";
  // private static dbName: string = 'tagmango-production';

  // collections
  public static user: Collection<IAdminUser>;
  public static customhost: Collection<ICustomHost>;
  public static deployment: Collection<IDeployment>;
  public static metadata: Collection<IMetaData>;

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
      this.metadata = this.db.collection<IMetaData>(Collections.METADATA);
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
