FROM node:20-slim

WORKDIR /app

# ── System deps (cached unless base image changes) ───────────
RUN apt-get update -y && apt-get install -y openssl python3 python3-pip && rm -rf /var/lib/apt/lists/*

# ── Layer 1: aiprocess-api npm deps + prisma (cached unless package*.json changes) ──
COPY aiprocess-api/package*.json ./aiprocess-api/
COPY aiprocess-api/prisma ./aiprocess-api/prisma
RUN cd aiprocess-api && npm ci --legacy-peer-deps && npx prisma generate

# ── Layer 2: server.js npm deps (cached unless package*.json changes) ──
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# ── Layer 3: Python deps (cached unless requirements.txt changes) ──
COPY aiprocess-api/python_service/requirements.txt ./aiprocess-api/python_service/
RUN pip3 install --no-cache-dir --break-system-packages -r aiprocess-api/python_service/requirements.txt

# ── Layer 4: Source code (changes every build, but layers above are cached) ──
# ARG CACHEBUST forces this layer to rebuild when commit SHA changes,
# preventing --cache-from from reusing stale COPY layers
ARG CACHEBUST=unknown
COPY . .

# ── Layer 5: TypeScript build ──
RUN cd aiprocess-api && npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV AIPROCESS_PORT=8081
EXPOSE 8080 8081

CMD ["npx", "concurrently", "\"node server.js\"", "\"cd aiprocess-api && PORT=8081 node dist/index.js\""]
