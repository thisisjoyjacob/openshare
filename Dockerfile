FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Create directories for the application
RUN mkdir -p public uploads

# Copy application files
COPY server.js ./
COPY public/index.html ./public/
COPY public/manifest.json ./public/
COPY public/service-worker.js ./public/
COPY public/icon-192x192.png ./public/
COPY public/icon-512x512.png ./public/

# Set permissions for uploads directory
RUN chmod 777 uploads

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "server.js"]
