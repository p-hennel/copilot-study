# Socket Communication System - Implementation Summary

This document provides a comprehensive overview of the socket communication system implementation for the GitLab crawler web application. The system enables real-time bidirectional communication between the web application and crawler instances.

## 🏗️ Architecture Overview

The socket communication system consists of several key components:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web App       │    │  Socket Server  │    │    Crawler      │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Job Manager │◄├────┤►│Message Router│◄├────┤►│ Job Executor│ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │Progress UI  │◄├────┤►│Progress Track│◄├────┤►│Progress Rep.│ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Database    │◄├────┤►│ DB Adapter  │ │    │ │   Monitor   │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📁 Project Structure

```
src/lib/server/socket/
├── 📄 socket-server.ts          # Main socket server implementation
├── 📄 message-router.ts         # Message routing and middleware
├── 📄 config.ts                 # Configuration management
├── 📁 types/                    # TypeScript type definitions
│   ├── 📄 index.ts              # Main type exports
│   ├── 📄 messages.ts           # Message schemas and validation
│   ├── 📄 database.ts           # Database integration types
│   ├── 📄 connection.ts         # Connection management types
│   ├── 📄 progress.ts           # Progress tracking types
│   ├── 📄 config.ts             # Configuration types
│   └── 📄 errors.ts             # Error handling types
├── 📁 protocol/                 # Protocol implementation
│   ├── 📄 message-validator.ts  # Message validation
│   └── 📄 protocol-handler.ts   # Protocol handling
├── 📁 examples/                 # Usage examples
│   ├── 📄 basic-setup.ts        # Development setup
│   ├── 📄 production-setup.ts   # Production configuration
│   └── 📄 testing-setup.ts      # Testing utilities
├── 📁 config/                   # Configuration templates
│   ├── 📄 development.env       # Development environment
│   ├── 📄 production.env        # Production environment
│   └── 📄 docker-compose.yml    # Docker setup
├── 📄 DEPLOYMENT_GUIDE.md       # Deployment instructions
├── 📄 API_REFERENCE.md          # API documentation
└── 📄 IMPLEMENTATION_SUMMARY.md # This file
```

## 🚀 Quick Start

### 1. Basic Development Setup

```typescript
import { SocketServer } from '$lib/server/socket';

// Create and start socket server
const socketServer = new SocketServer({
  socketPath: '/tmp/crawler-dev.sock',
  maxConnections: 3,
  logLevel: 'debug'
});

await socketServer.start();
console.log('Socket server running!');
```

### 2. Production Setup

```typescript
import { productionSocketSetup } from '$lib/server/socket/examples/production-setup';

// Full production setup with monitoring and error handling
const { socketServer, monitoring } = await productionSocketSetup();
```

### 3. Testing Setup

```typescript
import { SocketTestSuite } from '$lib/server/socket/examples/testing-setup';

const suite = new SocketTestSuite();
await suite.setup();

const client = await suite.createTestClient();
await client.sendHeartbeat();

await suite.teardown();
```

## 🔧 Core Components

### SocketServer

The main server class that manages connections and coordinates all socket operations.

**Key Features:**
- Unix domain socket and TCP support
- Connection pooling and management
- Graceful shutdown handling
- Real-time status monitoring
- Message broadcasting capabilities

**Usage:**
```typescript
const server = new SocketServer(config);
await server.start();

// Send message to specific crawler
await server.sendToCrawler('crawler-123', message);

// Broadcast to all crawlers
await server.broadcast(shutdownMessage);

// Get server status
const status = server.getStatus();
```

### MessageRouter

Handles message routing with middleware support for preprocessing, validation, and processing.

**Key Features:**
- Middleware pipeline for message processing
- Priority-based handler registration
- Error handling and recovery
- Message validation and transformation

**Usage:**
```typescript
const router = createDefaultRouter();

// Add custom middleware
router.addMiddleware(new AuthenticationMiddleware());

// Register custom handler
router.registerHandler('custom_message', new CustomHandler());

// Process incoming message
const result = await router.processMessage(message, connection);
```

