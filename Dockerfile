# Image de production du bot
FROM node:22-alpine

ENV NODE_ENV=production \
    HEARTBEAT_FILE=/tmp/heartbeat \
    DATABASE_PATH=/app/data/bot.db \
    BACKUP_DIR=/app/backups

WORKDIR /app

# Dépendances d'abord (mises en cache tant que package*.json ne change pas), sans les outils de dev
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Code du bot (le .env et la base ne sont jamais copiés : voir .dockerignore)
# Le code appartient à root : l'utilisateur "node" peut le lire mais pas le modifier
COPY . .
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups

# Jamais en root
USER node

HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
    CMD ["node", "scripts/healthcheck.js"]

CMD ["node", "--disable-warning=ExperimentalWarning", "main.js"]
