FROM node:20-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl python3 python3-pip && rm -rf /var/lib/apt/lists/*

# 1. Install and build aiprocess-api first
COPY aiprocess-api/package*.json ./aiprocess-api/
COPY aiprocess-api/prisma ./aiprocess-api/prisma
RUN cd aiprocess-api && npm ci --legacy-peer-deps && npx prisma generate

# 2. Install server dependencies
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# 3. Copy everything else
COPY . .

# 4. Install Python dependencies for Qwen transcription
RUN pip3 install --no-cache-dir --break-system-packages -r aiprocess-api/python_service/requirements.txt

# 5. Build aiprocess
RUN cd aiprocess-api && npm run build

ENV PORT=8080
ENV AIPROCESS_PORT=8081
EXPOSE 8080 8081

CMD ["npx", "concurrently", "\"node server.js\"", "\"cd aiprocess-api && PORT=8081 node dist/index.js\""]