### Configuration Management

Comprehensive configuration system with environment-specific defaults and validation.

**Key Features:**
- Environment-specific configurations
- Runtime configuration updates
- Configuration validation
- Environment variable integration

**Usage:**
```typescript
import { SOCKET_CONFIG, getEnvironmentConfig } from '$lib/server/socket/config';

// Get current configuration
const config = getEnvironmentConfig('production');

// Update configuration at runtime
configManager.updateConfig({ maxConnections: 20 });
```

## 📨 Message Protocol

### Crawler → Web App Messages

#### Heartbeat
```typescript
{
  type: 'heartbeat',
  timestamp: '2024-01-15T10:30:00Z',
  data: {
    active_jobs: 2,
    last_activity: '2024-01-15T10:29:45Z',
    system_status: 'crawling'
  }
}
```

#### Job Progress
```typescript
{
  type: 'job_progress',
  timestamp: '2024-01-15T10:30:15Z',
  job_id: 'job-123',
  data: {
    progress: [{
      entity_type: 'projects',
      total_discovered: 150,
      total_processed: 45
    }],
    overall_completion: 0.35,
    time_elapsed: 45000
  }
}
```

#### Jobs Discovered
```typescript
{
  type: 'jobs_discovered',
  timestamp: '2024-01-15T10:30:30Z',
  job_id: 'discovery-job-456',
  data: {
    discovered_jobs: [{
      job_type: 'crawl_project',
      entity_id: '1234',
      namespace_path: 'group/project',
      entity_name: 'My Project'
    }],
    discovery_summary: {
      total_projects: 15,
      total_groups: 5
    }
  }
}
```

### Web App → Crawler Messages

#### Job Assignment
```typescript
{
  type: 'job_assignment',
  timestamp: '2024-01-15T10:31:00Z',
  data: {
    job_id: 'job-789',
    job_type: 'crawl_project',
    gitlab_host: 'gitlab.example.com',
    access_token: 'glpat-xxxxxxxxxxxxxxxxxxxx',
    priority: 1
  }
}
```

#### Token Refresh Response
```typescript
{
  type: 'token_refresh_response',
  timestamp: '2024-01-15T10:31:30Z',
  data: {
    access_token: 'new-token-here',
    expires_at: '2024-01-16T10:31:30Z',
    refresh_successful: true
  }
}
```

## 🗄️ Database Integration

### Job Management

The system integrates with the existing database schema to track jobs and progress:

```typescript
// Create job from crawler assignment
const job = await dbAdapter.createJobFromAssignment({
  web_app_job_id: 'job-123',
  account_id: 'account-456',
  job_type: 'crawl_project',
  provider: 'gitlab-onprem'
});

// Update job progress
await dbAdapter.updateJobFromProgress('job-123', progressData);

// Track assignment mapping
await dbAdapter.createAssignmentMapping({
  webAppJobId: 'job-123',
  crawlerJobId: 'crawler-job-789',
  accountId: 'account-456'
});
```

### Progress Tracking

Real-time progress tracking with detailed entity-level progress:

```typescript
const progressTracker = createProgressTracker('job-123');

// Update progress from crawler
progressTracker.updateProgress({
  entities: [{
    entity_type: 'projects',
    total_discovered: 100,
    total_processed: 45
  }],
  overall_completion: 0.45
});

// Get progress snapshot
const snapshot = progressTracker.getSnapshot();
```

## 🔐 Security Features

### Connection Security
- Unix domain socket for secure local communication
- Connection authentication and validation
- Rate limiting per connection
- Message size limits and validation

### Data Protection
- Sensitive data masking in logs
- Secure token handling
- Input validation and sanitization
- Error information filtering

### Access Control
- Connection-based access control
- Message type authorization
- Resource usage monitoring
- Connection pool management

## 📊 Monitoring and Metrics

### Built-in Metrics
- Connection counts and status
- Message processing rates
- Error rates and types
- Job processing statistics
- Performance metrics

