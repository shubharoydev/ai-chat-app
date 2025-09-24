# Chat Application Backend

## Overview
A scalable, real-time chat application backend built with Node.js, utilizing MongoDB for persistent storage, Redis for caching, Kafka for message queuing, and Socket.IO for real-time communication. Supports user-to-user messaging and AI-powered responses via the Gemini API. Designed for high availability, fault tolerance, and efficient message processing.

## Features
- **Real-Time Messaging**: Instant message delivery using Socket.IO with Redis adapter for scalability
- **AI Integration**: AI-driven responses for messages prefixed with `/ai` using Gemini API
- **Message Persistence**: Stores messages in MongoDB with Redis caching for recent messages
- **Fault Tolerance**: Retries failed Kafka messages periodically
- **Scalable Architecture**: Three-node Kafka cluster with Zookeeper and Redis adapter
- **Friend Management**: Add friends and maintain conversation histories
- **Batch Processing**: Efficient MongoDB persistence in batches
- **JWT Authentication**: Secure WebSocket connections
- **Comprehensive Logging**: Detailed error handling and monitoring

## Tech Stack
- **Node.js** - Backend runtime
- **MongoDB** - Persistent storage
- **Redis** - In-memory caching & Socket.IO adapter
- **Kafka** - Distributed message queue
- **Zookeeper** - Kafka coordination
- **Socket.IO** - Real-time communication
- **Docker** - Containerization

### Key Dependencies
- `mongoose` - MongoDB object modeling
- `async-retry` - Retry failed operations
- `uuid` - Unique message IDs
- `socket.io` & `socket.io-redis-adapter` - Real-time messaging
- `jsonwebtoken` - JWT authentication

## Architecture & Message Flow

### System Architecture Diagram
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Client    │    │   Client    │    │   Client    │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                 ┌────────▼────────┐
                 │Socket.IO Server │
                 └────────┬────────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
    ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼─────┐
    │   Redis     │ │   Kafka   │ │  MongoDB   │
    │  (Caching)  │ │  (Queue)  │ │ (Storage)  │
    └─────────────┘ └───────────┘ └────────────┘
```

### Detailed Message Flow

#### 1. Message Initiation & Real-Time Delivery
![Message Flow](./docs/system-architecture.svg)

#### 2. Message Persistence Pipeline
![Persistence Pipeline](./docs/message-presistence.svg)

#### 3. Failed Message Recovery
![Failed Message Recovery](./docs/failed-message-recovery.svg)

## Installation

### Prerequisites
- Node.js (v16 or higher)
- Docker and Docker Compose
- MongoDB
- Redis

### Setup Instructions

1. **Clone the Repository**
   ```bash
   git clone https://github.com/shubharoydev/ai-chat-app.git
   cd AI-CHAT-APP
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create `.env` file:
   ```env
   MONGODB_URI=mongodb://localhost:27017/chatapp
   REDIS_URL=redis://localhost:6379
   GEMINI_API_KEY=<your-gemini-api-key>
   CLIENT_ORIGIN=http://localhost:5173
   PORT=3000

   #Kafka (✅ Use localhost since app runs outside Docker)
   KAFKA_CLIENT_ID=chat-app
   KAFKA_BROKERS=localhost:9092,localhost:9093,localhost:9094

   # JWT
   JWT_ACCESS_SECRET=<your-jwt-access-secret>
   JWT_REFRESH_SECRET=<your-jwt-refresh-secret>
   JWT_ACCESS_EXPIRY=1h
   JWT_REFRESH_EXPIRY=28d

   # Arcjet & Gemini
   ARCJET_ENV=development
   ARCJET_KEY=<your-arcjet-key>
   ```

4. **Start Infrastructure Services**
   ```bash
   docker-compose up -d
   ```

5. **Launch Application**
   ```bash
   npm start
   ```

6. **Access Monitoring**
   - Kafka UI: http://localhost:8080



## Docker Compose Configuration

The `docker-compose.yml` sets up:

- **Zookeeper Cluster**: 3 nodes for coordination
- **Kafka Cluster**: 3 brokers with 3 partitions
- **Kafka UI**: Web monitoring interface
- **Network**: `kafka-net` bridge network

### Service Management
```bash
# Start all services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f kafka
```

## Error Handling & Reliability

### Failure Recovery Strategies
- **Socket.IO**: JWT authentication failures emit error events to clients
- **Kafka**: Failed publishes stored in Redis with 7-day TTL, retried every 30 minutes
- **MongoDB**: Bulk write failures trigger exponential backoff retries (max 3 attempts)
- **Redis**: Message caching with automatic expiration

### Monitoring & Logging
- Comprehensive error logging with `logError` and `logInfo`
- Real-time client error feedback via Socket.IO
- Kafka UI for queue monitoring

## Scalability Features

### Horizontal Scaling
- **Socket.IO**: Redis adapter enables multi-node deployments
- **Kafka**: Three-partition distributed processing
- **Redis**: Reduces database load through intelligent caching
- **MongoDB**: Optimized bulk operations with upserts

### Performance Optimizations
- Batch message processing (5-minute intervals)
- Redis caching of recent conversations
- Connection pooling and efficient resource utilization

## Future Enhancements

* 🧠 Enhanced AI context awareness
* 👤 User online/offline status and presence navigation
* 📎 Media sharing (images, videos, documents, etc.)

### Infrastructure Improvements
- Kubernetes deployment configuration
- Load balancing implementation
- Advanced metrics and alerting

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m "Add amazing feature"`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License. See [LICENSE](https://opensource.org/licenses/MIT) file for details.