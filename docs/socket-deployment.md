# Socket Communication System – Deployment Guide

This guide provides step-by-step instructions for deploying the socket communication system, enabling real-time communication between the web application and crawler instances.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [System Dependencies](#system-dependencies)
- [Deployment Steps](#deployment-steps)
- [Production Configuration](#production-configuration)
- [Monitoring Setup](#monitoring-setup)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Performance Optimization](#performance-optimization)
- [Deployment Checklist](#deployment-checklist)

---

## Prerequisites

- **OS:** Linux (Ubuntu 20.04+/CentOS 8+) or macOS
- **Node.js:** v18+
- **Memory:** 2GB+ (4GB+ recommended)
- **PostgreSQL:** 14+
- **Redis:** 6+ (optional)
- **Docker:** 20.10+ (optional)
- **PM2/systemd:** For process management

---

## Environment Configuration

Create `.env.development` and `.env.production` for different stages.  
See [`types/config.ts`](../src/lib/server/socket/types/config.ts:2) for all options.

**Example (development):**
```bash
NODE_ENV=development
SOCKET_PATH=/tmp/gitlab-crawler-dev.sock
SOCKET_LOG_LEVEL=debug
SOCKET_MAX_CONNECTIONS=3
DATABASE_URL=postgresql://user:password@localhost:5432/copilot_study_dev
```

**Example (production):**
```bash
NODE_ENV=production
SOCKET_PATH=/var/run/copilot-study/crawler.sock
SOCKET_LOG_LEVEL=info
SOCKET_MAX_CONNECTIONS=10
DATABASE_URL=postgresql://prod_user:secure_password@db-server:5432/copilot_study_prod
```

---

## Database Setup

- Validate schema for `jobs`, `areas`, and socket-specific tables.
- Run migrations as needed.
- Test connectivity:
  ```bash
  npm run test:db-connection
  psql "${DATABASE_URL}" -c "SELECT 1;"
  ```

---

## System Dependencies

- Install Node.js dependencies:
  ```bash
  npm install
  ```
- Install system-level dependencies:
  ```bash
  sudo apt install -y postgresql-client redis-tools curl wget
  ```

---

## Deployment Steps

### Development

```bash
git clone <repository-url> copilot-study
cd copilot-study
npm install
cp .env.example .env.development
npm run db:migrate
npm run dev
```

### Production

**Direct:**
```bash
npm run build
cp .env.example .env.production
npm run db:migrate:prod
pm2 start ecosystem.config.js --env production
```

**Docker:**
```bash
docker build -t copilot-study:latest .
docker-compose -f docker-compose.prod.yml up -d
```

**Socket Server Integration:**
See [SocketServer](../src/lib/server/socket/socket-server.ts) and [API Reference](./socket-api.md).

---

## Production Configuration

- Use PM2 or systemd for process management.
- Example `ecosystem.config.js` and systemd service files are provided in the original deployment guide.
- Configure Nginx as a reverse proxy if needed.

---

## Monitoring Setup

- Add health check endpoints to your server.
- Configure log rotation and monitoring (e.g., Prometheus).
- Example health check:
  ```typescript
  app.get('/health/socket', async (req, res) => {
    const status = socketServer.getStatus();
    res.json({ status: status.isRunning ? 'healthy' : 'unhealthy' });
  });
  ```

---

## Troubleshooting

- **Socket connection issues:** Check socket file permissions and remove stale files.
- **Database issues:** Test connectivity and monitor connection pool.
- **Memory issues:** Monitor usage and configure memory limits.
- **Permission issues:** Ensure correct ownership and permissions for socket files.
- **Debugging:** Set `SOCKET_LOG_LEVEL=debug` and use log analysis tools.

---

## Security Considerations

- Restrict socket file permissions.
- Limit network access to localhost.
- Validate all incoming messages.
- Secure credentials and use environment variables.
- Mask sensitive data in logs.

---

## Performance Optimization

- Tune database indexes and connection pool size.
- Adjust socket server configuration for your environment.
- Monitor metrics and resource usage.

---

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Database schema up to date
- [ ] Dependencies installed
- [ ] SSL certificates configured (production)
- [ ] Monitoring and logging setup
- [ ] Application builds successfully
- [ ] Database migrations run
- [ ] Socket server starts and accepts connections
- [ ] Health checks return positive status
- [ ] Log files are being written
- [ ] Process manager configured
- [ ] Crawler can connect to socket server
- [ ] Message exchange tested
- [ ] Error logs monitored
- [ ] Database operations verified
- [ ] Graceful shutdown tested

---

For detailed configuration options and troubleshooting, see [API Reference](./socket-api.md) and [Implementation Summary](./socket-implementation.md).