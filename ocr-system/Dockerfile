# Use Node.js 18 slim image for a smaller footprint
FROM node:18-slim

# Install system dependencies required for pdf-poppler and other tools
# poppler-utils is essential for pdf-poppler to work
RUN apt-get update && apt-get install -y \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose the API port
EXPOSE 5005

# Start the application
CMD ["npm", "start"]
