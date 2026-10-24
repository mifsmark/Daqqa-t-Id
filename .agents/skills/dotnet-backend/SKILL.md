---
name: dotnet-backend
description: Implement API and application changes in the .NET modular monolith.
---

- Keep HTTP concerns in Api, use cases in Application, business rules in Domain, and EF/Identity/storage in Infrastructure.
- Use nullable C#, async I/O, UTC timestamps, decimal EUR, and the shared `docs/API-CONTRACT.md` shapes.
- Validate role, ownership, and state transition on the server; return ProblemDetails for failures.
- Add reviewed EF migrations for schema changes. Never auto-migrate production or use `EnsureDeleted`.
- Run `dotnet build DaqqaTid.slnx` and relevant `dotnet test DaqqaTid.slnx` tests; report unrun checks.
