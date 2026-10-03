import 'dotenv/config';
import mongoose from 'mongoose';
import * as models from '../src/models/index.js';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env before inspecting database indexes.');

try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  for (const model of Object.values(models)) {
    const indexes = await model.collection.indexes();
    console.log(`${model.collection.collectionName}:`);
    for (const index of indexes) {
      const options = [index.unique ? 'unique' : '', index['2dsphereIndexVersion'] ? '2dsphere' : ''].filter(Boolean).join(', ');
      console.log(`  ${index.name}: ${JSON.stringify(index.key)}${options ? ` (${options})` : ''}`);
    }
  }
} finally {
  await mongoose.disconnect();
}
