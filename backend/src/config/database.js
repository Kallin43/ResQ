import mongoose from 'mongoose';
import * as models from '../models/index.js';

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) {
    console.warn('MongoDB is not connected: set MONGODB_URI in backend/.env.');
    return false;
  }

  mongoose.connection.on('error', (error) => {
    console.error('MongoDB connection error:', error.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB connection closed.');
  });

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS ?? 10000),
      autoIndex: false,
    });
    // Earlier versions used a TTL index that deleted expired alert records. Drop
    // that index before creating the durable, non-TTL expires_at index.
    try {
      const alertIndexes = await models.Alert.collection.indexes();
      const expiryTtlIndex = alertIndexes.find((index) => index.key?.expires_at === 1 && index.expireAfterSeconds !== undefined);
      if (expiryTtlIndex) await models.Alert.collection.dropIndex(expiryTtlIndex.name);
    } catch (error) {
      if (error.codeName !== 'NamespaceNotFound') throw error;
    }
    try {
      const roadIndexes = await models.Road.collection.indexes();
      const legacyRoadIndex = roadIndexes.find((index) => index.key?.zone_a === 1 && index.key?.zone_b === 1);
      if (legacyRoadIndex) await models.Road.collection.dropIndex(legacyRoadIndex.name);
    } catch (error) {
      if (error.codeName !== 'NamespaceNotFound') throw error;
    }
    await Promise.all(Object.values(models).map((model) => model.createIndexes()));
    console.log(`MongoDB connected to database "${mongoose.connection.name}".`);
    return true;
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return false;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
