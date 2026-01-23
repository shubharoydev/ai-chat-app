# AI Chat App API Documentation

## Overview

This is a comprehensive REST API documentation for the AI Chat Application. The API provides user authentication, friend management, real-time messaging, and user status tracking capabilities.

**Base URL**: `http://localhost:3000` (development)
**API Version**: 1.0
**Content-Type**: `application/json`

## Authentication

The API uses JWT (JSON Web Tokens) for authentication with access and refresh token pattern:

- **Access Token**: Short-lived token (15 minutes) for API requests
- **Refresh Token**: Long-lived token (7 days) for token renewal
- Both tokens are stored in HTTP-only cookies for security

### Rate Limiting

All endpoints are protected with Arcjet rate limiting:
- Authentication endpoints: 5-10 requests per 10 seconds
- User management: 1-2 requests per request
- Chat endpoints: 1-2 requests per request

---

## Authentication Endpoints

### POST /api/auth/signup
**Description**: Register a new user account

**Request Body**:
```json
{
  "name": "string (2-50 characters)",
  "email": "string (valid email)",
  "password": "string (min 8 characters)"
}
```

**Response**:
- **201 Created**:
```json
{
  "message": "User created",
  "user": {
    "id": "string",
    "name": "string",
    "email": "string"
  }
}
```
- **400 Bad Request**: Validation errors
- **409 Conflict**: Email already exists

**Cookies Set**:
- `accessToken`: HTTP-only, secure, strict sameSite
- `refreshToken`: HTTP-only, secure, strict sameSite

---

### POST /api/auth/login
**Description**: Authenticate user and receive tokens

**Request Body**:
```json
{
  "email": "string (valid email)",
  "password": "string"
}
```

**Response**:
- **200 OK**:
```json
{
  "message": "Login successful",
  "user": {
    "id": "string",
    "name": "string",
    "email": "string"
  },
  "tokens": {
    "accessToken": "string",
    "refreshToken": "string"
  }
}
```
- **400 Bad Request**: Validation errors
- **401 Unauthorized**: Invalid credentials

**Cookies Set**:
- `accessToken`: HTTP-only, secure, strict sameSite
- `refreshToken`: HTTP-only, secure, strict sameSite

---

### POST /api/auth/refresh-token
**Description**: Refresh access token using refresh token

**Request Body** (Optional):
```json
{
  "refreshToken": "string" // If not provided, uses cookie
}
```

**Response**:
- **200 OK**:
```json
{
  "message": "Token refreshed",
  "accessToken": "string",
  "userId": "string"
}
```
- **400 Bad Request**: Refresh token required
- **401 Unauthorized**: Invalid/expired refresh token

**Cookies Updated**:
- `accessToken`: New access token set

---

### POST /api/auth/logout
**Description**: Logout user and invalidate tokens

**Request Body**:
```json
{
  "userId": "string"
}
```

**Response**:
- **200 OK**:
```json
{
  "message": "Logout successful"
}
```
- **400 Bad Request**: User ID required

**Cookies Cleared**:
- `accessToken`: Removed
- `refreshToken`: Removed

---

### GET /api/auth/me
**Description**: Get current user information

**Headers**: Requires valid refresh token cookie

**Response**:
- **200 OK**:
```json
{
  "user": {
    "id": "string",
    "name": "string",
    "email": "string"
  }
}
```
- **401 Unauthorized**: No session or invalid session

---

## User Management Endpoints

### POST /api/users/friends
**Description**: Add a new friend. This creates a mutual friendship.

**Authentication**: Required (Bearer token or cookie)

**Request Body**:
```json
{
  "email": "string (valid email)",
  "nickname": "string (2-50 characters, optional)"
}
```

**Response**:
- **201 Created**:
```json
{
  "message": "Friend added",
  "friend": {
    "id": "string",
    "name": "string",
    "email": "string",
    "nickname": "string"
  }
}
```
- **400 Bad Request**: Validation errors or cannot add self
- **404 Not Found**: User not found
- **409 Conflict**: Already friends

---

### PUT /api/users/friends/nickname
**Description**: Update friend's nickname

**Authentication**: Required

**Request Body**:
```json
{
  "friendId": "string",
  "nickname": "string (2-50 characters)"
}
```

**Response**:
- **200 OK**:
```json
{
  "message": "Nickname updated",
  "friend": {
    "id": "string",
    "nickname": "string"
  }
}
```
- **400 Bad Request**: Friend ID and nickname required
- **404 Not Found**: Friend not found

---

### GET /api/users/search
**Description**: Search for users by name or email

**Authentication**: Required

**Query Parameters**:
- `query`: string (search term)

**Response**:
- **200 OK**:
```json
{
  "users": [
    {
      "_id": "string",
      "name": "string",
      "email": "string"
    }
  ]
}
```
- **400 Bad Request**: Query parameter required
- **404 Not Found**: No users found

