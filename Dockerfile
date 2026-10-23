# Nexoraith store: zero npm dependencies, Node >= 22.13 (built-in SQLite).
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/nexoraith.db UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY data/catalogue ./data/catalogue
COPY scripts ./scripts
# /data is the persistent volume (database + uploaded files). Mount a Coolify persistent storage here.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.js"]
