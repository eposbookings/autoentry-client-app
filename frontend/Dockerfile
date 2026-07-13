# --- STAGE 1: Build the React Application ---
FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies from the committed pnpm lockfile for repeatable VPS builds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@9.15.9 \
    && pnpm install --frozen-lockfile --reporter=append-only

# Copy application source code and compile static production files
COPY . .

ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

RUN pnpm run build

FROM nginx:stable-alpine AS runner

# Copy only the production build output from the builder stage.
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
