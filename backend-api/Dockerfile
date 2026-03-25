# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

# Install and build
RUN npm ci
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --production

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist

# Copy data files
COPY src/data ./dist/data

# Expose port
EXPOSE 3000
EXPOSE 3001

# Start server
CMD ["node", "dist/index.js"]
