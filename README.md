# copilot-study

This repository contains everything needed to build and run the copilot-study Svelte project.

---

## Overview

**copilot-study** is the primary entrypoint for study participants in the Copima platform. It provides a participant-centric web interface for authorizing data collection, tracking progress, and downloading collected data. The application also includes an admin UI for managing studies and monitoring crawler jobs.

---

## Key Features

### Participant Experience

- **Entry Point:**  
  Participants access the study via the main entrypoint at `/`. The UI guides users through the study process, starting with authentication and continuing through progress tracking and data access.

- **Authentication (oAuth):**  
  Participants authenticate using oAuth by visiting the home page and, depending on the configured providers, actively mark their consent and click the provider's button.
  **Flow:**  
  1. Visit home page
  2. Read through the study description
  3. Indicate explicit consent via toggle switch
  4. Click the provider button
  5. Redirection to provider's OAuth-Flow
    1. Read through permissions activated
    2. Authorize or reject the request for access
  3. Redirect to the home page

- **Area/Project Authorization:**  
  After authentication, participants can view the areas (groups/projects) they have authorized for data collection. The UI provides filtering, searching, and sorting for easy navigation.

- **Progress Tracking:**  
  The dashboard displays real-time progress indicators for all authorized areas, projects, and jobs. Participants can see job status, completion rates, and detailed breakdowns.  
  - Progress is updated live as jobs complete.
  - Job summaries and area/project completion rates are clearly visualized.

- **Data Download:**  
  Once data collection jobs are complete, participants can download their collected data directly from the application.  
  - Data is available in a user-friendly overview for those interested as it becomes available over time.

- **Transparency:**  
  Participants can always see which data is being collected and investigate the (anonymized) data themselves if they like.

### Admin Experience

- **Study Management:**  
  Admins can configure, launch, and monitor studies, manage user accounts, and oversee crawler jobs.
- **Real-Time Monitoring:**  
  Admin UI provides real-time logs, job status, and system health.
- **REST and Socket APIs:**  
  Integration points for automation and external tools.

---

## UI Structure and Routes

- [`/`](src/routes/+page.svelte:1): Main participant dashboard (progress, areas, jobs)
- [`/data/download`](src/routes/data/download/:1): Download collected data
- [`/admin`](src/routes/admin/:1): Admin dashboard and management UI

---

## Development

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

---

## Building

To create a production build:

```bash
bun run build
```

You can preview the production build with:

```bash
bun run preview
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

---