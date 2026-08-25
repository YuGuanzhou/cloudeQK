FROM node:22-alpine

WORKDIR /app/server

COPY --chown=node:node server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server/src ./src
COPY --chown=node:node web /app/web
RUN mkdir -p data && chown node:node data

ENV NODE_ENV=production PORT=6001
EXPOSE 6001
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:6001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
