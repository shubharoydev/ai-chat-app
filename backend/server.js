import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { connectMongoDB } from './config/db.js';
import { getRedisClient } from './config/redisSetup.js';
import { publishMessage, publishBatchMessages } from './utils/kafkaProducer.js';
import { consumeMessages } from './utils/kafkaConsumer.js';
import { initializeSocket } from './sockets/chatSocket.js';
import { startMessageBatching } from './workers/messageWorker.js';
import { logInfo, logError } from './utils/logger.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import { globalErrorHandler } from './utils/errorHandler.js';

const app = express();
const server = createServer(app);

//  Import producer + ensureTopic
import { ensureTopic, producer } from './config/kafka.js';

await ensureTopic("chat-topic"); // replace with your topic name(s)

app.use(express.urlencoded({ extended: true })); 
// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);

// Global error handler
app.use(globalErrorHandler);

// Initialize connections and start server
const startServer = async () => {
  try {
    logInfo('Starting server initialization...', { 
      env: process.env.NODE_ENV,
      kafkaGroupId: process.env.KAFKA_GROUP_ID,
      kafkaBrokers: process.env.KAFKA_BROKERS
    });
    
    await connectMongoDB();
    logInfo('MongoDB connected successfully');
    
    const redisClient = getRedisClient();
    await redisClient.ping(); // Test Redis Cluster connection
    logInfo('Redis connected successfully');
    
    // Explicitly connect Kafka producer
    await producer.connect();
    logInfo('Kafka producer ready and connected');
    
    // Subscribe to Kafka topics here if needed
    // Example: await consumeMessages('chat-messages', (message) => {
    //   console.log('Received message:', message);
    // });
    logInfo('Kafka consumer initialized successfully');
    
    await startMessageBatching();
    logInfo('Message batching started successfully');
    
    initializeSocket(server);
    logInfo('Socket.IO initialized successfully');

    const port = process.env.PORT || 3001;
    server.listen(port, () => {
      logInfo(`Server running on port ${port}`);
    });
  } catch (error) {
    logError('Server startup failed', { 
      error: error.message, 
      stack: error.stack,
      name: error.name,
      code: error.code,
      kafkaGroupId: process.env.KAFKA_GROUP_ID,
      kafkaBrokers: process.env.KAFKA_BROKERS
    });
    console.error('Full error object:', error);
    process.exit(1);
  }
};

startServer();

export default app;
