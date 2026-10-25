# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /setup
COPY package.json ./
# Optional: behind a TLS-intercepting proxy, build with
#   docker compose build --secret id=npm_ca,src=/path/to/ca.pem   (or see README)
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then npm config set cafile /run/secrets/npm_ca; fi; \
    npm install --omit=dev --no-audit --no-fund
COPY *.mjs ./
CMD ["node", "setup.mjs"]
