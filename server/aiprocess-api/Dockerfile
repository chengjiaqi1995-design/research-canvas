# 使用 Node.js 官方镜像
FROM node:20-slim

# 安装 Python 和必要的依赖（用于 Python 转录服务）
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY prisma.config.ts ./

# 安装 Node.js 依赖
RUN npm ci --only=production

# 复制 Prisma schema
COPY prisma ./prisma

# 生成 Prisma Client
RUN npx prisma generate

# 复制 Python 服务文件
COPY python_service ./python_service

# 安装 Python 依赖
RUN pip3 install --no-cache-dir -r python_service/requirements.txt

# 复制源代码
COPY . .

# 构建 TypeScript
RUN npm run build

# 暴露端口
EXPOSE 3001

# 启动命令 — 先同步数据库 schema（幂等操作），再启动服务
CMD npx prisma db push --skip-generate && npm start


