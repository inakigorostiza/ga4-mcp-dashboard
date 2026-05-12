FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application files
COPY server.js .
COPY public/ ./public/

# Expose port (Cloud Run uses 8080 by default, but we'll use PORT env var)
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
