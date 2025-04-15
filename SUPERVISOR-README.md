# GitLab Crawler and Website Supervisor

This document explains how to use the simple supervisor to run both the GitLab crawler and the website together.

## Overview

The supervisor is a simple process manager that:

1. Starts both the crawler and website processes
2. Manages inter-process communication between them via Unix sockets
3. Automatically restarts processes if they crash
4. Provides clean shutdown of all processes
5. Facilitates secure credential sharing from the website to the crawler

## Getting Started

### Basic Usage

To start both the website and crawler with default settings:

```bash
bun run start
```

This is equivalent to:

```bash
bun run supervisor start
```

### Start Individual Processes

To start only the website:

```bash
bun run start:website
```

To start only the crawler:

```bash
bun run start:crawler
```

## Authentication Flow

The system uses a secure credential flow:

1. The supervisor starts the website process first
2. The website connects to the supervisor via a dedicated authentication socket
3. The website passes GitLab authentication credentials to the supervisor
4. The supervisor starts the crawler only after receiving credentials 
5. The supervisor passes the credentials to the crawler as environment variables

This approach:
- Centralizes credential management in the website
- Avoids storing credentials in environment variables (optional)
- Ensures the crawler has valid credentials before starting
- Allows credential updates without restarting processes

## Process Communication

The crawler and website communicate using inter-process communication (IPC) via Unix sockets. This allows:

1. The crawler to report discovered jobs to the website
2. The website to store these jobs in the database
3. The website to send commands to the crawler
4. The crawler to report job statuses back to the website

## Job Planning

The main feature implemented is job planning via IPC:

1. When the crawler discovers new resources (groups, projects, etc.), it creates job objects
2. Instead of directly enqueueing these jobs, it sends them via IPC to the website
3. The website receives these jobs and stores them in the database
4. Available crawlers can later pick up these jobs from the database and execute them

This approach provides several benefits:
- Jobs are stored persistently (not just in memory)
- Multiple crawler processes can discover and execute jobs
- The web UI can show all discovered jobs, even before execution
- Better control over which jobs run and when
- Improved error handling for failed jobs

## Stopping the Processes

To stop all processes, press `Ctrl+C` in the terminal where the supervisor is running. The supervisor will send termination signals to all child processes and perform a clean shutdown.

## Troubleshooting

If the crawler fails to start or connect to GitLab:

1. Make sure the website has valid GitLab credentials configured
2. Check that the authentication socket (`AUTH_IPC_SOCKET_PATH`) environment variable is set
3. Verify that the supervisor logs show credentials being received
