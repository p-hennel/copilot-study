# Security Authentication Policies

## Overview
This document outlines the authentication policies implemented for internal API endpoints following the security audit of MEDIUM RISK endpoints.

## Authentication Methods

### Method Precedence (Highest to Lowest)
1. **Socket Bypass** (`isSocketRequest`) - Highest precedence
2. **Admin Session** - Medium precedence  
3. **API Token** - Lowest precedence

## Endpoint Security Levels

### HIGH SECURITY (Admin-Only)
- `/api/admin/*` - All administrative endpoints
- Require admin session authentication only
- No API token or socket bypass allowed

### MEDIUM SECURITY (Enhanced Mixed Auth)
The following endpoints now use enhanced mixed authentication with proper logging:

#### 1. `/api/internal/jobs/progress` (POST)
- **Purpose**: Job progress updates from crawler processes
- **Authentication**: Socket bypass OR Admin session OR API token
- **Security Enhancements**:
  - Comprehensive authentication logging
  - Security warnings for API token usage
  - Request source tracking

#### 2. `/api/internal2/tasks` (GET/POST)
- **Purpose**: Task management and creation
- **Authentication**: Socket bypass OR Admin session OR API token
- **Security Enhancements**:
  - Enhanced logging for task creation operations
  - Security level classification (HIGH/MEDIUM/LOW)
  - Recommendation warnings for admin session usage

#### 3. `/api/internal2/tasks/[taskId]` (GET/PUT/DELETE)
- **Purpose**: Individual task operations
- **Authentication**: Socket bypass OR Admin session OR API token
- **Security Enhancements**:
  - Operation-specific security warnings
  - Stronger warnings for PUT/DELETE operations
  - Enhanced audit trail

#### 4. `/api/internal2/tasks/[taskId]/progress` (GET/POST)
- **Purpose**: Task progress tracking
- **Authentication**: Socket bypass OR Admin session OR API token
- **Security Enhancements**:
  - Differentiated logging for automated vs manual operations
  - Progress update frequency consideration

## Security Features Implemented

### 1. Authentication Precedence
- Socket bypass takes highest precedence (internal communication)
- Admin session preferred over API tokens
- API tokens allowed but with security warnings

### 2. Enhanced Logging
- **Authentication method tracking**: Every request logs which auth method was used
- **Security level classification**: HIGH/MEDIUM/LOW based on auth method
- **Operation-specific warnings**: Different warnings for creation, modification, deletion
- **Audit trail**: Comprehensive logging for security analysis

### 3. Security Warnings
- API token usage generates warnings recommending admin sessions
- Stronger warnings for sensitive operations (PUT/DELETE)
- Token preview logging (first 8 characters only)

### 4. Request Source Tracking
- Socket requests tracked via `x-request-source` header
- Unix socket communication properly identified
- Request source logged for audit purposes

## Legitimate Use Cases

### Socket Bypass (`isSocketRequest`)
- **Purpose**: Internal inter-process communication
- **Use Case**: Unix socket communication between application components
- **Security**: Highest trust level - internal communication only

### Admin Session
- **Purpose**: Web interface administrative operations
- **Use Case**: Manual task management, monitoring, configuration
- **Security**: High trust level - authenticated admin users

### API Token (`CRAWLER_API_TOKEN`)
- **Purpose**: Automated crawler operations
- **Use Case**: Progress updates, status reporting, automated task management
- **Security**: Medium trust level - requires proper token management

## Security Recommendations

### For Administrators
1. **Use admin sessions** for manual operations when possible
2. **Monitor logs** for API token usage patterns
3. **Rotate API tokens** regularly
4. **Review security logs** for unusual authentication patterns

### For Developers
1. **Prefer admin session authentication** for new features
2. **Use socket bypass** only for internal communication
3. **Log security events** appropriately
4. **Follow authentication precedence** rules

### For Operations
1. **Monitor authentication logs** for security analysis
2. **Set up alerts** for unusual authentication patterns
3. **Audit API token usage** regularly
4. **Review security metrics** periodically

## Security Metrics Logged

Each authenticated request logs:
- Authentication method used
- Security level (HIGH/MEDIUM/LOW)
- Operation type (GET/POST/PUT/DELETE)
- Endpoint accessed
- Timestamp
- User information (when available)
- Request source information

## Threat Mitigation

### Mitigated Risks
- **Unauthorized access**: Multi-layered authentication
- **Privilege escalation**: Clear authentication precedence
- **Audit trail gaps**: Comprehensive logging
- **Token misuse**: Usage warnings and monitoring

### Monitoring Capabilities
- **Authentication method distribution**: Track usage patterns
- **Security level trends**: Monitor authentication quality
- **Anomaly detection**: Identify unusual access patterns
- **Compliance tracking**: Audit administrative access

## Configuration

### Required Settings
- `CRAWLER_API_TOKEN`: Set in application settings
- Admin user configuration in auth settings
- Socket communication properly configured

### Security Hardening
- Regular token rotation
- Admin session timeout configuration
- Request source validation
- Comprehensive audit logging

## Implementation Status

✅ **COMPLETED**: All MEDIUM RISK endpoints secured with enhanced authentication  
✅ **COMPLETED**: Comprehensive security logging implemented  
✅ **COMPLETED**: Authentication precedence established  
✅ **COMPLETED**: Security documentation created  

The MEDIUM RISK endpoints have been successfully secured while maintaining legitimate functionality for crawler operations and administrative access.