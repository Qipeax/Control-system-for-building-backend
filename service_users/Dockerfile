FROM node:18-alpin

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 8000

CMD ["node", "server.js"]