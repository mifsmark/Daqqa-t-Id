# ADR 0002: Serialize slot reservations by worker in SQL Server

- Status: Accepted
- Date: 2026-10-20

## Decision

Reservation transitions run in a SQL transaction that obtains an update lock on the worker's row, checks for overlapping confirmed/reserved intervals, and holds the lock until commit. Unique indexes protect idempotency keys and one-time payment records.

## Rationale

A unique constraint cannot express arbitrary interval overlap. Locking one stable row per worker serializes competing reservations while allowing different workers to proceed independently.

## Consequences

Integration tests must use SQL Server and trigger genuinely concurrent attempts. The lock ordering must remain consistent, and transactions should stay short. Revisit with measured evidence if worker-row contention becomes material.
