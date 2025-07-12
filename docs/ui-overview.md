# copilot-study: UI Overview

This document describes the user-centric self-service portal and the administration UI for the copilot-study project, summarizing their main features, navigation, and user flows.

---

## Self-Service Portal (User-Facing)

The self-service portal is designed for study participants and regular users. It provides access to personal study information, job management, and area selection.

### Main Features & Navigation

- **Home (`/`)**: Dashboard or overview of the user's study status and available actions.
- **Login (`/login`)**: Authentication page for users.
- **Logout (`/logout`)**: Ends the user session.
- **Areas (`/areas`)**: View and select available study areas.
- **Jobs (`/jobs`)**: View, start, and manage assigned jobs.
- **Study Information (`/study`)**: Details about the study and user progress.
- **Account Management (`/account`)**: View and update account information.

### User Flows

1. **Authentication**: Users log in via [`/login`](copilot-study/src/routes/login/+page.svelte) and are redirected to the dashboard.
2. **Navigating Study Areas**: Select or view assigned area via `/areas`.
3. **Managing Jobs**: Access `/jobs` to see tasks and track progress.
4. **Viewing Study Information**: Access study details and progress.
5. **Account Actions**: Update profile or log out.

---

## Administration UI (Admin-Facing)

The administration UI is for system administrators and study coordinators, providing management tools for jobs, areas, users, and system settings.

### Main Features & Navigation

- **Admin Dashboard (`/admin`)**: Central hub for administrative actions.
- **Sign-In (`/admin/sign-in`)**: Admin authentication page.
- **Jobs Management (`/admin/jobs`)**: Manage all jobs.
- **Areas Management (`/admin/areas`)**: Manage study areas.
- **User Accounts (`/admin/accounts`)**: Manage user accounts and permissions.
- **System Settings (`/admin/settings`)**: Configure system settings.
- **Backup & Recovery (`/admin/backup`)**: Manage backups and recovery.
- **Crawler Control (`/admin/crawler`)**: Monitor and control data crawlers.
- **Tokens & API Access (`/admin/tokens`)**: Manage API tokens.

### Admin Flows

1. **Admin Authentication**: Log in via [`/admin/sign-in`](copilot-study/src/routes/admin/sign-in/+page.svelte).
2. **Job & Area Management**: Create, assign, and monitor jobs and areas.
3. **User Management**: Oversee user accounts and permissions.
4. **System Maintenance**: Use settings, backup, and crawler controls.

---

## Summary Table

| UI                | Main Routes                | Key Features                                      |
|-------------------|---------------------------|---------------------------------------------------|
| Self-Service      | `/`, `/login`, `/logout`, `/areas`, `/jobs`, `/study`, `/account` | User authentication, area selection, job management, study info, account management |
| Administration    | `/admin`, `/admin/sign-in`, `/admin/jobs`, `/admin/areas`, `/admin/accounts`, `/admin/settings`, `/admin/backup`, `/admin/crawler`, `/admin/tokens` | Admin authentication, job/area/user management, system settings, backup, crawler control, API tokens |

**References:**  
- Self-Service Portal routes: [`copilot-study/src/routes/`](copilot-study/src/routes/)
- Admin UI routes: [`copilot-study/src/routes/admin/`](copilot-study/src/routes/admin/)