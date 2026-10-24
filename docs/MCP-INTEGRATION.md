# Optional MCP integration contract

The application and development workflow do not depend on MCP. No MCP server is assumed to exist or installed here. MCP may later provide developer-only context, such as repository documentation lookup or read-only catalog/schema inspection.

Any future project-context MCP server should expose narrowly scoped, documented tools and resources with stable schemas. Initial contract:

- `get_project_context(topic)` returns curated repository-owned guidance with source paths and revision information.
- `get_api_contract()` returns the versioned API contract document.
- `list_domain_entities()` returns names and short descriptions derived from checked-in code/docs, without customer data.
- Resources use stable `daqqatid://...` URIs and identify their source revision.

The server must be optional, read-only by default, and use least-privilege credentials. It must not expose secrets, production customer/worker records, addresses, access tokens, or unrestricted SQL. Any future mutation tool needs a separately reviewed authorization model, explicit audit trail, and confirmation appropriate to its effect. Keep ordinary build, test, deploy, and operator tasks executable without MCP. Document the server owner, supported protocol version, authentication, and failure behavior before enabling a connector.
