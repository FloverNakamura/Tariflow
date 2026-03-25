# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy backend-api files
COPY backend-api/package*.json ./
COPY backend-api/tsconfig.json ./
COPY backend-api/src ./src

# Install and build
RUN npm ci
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY backend-api/package*.json ./

# Install only production dependencies
RUN npm ci --production

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist

# Set PORT
ENV PORT=3001

# Start server
CMD ["node", "dist/index.js"]
