# Socket Communication System - Deployment Guide

This guide provides comprehensive step-by-step instructions for deploying the socket communication system that enables real-time communication between the web application and GitLab crawler instances.

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

## Prerequisites

### System Requirements
- **Operating System**: Linux (Ubuntu 20.04+ or CentOS 8+) or macOS
- **Node.js**: Version 18.0.0 or higher
- **Memory**: Minimum 2GB RAM (4GB+ recommended for production)
- **Storage**: 10GB+ available disk space
- **Network**: Reliable network connectivity for GitLab API access

### Software Dependencies
- PostgreSQL 14+ (for database operations)
- Redis 6+ (optional, for session management)
- Docker 20.10+ (optional, for containerized deployment)
- PM2 or systemd (for process management)

## Environment Configuration

### 1. Environment Variables

Create environment configuration files for different deployment stages:

#### Development Environment
```bash
# copilot-study/.env.development
NODE_ENV=development

# Socket Configuration
SOCKET_PATH=/tmp/gitlab-crawler-dev.sock
SOCKET_LOG_LEVEL=debug
SOCKET_MAX_CONNECTIONS=3
SOCKET_HEARTBEAT_INTERVAL=10000
SOCKET_MAX_CONCURRENT_JOBS=2

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/copilot_study_dev
DATABASE_CONNECTION_POOL=5

# Monitoring
SOCKET_ENABLE_METRICS=true
SOCKET_METRICS_INTERVAL=30000
```

#### Production Environment
```bash
# copilot-study/.env.production
NODE_ENV=production

# Socket Configuration
SOCKET_PATH=/var/run/copilot-study/crawler.sock
SOCKET_LOG_LEVEL=info
SOCKET_MAX_CONNECTIONS=10
SOCKET_HEARTBEAT_INTERVAL=60000
SOCKET_MAX_CONCURRENT_JOBS=5
SOCKET_CONNECTION_TIMEOUT=120000

# Database Configuration
DATABASE_URL=postgresql://prod_user:secure_password@db-server:5432/copilot_study_prod
DATABASE_CONNECTION_POOL=20
SOCKET_QUERY_TIMEOUT=30000
SOCKET_TRANSACTION_TIMEOUT=60000

# Security
SOCKET_ALLOWED_ORIGINS=https://copilot-study.example.com
SOCKET_MAX_MESSAGE_SIZE=2097152

# Monitoring and Cleanup
SOCKET_ENABLE_METRICS=true
SOCKET_METRICS_INTERVAL=60000
SOCKET_CLEANUP_INTERVAL=3600000
SOCKET_MAX_JOB_AGE=604800000
SOCKET_MAX_ERROR_LOG_AGE=2592000000
```

### 2. Directory Structure Setup

```bash
# Create necessary directories
sudo mkdir -p /var/run/copilot-study
sudo mkdir -p /var/log/copilot-study
sudo mkdir -p /var/lib/copilot-study

# Set appropriate permissions
sudo chown -R copilot-study:copilot-study /var/run/copilot-study
sudo chown -R copilot-study:copilot-study /var/log/copilot-study
sudo chown -R copilot-study:copilot-study /var/lib/copilot-study

# Set socket directory permissions
sudo chmod 755 /var/run/copilot-study
```

## Database Setup

### 1. Database Schema Validation

Ensure your database schema includes the required tables and columns:

```sql
-- Verify Job table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'jobs' 
ORDER BY ordinal_position;

-- Verify Area table structure  
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'areas' 
ORDER BY ordinal_position;
```

### 2. Database Migrations

If additional tables are needed for socket operations:

```sql
-- Create socket connection tracking table (optional)
CREATE TABLE IF NOT EXISTS socket_connections (
    id VARCHAR(255) PRIMARY KEY,
    crawler_id VARCHAR(255),
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    active_jobs TEXT[],
    system_status VARCHAR(50) DEFAULT 'idle',
    metadata JSONB
);

-- Create job assignment mapping table (optional)
CREATE TABLE IF NOT EXISTS job_assignments (
    web_app_job_id VARCHAR(255) PRIMARY KEY,
    crawler_job_id VARCHAR(255),
    account_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'pending',
    metadata JSONB
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_socket_connections_active ON socket_connections(is_active, last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_job_assignments_status ON job_assignments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_socket_status ON jobs(status, updated_at);
```

### 3. Database Connection Testing

```bash
# Test database connectivity
npm run test:db-connection

# Or manually test with psql
psql "${DATABASE_URL}" -c "SELECT 1;"
```