### Health Monitoring
```typescript
// Health check endpoint
app.get('/health/socket', async (req, res) => {
  const status = socketServer.getStatus();
  res.json({
    status: status.isRunning ? 'healthy' : 'unhealthy',
    connections: status.connections,
    uptime: status.uptime
  });
});
```

### Error Tracking
```typescript
// Comprehensive error handling
class ProductionErrorHandler {
  async handle(error: SocketError): Promise<ErrorHandlingResult> {
    if (error.severity === 'critical') {
      await notifyAdministrators(error);
    }
    
    return {
      handled: true,
      shouldRetry: error.category === 'network',
      shouldNotify: error.severity !== 'low'
    };
  }
}
```

## 🧪 Testing Strategy

### Unit Tests
```typescript
describe('SocketServer', () => {
  let suite: SocketTestSuite;

  beforeEach(async () => {
    suite = new SocketTestSuite();
    await suite.setup();
  });

  it('should handle heartbeat messages', async () => {
    const client = await suite.createTestClient();
    await client.sendHeartbeat();
    
    const stats = suite.getSocketServer().getConnectionStats();
    expect(stats.active).toBe(1);
  });
});
```

### Integration Tests
```typescript
const { socketServer } = await createTestSocketServer();
await socketServer.start();

const client = new TestCrawlerClient('/tmp/test-socket.sock');
await client.connect();
await client.sendJobProgress('job-123', 0.5);

// Verify database was updated
const job = await mockDb.getJob('job-123');
expect(job.progress.overall_completion).toBe(0.5);
```

### Load Testing
```typescript
// Test with multiple concurrent connections
const clients = [];
for (let i = 0; i < 10; i++) {
  const client = await suite.createTestClient();
  clients.push(client);
}

// Send concurrent messages
await Promise.all(clients.map(client => 
  client.sendHeartbeat()
));
```

## 🚀 Deployment Options

### 1. Development
```bash
# Quick start
npx tsx src/lib/server/socket/examples/basic-setup.ts

# With SvelteKit dev server
npm run dev
```

### 2. Production (PM2)
```bash
# Install and configure
npm install -g pm2
pm2 start ecosystem.config.js --env production

# Monitor
pm2 status
pm2 logs copilot-study-socket
```

### 3. Production (Systemd)
```bash
# Install service
sudo cp copilot-study.service /etc/systemd/system/
sudo systemctl enable copilot-study
sudo systemctl start copilot-study
```

### 4. Docker
```bash
# Build and run
docker-compose up -d

# With monitoring
docker-compose --profile monitoring up -d

# Scale horizontally
docker-compose up -d --scale copilot-study=3
```

### 5. Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: copilot-study-socket
spec:
  replicas: 3
  selector:
    matchLabels:
      app: copilot-study-socket
  template:
    spec:
      containers:
      - name: app
        image: copilot-study:latest
        env:
        - name: NODE_ENV
          value: production
        - name: SOCKET_PATH
          value: /var/run/copilot-study/crawler.sock
```

## 🔧 Configuration

### Environment Variables

**Development:**
```bash
SOCKET_PATH=/tmp/crawler-dev.sock
SOCKET_LOG_LEVEL=debug
SOCKET_MAX_CONNECTIONS=3
SOCKET_HEARTBEAT_INTERVAL=10000
```

**Production:**
```bash
SOCKET_PATH=/var/run/copilot-study/crawler.sock
SOCKET_LOG_LEVEL=info
SOCKET_MAX_CONNECTIONS=20
SOCKET_HEARTBEAT_INTERVAL=60000
SOCKET_ENABLE_METRICS=true
```

### Configuration Files

Use the provided templates:
- `config/development.env` - Development settings
- `config/production.env` - Production settings
- `config/docker-compose.yml` - Container orchestration

## 🔍 Troubleshooting

### Common Issues

#### Socket Connection Failed
```bash
# Check socket path permissions
ls -la /var/run/copilot-study/

# Verify no existing socket
sudo rm -f /var/run/copilot-study/crawler.sock

# Check process ownership
ps aux | grep node
```

#### High Memory Usage
```bash
# Monitor memory
ps aux | grep copilot-study
htop -p $(pgrep -f copilot-study)

