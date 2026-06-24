FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=0 /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
