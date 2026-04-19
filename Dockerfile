# ============================================================================
# FreightConnect — Multi-Stage Production Dockerfile
# ============================================================================

# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# Install dependencies first (layer cache)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy source and build
COPY frontend/ ./
ENV REACT_APP_API_URL=/api
RUN npm run build


# Stage 2: Production backend + static frontend
FROM node:20-alpine AS production

# Install curl for health check and dumb-init for proper signal handling
RUN apk add --no-cache curl dumb-init

# Create non-root user
RUN addgroup -S freight && adduser -S freight -G freight

WORKDIR /app

# Install backend dependencies (production only)
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Copy backend source
COPY backend/ ./

# Copy frontend build from stage 1
COPY --from=frontend-build /app/frontend/build ./frontend-build

# Create uploads directory and set permissions
RUN mkdir -p public/documents/uploads public/documents/receipts \
    && chown -R freight:freight /app

# Switch to non-root user
USER freight

# Expose the API port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

# Use dumb-init to handle PID 1 and forward signals
ENV NODE_ENV=production
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "app.js"]