## System Dependencies

### 1. Node.js Dependencies Installation

```bash
# Navigate to project directory
cd copilot-study

# Install dependencies
npm install

# Verify socket-specific dependencies
npm list socket.io net ws zod drizzle-orm
```

### 2. System-Level Dependencies

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install -y postgresql-client redis-tools curl wget
```

#### CentOS/RHEL
```bash
sudo yum install -y postgresql redis curl wget
```

## Deployment Steps

### 1. Development Deployment

```bash
# Clone and setup
git clone <repository-url> copilot-study
cd copilot-study

# Install dependencies
npm install

# Setup environment
cp .env.example .env.development
# Edit .env.development with your settings

# Initialize database
npm run db:migrate
npm run db:seed  # if applicable

# Start development server with socket support
npm run dev
```

### 2. Production Deployment

#### Option A: Direct Deployment

```bash
# 1. Prepare application
npm run build

# 2. Setup production environment
cp .env.example .env.production
# Configure production environment variables

# 3. Database setup
npm run db:migrate:prod

# 4. Start with process manager
pm2 start ecosystem.config.js --env production
```

#### Option B: Docker Deployment

```bash
# 1. Build Docker image
docker build -t copilot-study:latest .

# 2. Run with docker-compose
docker-compose -f docker-compose.prod.yml up -d
```

### 3. Socket Server Integration

```typescript
// src/app.js or main server file
import { SocketServer } from '$lib/server/socket';
import { createDefaultRouter } from '$lib/server/socket/message-router';

// Initialize socket server during app startup
const socketServer = new SocketServer({
  socketPath: process.env.SOCKET_PATH,
  maxConnections: parseInt(process.env.SOCKET_MAX_CONNECTIONS || '10'),
  logLevel: process.env.SOCKET_LOG_LEVEL as any,
});

// Start socket server
await socketServer.start();
console.log('Socket server started successfully');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  await socketServer.stop();
  process.exit(0);
});
```

## Production Configuration

### 1. Process Management with PM2

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'copilot-study-socket',
    script: 'build/index.js',
    instances: 1, // Socket server should run single instance
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: '/var/log/copilot-study/error.log',
    out_file: '/var/log/copilot-study/out.log',
    log_file: '/var/log/copilot-study/combined.log',
    max_memory_restart: '1G',
    restart_delay: 4000,
    watch: false,
    autorestart: true,
  }]
};
```

### 2. Systemd Service (Alternative)

Create `/etc/systemd/system/copilot-study.service`:

```ini
[Unit]
Description=Copilot Study Socket Server
After=network.target postgresql.service

[Service]
Type=simple
User=copilot-study
Group=copilot-study
WorkingDirectory=/opt/copilot-study
ExecStart=/usr/bin/node build/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/copilot-study/.env.production

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/run/copilot-study /var/log/copilot-study

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable copilot-study
sudo systemctl start copilot-study
sudo systemctl status copilot-study
```

### 3. Reverse Proxy Configuration (Nginx)

```nginx
# /etc/nginx/sites-available/copilot-study
upstream copilot_study {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name copilot-study.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name copilot-study.example.com;

    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/key.pem;

    location / {
        proxy_pass http://copilot_study;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Longer timeout for socket operations
    proxy_read_timeout 300s;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
}
```

## Monitoring Setup

### 1. Health Check Endpoint

```typescript
// Add to your server routes
app.get('/health/socket', async (req, res) => {
  try {
    const status = socketServer.getStatus();
    const stats = socketServer.getConnectionStats();
    
    res.json({
      status: 'healthy',
      socket_server: {
        running: status.isRunning,
        connections: stats.total,
        active_connections: stats.active,
        uptime: status.uptime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});
```

### 2. Log Configuration

Setup structured logging:

```bash
# Create log rotation configuration
sudo tee /etc/logrotate.d/copilot-study << EOF
/var/log/copilot-study/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0644 copilot-study copilot-study
    postrotate
        systemctl reload copilot-study
    endscript
}
EOF
```

### 3. Monitoring with Prometheus (Optional)

Add metrics endpoint:

```typescript
// src/lib/server/socket/metrics.ts
export const setupMetrics = (socketServer: SocketServer) => {
  // Implement Prometheus metrics collection
  // - socket_connections_total
  // - socket_messages_processed_total
  // - socket_errors_total
  // - socket_processing_duration_seconds
};
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Socket Connection Issues

**Problem**: `EADDRINUSE` or `EACCES` errors

**Solution**:
```bash
# Check if socket file exists and remove if stale
sudo rm -f /var/run/copilot-study/crawler.sock

