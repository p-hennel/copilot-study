# Project: Copilot Study Web Application

## General Instructions:

- This is a SvelteKit application with TypeScript, Tailwind CSS, and Drizzle ORM.
- The application serves as a user-facing tool for a scientific study.
- Participants authorize the tool to access their GitLab data.
- The application communicates with a separate crawler service (`crawlz`) via a Unix socket.

## Coding Style:

- Follow the existing SvelteKit project structure.
- Use TypeScript for all new code.
- Adhere to the existing ESLint and Prettier configurations.
- Use the provided UI components from `bits-ui` and `vaul-svelte`.

## Key Components:

-   **`src/lib/server/socket/supervisor.ts`**: Manages the Unix socket communication with the `crawlz` crawler.
-   **`src/lib/server/socket/services/job-service.ts`**: Handles job creation, status updates, and management for the crawler.
-   **`src/routes/api/internal/**`**: Internal API endpoints for handling requests from the crawler and other services.
-   **`src/lib/db`**: Contains the Drizzle ORM schema and database connection.

## Regarding Dependencies:

- Use `bun install` to manage dependencies.
- Avoid introducing new external dependencies unless necessary.
