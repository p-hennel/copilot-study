# copilot-study

This repository contains everything needed to build and run the copilot-study Svelte project.

## Creating a Project

This repository is already set up for development. To start a new project, clone this repository:

```bash
git clone <repository-url> copilot-study
cd copilot-study
```

## Developing

Install dependencies with Bun (recommended):

```bash
bun install
```

Start a development server:

```bash
bun run dev

# or start the server and open the app in a new browser tab
bun run dev -- --open
```

## Building

To create a production build:

```bash
bun run build
```

---

## Running the Backend with Docker

You can run the copilot-study backend using Docker for a consistent and isolated environment.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 20.10+ installed
- [docker-compose](https://docs.docker.com/compose/) (if using Compose)
- [Bun](https://bun.sh/) (for local development and hasher builds)

### Build and Run

#### 1. Build the Docker image

```bash
docker build -t copilot-study-backend .
```

#### 2. Run with Docker Compose

A sample Compose file is provided as `example-docker-compose.yaml`:

```yaml
version: "3.8"
services:
  surveytool:
    build: .
    image: copilot-study-backend
    container_name: copilot-study-backend
    ports:
      - "3000:3000"
    environment:
      - LOG_LEVEL=info
      - BETTER_AUTH_SECRET=your-secret
      - SOCKET_PATH=/tmp/copilot-study.sock
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
      - BACKUP_PATH=/home/bun/data/backup
    volumes:
      - ./data/logs:/home/bun/data/logs
      - ./data/archive:/home/bun/data/archive
      - ./data/config:/home/bun/data/config
      - ./data/backup:/home/bun/data/backup
    command: ["./startup.sh", "./web/index.js"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/admin/health"]
      interval: 30s
      timeout: 10s
      retries: 5
```

Start the backend:

```bash
docker compose -f example-docker-compose.yaml up -d
```

#### 3. Stopping the backend

```bash
docker compose -f example-docker-compose.yaml down
```

### Environment Variables

- `LOG_LEVEL` – Logging verbosity (e.g., `info`, `debug`)
- `BETTER_AUTH_SECRET` – Secret for authentication (required)
- `SOCKET_PATH` – Path for the Unix socket file
- `OTEL_EXPORTER_OTLP_ENDPOINT` – (Optional) OpenTelemetry endpoint for tracing
- `BACKUP_PATH` – (Optional) Path for backup storage

### Volumes

- `./data/logs:/home/bun/data/logs` – Persistent logs
- `./data/archive:/home/bun/data/archive` – Persistent archive data
- `./data/config:/home/bun/data/config` – Persistent configuration
- `./data/backup:/home/bun/data/backup` – Persistent backup data

### Ports

- `3000` – Main backend HTTP API and healthcheck

### Healthcheck

The container exposes `/api/admin/health` for health monitoring. The Compose healthcheck ensures the backend is running and responsive.

For more details, see [`docs/socket-deployment.md`](docs/socket-deployment.md:1).

You can preview the production build with `bun run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

### Hasher Build Scripts

Raw hasher build scripts are provided for advanced users. These scripts use Bun to compile platform-specific binaries for the hasher utility:

```json
"build:hasher": "bun run build:hasher:unix64 && bun run build:hasher:win64 && bun run build:hasher:darwinx64 && bun run build:hasher:darwinarm",
"build:hasher:unix64": "bun build --compile --target=bun-linux-x64-modern ./src/lib/hasher.ts --outfile ./build/hasher-unix-x64",
"build:hasher:win64": "bun build --compile --target=bun-windows-x64-modern ./src/lib/hasher.ts --outfile ./build/hasher-win-x64",
"build:hasher:darwinx64": "bun build --compile --target=bun-darwin-x64 ./src/lib/hasher.ts --outfile ./build/hasher-darwin-x64",
"build:hasher:darwinarm": "bun build --compile --target=bun-darwin-arm64 ./src/lib/hasher.ts --outfile ./build/hasher-darwin-arm64"
```

These are not required for most development workflows.
