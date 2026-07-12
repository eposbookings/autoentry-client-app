# --- STAGE 1: Build the React Application ---
FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies using wildcard to catch both package.json & package-lock.json
COPY package*.json ./
RUN yarn install

# Copy application source code and compile static production files
COPY . .

ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

RUN npm run build

FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

RUN yarn add serve@^14.2.6 --omit=dev

# Copy only the production build output from the builder stage
COPY --link --from=builder /app/build ./build


# Expose port 3000 (the same port configured in "serve -l 3000")
EXPOSE 3000

CMD ["npx", "serve", "-s", "build", "-l", "3000"]