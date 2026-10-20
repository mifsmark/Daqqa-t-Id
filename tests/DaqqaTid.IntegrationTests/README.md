# SQL Server integration tests

The marketplace and media tests exercise the hosted API and real SQL Server persistence. Set `TEST_SQL_CONNECTION` to a dedicated test database before running the full project. The test factory creates the schema when needed and seeds reference data; it never uses an EF in-memory provider. A missing connection fails with a clear message.

The hosting pipeline smoke test does not require SQL Server and uses an intentionally unreachable connection string without replacing the database provider. Run it alone with `dotnet test tests/DaqqaTid.IntegrationTests --filter FullyQualifiedName~HostingSmokeTests`.
