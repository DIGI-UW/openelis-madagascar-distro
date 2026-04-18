# Playwright test runner with Docker CLI for DB cleanup helpers (docker exec).
# Build: docker build -f Dockerfile .
# Run:   docker run --rm -it --network host -v /var/run/docker.sock:/var/run/docker.sock <image>

FROM mcr.microsoft.com/playwright:v1.49.1-jammy

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY playwright ./playwright
COPY playwright.config.ts ./

RUN npm install

CMD ["npm", "run", "test:harness-demo"]