# Reduce configuration
SOCKET_MAX_CONNECTIONS=10
SOCKET_MESSAGE_BUFFER_SIZE=65536
```

#### Database Connection Issues
```bash
# Test database connectivity
psql "${DATABASE_URL}" -c "SELECT 1;"

# Check connection pool
DATABASE_CONNECTION_POOL=15
SOCKET_QUERY_TIMEOUT=30000
```

### Debug Mode

Enable comprehensive debugging:
```bash
DEBUG=socket:* npm start
SOCKET_LOG_LEVEL=debug npm start
```

### Log Analysis

```bash
# Monitor real-time logs
tail -f /var/log/copilot-study/socket.log

# Search for errors
grep -i "error\|failed" /var/log/copilot-study/*.log

# Analyze performance
grep "processing_time" /var/log/copilot-study/socket.log | tail -20
```

## 📈 Performance Optimization

### Connection Tuning
```bash
# High-throughput environments
SOCKET_MAX_CONNECTIONS=50
DATABASE_CONNECTION_POOL=30
SOCKET_HEARTBEAT_INTERVAL=30000

# Resource-constrained environments
SOCKET_MAX_CONNECTIONS=5
DATABASE_CONNECTION_POOL=10
SOCKET_HEARTBEAT_INTERVAL=120000
```

### Message Processing
```bash
# Enable compression for large messages
SOCKET_ENABLE_COMPRESSION=true
SOCKET_MAX_MESSAGE_SIZE=10485760

# Optimize buffer sizes
SOCKET_MESSAGE_BUFFER_SIZE=131072
SOCKET_BUFFER_OPTIMIZE=true
```

### Database Optimization
```sql
-- Add performance indexes
CREATE INDEX CONCURRENTLY idx_jobs_socket_status 
ON jobs(status, updated_at) WHERE status IN ('running', 'queued');

CREATE INDEX CONCURRENTLY idx_jobs_account_active 
ON jobs(account_id, status) WHERE status IN ('running', 'queued');
```

## 🛡️ Security Best Practices

### 1. Network Security
- Use Unix domain sockets for local communication
- Implement proper firewall rules
- Secure database connections with SSL
- Regular security updates

### 2. Data Protection
- Mask sensitive data in logs
- Encrypt data at rest and in transit
- Implement proper backup encryption
- Regular security audits

### 3. Access Control
- Run services under dedicated user accounts
- Implement connection authentication
- Use principle of least privilege
- Monitor access patterns

### 4. Monitoring
- Set up security event monitoring
- Implement intrusion detection
- Monitor for unusual patterns
- Automated security alerts

## 📚 Additional Resources

### Documentation
- [API Reference](./API_REFERENCE.md) - Complete API documentation
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Detailed deployment instructions
- [Configuration Templates](./config/) - Environment-specific configurations

### Examples
- [Basic Setup](./examples/basic-setup.ts) - Development quick start
- [Production Setup](./examples/production-setup.ts) - Production configuration
- [Testing Setup](./examples/testing-setup.ts) - Testing utilities

### External Resources
- [Socket.IO Documentation](https://socket.io/docs/)
- [PM2 Process Manager](https://pm2.keymetrics.io/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [PostgreSQL Performance](https://www.postgresql.org/docs/current/performance-tips.html)

## 🤝 Contributing

### Development Setup
1. Clone repository
2. Install dependencies: `npm install`
3. Copy config: `cp config/development.env .env.development`
4. Start development server: `npm run dev`
5. Run tests: `npm test socket`

### Code Standards
- TypeScript strict mode
- ESLint with recommended rules
- Comprehensive error handling
- Unit and integration tests
- Documentation for public APIs

### Pull Request Process
1. Feature branch from `main`
2. Implement with tests
3. Update documentation
4. Pass all CI checks
5. Code review approval

---

This implementation provides a robust, scalable, and secure socket communication system for real-time interaction between the GitLab crawler web application and crawler instances. The modular design allows for easy extension and customization while maintaining high performance and reliability.