---

### GET /api/users/friends
**Description**: Get user's friend list

**Authentication**: Required

**Response**:
- **200 OK**:
```json
{
  "friends": [
    {
      "id": "string",
      "name": "string",
      "email": "string"
    }
  ]
}
```

---

## Chat Endpoints

### POST /api/chat/messages
**Description**: Send a message to a friend

**Authentication**: Required

**Request Body**:
```json
{
  "friendId": "string",
  "content": "string (1-1000 characters)"
}
```

**Response**:
- **201 Created**:
```json
{
  "message": "Message sent",
  "data": {
    "messageId": "string",
    "chatId": "string",
    "userId": "string",
    "friendId": "string",
    "content": "string",
    "timestamp": "string (ISO)",
    "isAI": false,
    "tempId": "string (optional)"
  }
}
```
- **400 Bad Request**: Validation errors
- **404 Not Found**: Friend not found

---

### GET /api/chat/messages/:friendId
**Description**: Get chat history with a friend. Returns last 20 messages.

**Authentication**: Required

**Path Parameters**:
- `friendId`: string (friend's user ID)

**Query Parameters**:
- `page`: number (default: 1)
- `limit`: number (default: 20, max: 100)

**Response**:
- **200 OK**:
```json
{
  "messages": [
    {
      "_id": "string",
      "messageId": "string",
      "chatId": "string",
      "userId": "string",
      "friendId": "string",
      "content": "string",
      "timestamp": "string (ISO)",
      "isAI": false,
      "createdAt": "string",
      "updatedAt": "string",
      "__v": 0
    }
  ]
}
```
- **400 Bad Request**: Friend ID required

---

## Database & Message Persistence

The application employs a robust, multi-layer strategy for message handling to ensure performance and reliability.

### Message Flow Architecture

1.  **Immediate Caching (Redis)**:
    - When a message is sent, it is immediately pushed to a Redis list (`chat:recent:${chatId}`).
    - This ensures instant retrieval for the user and their friend.
    - Redis keys have a 7-day TTL (Time To Live).

2.  **Asynchronous Persistence (Kafka)**:
    - Simultaneously, the message is published to a Kafka topic (`chat-messages-persist`).
    - This decouples the heavy write operation from the real-time user flow.

3.  **Batch Processing (Worker)**:
    - A dedicated background worker consumes messages from Kafka.
    - Messages are buffered in memory.
    - Every 5 minutes (or when the buffer is full), the worker performs a **Bulk Write** to MongoDB.

4.  **Database Storage (MongoDB)**:
    - Messages are stored in the `messages` collection.
    - **Upsert Strategy**: The worker uses `bulkWrite` with `upsert: true` based on the unique `messageId`. This ensures idempotency; if a message is processed twice, it won't create a duplicate.
    - **Schema**:
      ```javascript
      {
        messageId: String, // Unique UUID
        chatId: String,    // Composite key (sorted userId:friendId)
        userId: ObjectId,  // Sender
        friendId: ObjectId,// Receiver
        content: String,
        timestamp: Date,
        isAI: Boolean
      }
      ```

---

## WebSocket Events

The application uses Socket.IO for real-time communication.

### Connection
**URL**: `ws://localhost:3000` (development)
**Authentication**: Required via cookies (accessToken or refreshToken)

### Events

#### Client to Server

**sendMessage**:
```json
{
  "friendId": "string",
  "content": "string",
  "tempId": "string" // Temporary ID for optimistic updates
}
```

**heartbeat**: 
- No payload, used to maintain online status

**check-status**:
```json
{
  "friendIds": ["string", "string"]
}
```

#### Server to Client

**receiveMessage**:
```json
{
  "messageId": "string",
  "chatId": "string",
  "userId": "string",
  "friendId":"string",
  "content": "string",
  "isAI": false,
  "timestamp": "string (ISO)",
  "tempId": "string"
}
```

**friend-status**:
```json
{
  "userId": "string",
  "status": "online|offline"
}
```

---

## Error Handling

### Standard Error Response Format
```json
{
  "error": "string",
  "message": "string",
  "statusCode": "number",
  "timestamp": "string (ISO)"
}
```

### Rate Limiting Errors
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests, please try again later",
  "retryAfter": "number" // Seconds to wait
}
```
## Security Features

### Authentication & Authorization
- JWT-based authentication with access/refresh token pattern  
- HTTP-only cookies to prevent XSS attacks  
- Secure cookie flags in production  
- Token blacklisting on logout  

### Rate Limiting
- Arcjet-based rate limiting on all endpoints  
- Different limits for different endpoint types  
- Token bucket algorithm for fair usage  

### Data Validation
- Joi schema validation for all input data  
- Sanitization of user inputs  
- Length limits on text fields  

### CORS Configuration
- Configured for specific client origin  
- Credentials allowed for cookie-based authentication  
- Proper headers for cross-origin requests  

