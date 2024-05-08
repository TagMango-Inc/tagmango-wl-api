import 'dotenv/config';

import mongoose from 'mongoose';

async function databaseConntect() {
  try {
    const DB_URI = process.env.MONGO_URI || "";
    const connection = await mongoose.connect(`${DB_URI}`, {
    });
    console.log(`Connected to database: ${connection.connection.name}`);
  } catch (error) {
    console.log(`Error connecting to database: ${error}`);
  }
}

export default databaseConntect;
