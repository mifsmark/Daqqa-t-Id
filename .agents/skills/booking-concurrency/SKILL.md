---
name: booking-concurrency
description: Preserve booking idempotency and worker slot exclusivity.
---

- Centralize allowed transitions and validate state plus ownership inside the application service.
- Serialize reservations for the same worker in SQL Server within a transaction until commit.
- Enforce request/payment idempotency with database unique constraints, not only UI guards.
- Exercise overlapping concurrent attempts against SQL Server and assert exactly one reservation commits.
- Keep sensitive customer address fields hidden until the booking is confirmed and assigned.
