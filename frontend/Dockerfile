# --- STAGE 1: Build the React Application ---
FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies from the committed pnpm lockfile for repeatable VPS builds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@9.15.9 \
    && pnpm install --frozen-lockfile

# Copy application source code and compile static production files
COPY . .

ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

RUN pnpm run build

FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

RUN npm install -g serve@14.2.6

# Copy only the production build output from the builder stage
COPY --link --from=builder /app/build ./build


# Expose port 3000 (the same port configured in "serve -l 3000")
EXPOSE 3000

CMD ["serve", "-s", "build", "-l", "3000"]
