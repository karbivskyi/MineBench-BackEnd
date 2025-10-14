# Use official Node.js LTS image
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# Build TypeScript (if needed)
RUN npm run build || true

EXPOSE 3000

CMD ["npm", "run", "dev"]
