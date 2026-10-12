@echo off
REM Starts the backend against the LOCAL docker-compose infrastructure,
REM independent of the cloud (Aiven) settings in backend\.env.
REM KAFKA_MODE=local is an explicit override consumed by config/kafka.js and
REM wins over SERVICE_URI, so no attempt is made to reach the cloud broker.
set "KAFKA_MODE=local"
set "KAFKA_BROKERS=localhost:9092,localhost:9093,localhost:9094"
set "MONGODB_URI=mongodb://localhost:27017/chatapp_k6"
set "REDIS_URL=redis://localhost:6379/2"
set "DISABLE_ARCJET=true"
set "PORT=4100"
set "NODE_ENV=development"
set "CLIENT_ORIGIN=http://localhost:5173"
cd /d "%~dp0..\..\backend"
node server.js