# Check permissions
ls -la /var/run/copilot-study/

# Ensure proper ownership
sudo chown copilot-study:copilot-study /var/run/copilot-study/
```

#### 2. Database Connection Issues

**Problem**: Connection timeouts or pool exhaustion

**Solution**:
```bash
# Check database connectivity
psql "${DATABASE_URL}" -c "SELECT version();"

# Monitor connection pool
# Add to monitoring: track open connections
SELECT count(*) FROM pg_stat_activity WHERE application_name = 'copilot-study';
```

#### 3. Memory Issues

**Problem**: High memory usage or memory leaks

**Solution**:
```bash
# Monitor memory usage
ps aux | grep node
htop -p $(pgrep -f copilot-study)

# Configure memory limits in PM2
pm2 restart copilot-study-socket --max-memory-restart 1G
```

#### 4. Permission Issues

**Problem**: Socket file permission denied

**Solution**:
```bash
# Set correct permissions
sudo chown copilot-study:copilot-study /var/run/copilot-study/
sudo chmod 755 /var/run/copilot-study/
sudo chmod 660 /var/run/copilot-study/crawler.sock
```

### Debug Mode

Enable debug logging:

```bash
# Set debug environment
NODE_ENV=development SOCKET_LOG_LEVEL=debug npm start

# Or for specific debugging
DEBUG=socket:* npm start
```

### Log Analysis

```bash
# Monitor real-time logs
tail -f /var/log/copilot-study/combined.log

# Search for specific errors
grep -i "error\|failed\|timeout" /var/log/copilot-study/*.log

# Check socket-specific logs
grep "socket" /var/log/copilot-study/combined.log | tail -20
```

## Security Considerations

### 1. Socket File Security

```bash
# Set restrictive permissions
sudo chmod 600 /var/run/copilot-study/crawler.sock
sudo chown copilot-study:copilot-study /var/run/copilot-study/crawler.sock

# Use dedicated socket directory
sudo mkdir -p /var/run/copilot-study
sudo chown copilot-study:copilot-study /var/run/copilot-study
sudo chmod 750 /var/run/copilot-study
```

### 2. Network Security

- Ensure socket communication is limited to localhost
- Use firewalls to restrict access to the application server
- Implement rate limiting for API endpoints
- Regular security updates for all dependencies

### 3. Authentication and Authorization

- Validate all incoming messages from crawler
- Implement crawler authentication if needed
- Secure database credentials
- Use environment variables for sensitive configuration

### 4. Data Protection

- Mask sensitive data in logs (tokens, passwords)
- Encrypt database connections
- Regular backups of critical data
- Implement audit logging for security events

## Deployment Checklist

### Pre-Deployment
- [ ] Environment variables configured
- [ ] Database schema up to date
- [ ] Dependencies installed and versions verified
- [ ] SSL certificates configured (production)
- [ ] Monitoring and logging setup
- [ ] Backup procedures in place

### Deployment
- [ ] Application builds successfully
- [ ] Database migrations run without errors
- [ ] Socket server starts and accepts connections
- [ ] Health checks return positive status
- [ ] Log files are being written correctly
- [ ] Process manager (PM2/systemd) configured

### Post-Deployment
- [ ] Verify crawler can connect to socket server
- [ ] Test message exchange between components
- [ ] Monitor error logs for first 24 hours
- [ ] Verify database operations work correctly
- [ ] Test graceful shutdown procedures
- [ ] Document any environment-specific configurations

## Performance Optimization

### Database Optimization
```sql
-- Add indexes for frequently queried fields
CREATE INDEX CONCURRENTLY idx_jobs_status_updated ON jobs(status, updated_at);
CREATE INDEX CONCURRENTLY idx_jobs_account_status ON jobs(account_id, status);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM jobs WHERE status = 'running';
```

### Connection Pool Tuning
```bash
# Monitor connection pool usage
# Adjust SOCKET_DATABASE_CONNECTION_POOL based on load
DATABASE_CONNECTION_POOL=20  # Production
DATABASE_CONNECTION_POOL=5   # Development
```

### Memory Management
```bash
# Configure Node.js memory limits
NODE_OPTIONS="--max-old-space-size=2048"

# Monitor memory usage
watch -n 5 'ps aux | grep node | grep -v grep'
```

This deployment guide provides comprehensive coverage for deploying the socket communication system in various environments. Follow the appropriate sections based on your deployment target and customize the configuration to match your specific infrastructure requirements.