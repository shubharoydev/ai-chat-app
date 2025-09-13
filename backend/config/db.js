import mongoose from 'mongoose';
import { mongoUri } from './env.js';

export async function connectMongoDB() {
  try {
    await mongoose.connect(mongoUri); 
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}
