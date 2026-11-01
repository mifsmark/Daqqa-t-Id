# ADR 0001: Serve the web application and API from one App Service origin

- Status: Accepted
- Date: 2026-10-20

## Decision

Host the ASP.NET Core API and compiled React/Vite application in one Linux Azure App Service. The browser calls same-origin `/api` routes, using secure cookies and CSRF protection.

## Rationale

The MVP has one web client and benefits from a simple deployment and authentication boundary. This avoids separate frontend hosting and CORS configuration while keeping the modular monolith easy to operate.

## Consequences

The API publish process must include the frontend build output and SPA fallback. App Service and SQL remain independent resources with separate scaling and cost. A future mobile client can use the same API contract; moving static assets to a CDN remains possible if traffic warrants it.
