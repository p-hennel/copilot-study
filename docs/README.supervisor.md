# Supervisor System - Docker Support

This document explains how to use the Supervisor system in a Docker container environment.

## Overview

The Supervisor system manages both the web application and crawler processes, facilitating inter-process communication between them. In a Docker environment, this requires running in foreground mode to keep the container active.

## Getting Started

### Using Docker Compose

The easiest way to start the system is with Docker Compose:

```bash
docker-compose -f docker-compose.supervisor.yml up -d
```

This will:
1. Build the Docker image using Dockerfile.supervisor
2. Start the container in detached mode
3. Map ports 3000 (web app) and 9090 (monitoring) to your host
4. Mount volumes for logs and data

### Using Docker Directly

If you prefer to use Docker directly:

```bash
# Build the image
docker build -t my-app-supervisor -f Dockerfile.supervisor .

# Run the container
docker run -d \
  --name my-app \
  -p 3000:3000 \
  -p 9090:9090 \
  -v ./logs:/app/logs \
  -v ./data:/app/data \
  my-app-supervisor
```

## Command Line Options

The Supervisor CLI supports several command-line options for Docker environments:

```
--foreground, -f            Run in foreground/non-daemonized mode (ideal for Docker)
--config, -c <path>         Path to config file
--web-server, -w <cmd>      Command to start the web server
--crawler, -cr <cmd>        Command to start the crawler
--log-dir, -l <path>        Directory for log files
```

## Container Health Checks

The Docker configuration includes health checks that monitor the system's status. The health check endpoint is available at:

```
http://localhost:9090/health
```

This endpoint reports the status of all managed processes.

## Logs

Logs are stored in the container at `/app/logs` and mounted to the host at `./logs` when using the provided Docker configuration.

The system will output logs both to files and to the console when running in foreground mode, making it easy to view logs with:

```bash
docker logs -f my-app
```

## Troubleshooting

If the container exits unexpectedly, check:

1. Docker logs to see the reason for exit:
   ```bash
   docker logs my-app
   ```

2. System logs in the mounted logs directory:
   ```bash
   cat logs/supervisor.log
   ```

3. Container health status:
   ```bash
   docker inspect --format='{{.State.Health.Status}}' my-app
   ```

## Advanced Configuration

For advanced configuration of the Supervisor system in Docker, you can modify:

1. The `Dockerfile.supervisor` to change how the image is built
2. The `docker-compose.supervisor.yml` to adjust container settings
3. The initialization command with different parameters for the web server and crawler
