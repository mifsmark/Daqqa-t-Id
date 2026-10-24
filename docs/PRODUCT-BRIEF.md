# Daqqa t'Id — Build and Deploy a Working Marketplace MVP

## YOUR MISSION

You are the principal software architect, senior full-stack engineer, UX engineer, and test engineer responsible for implementing **Daqqa t'Id**, a new Malta-based marketplace connecting customers with local service professionals.

**GitHub repository:** https://github.com/mifsmark/Daqqa-t-Id

**Primary goal:** Deliver an actual, working, mobile-friendly marketplace MVP that can be deployed to a live Azure URL.

Do not stop after producing an architecture document, mockups, scaffolding, or a partial API.

Implement a complete vertical slice, run and repair tests, prepare deployment infrastructure, and create a pull request containing working code.

If Azure access and credentials are available, deploy to a publicly reachable staging URL and verify it. If they are unavailable, finish everything that can be implemented and tested, and give the repository owner the exact remaining deployment actions.

Do not claim the application is deployed or tested unless it genuinely is.

## 1. PRODUCT VISION

Daqqa t'Id is a marketplace inspired by the useful operational concepts of Bolt, Wolt, and Booking.com:

- Bolt: fast matching with workers who are accepting work.
- Wolt: simple ordering, clear status, pricing, and notifications.
- Booking.com: searchable provider profiles, availability, ratings, and booking management.

Do not copy any competitor's branding, layouts, trademarks, source code, or proprietary assets.

Build an original product tailored for Malta.

**Brand:** Daqqa t'Id
**Meaning:** A helping hand
**Tagline:** Find local help. Get things done.
**Launch market:** Malta and Gozo
**Currency:** EUR
**Primary language:** English
**Timezone:** Europe/Malta, with UTC persistence
**Platform:** Responsive web application / installable PWA where practical

Initial service categories:

1. Plumbing
2. Electrical work
3. Cleaning
4. Handyman services
5. Furniture assembly
6. Painting
7. Tiling
8. Gardening
9. Moving and lifting
10. General home maintenance

Services must be database-driven so administrators can introduce new categories without deploying new frontend code.

A key product differentiator is three service modes:

### Do It For Me
The worker performs the service normally.

### Do It With Me
The customer participates in permitted work while receiving assistance, potentially reducing the cost.

### Teach Me
The professional provides practical instruction rather than simply completing the task.

Not all categories support all three modes. Administrators must be able to configure eligible modes per category.

For regulated or hazardous work, prevent unsafe service offerings and require appropriate professional verification. Do not imply unqualified customers may perform restricted work.

## 2. TECHNOLOGY — FIXED DECISIONS

Build a modular monolith, not microservices.

Backend:
- .NET 10 LTS, ASP.NET Core Web API.
- C# with nullable reference types and asynchronous I/O.
- EF Core 10 using SQL Server provider.
- Azure SQL in production, SQL Server container locally.
- SQL Server geography with NetTopologySuite where practical.
- ASP.NET Core Identity or equivalent proven authentication implementation.
- REST APIs documented with OpenAPI.
- FluentValidation or straightforward equivalent for input validation.
- Structured logging and health endpoints.
- xUnit for automated backend tests.

Frontend:
- React with TypeScript.
- Vite.
- Tailwind CSS.
- React Router.
- TanStack Query for server state.
- Accessible reusable UI components.
- Mobile-first responsive layouts.
- Playwright for end-to-end tests.

Infrastructure:
- Azure App Service hosting the ASP.NET Core application and built React static assets under the same origin.
- Azure SQL Database.
- Azure Blob Storage for uploaded media when configured.
- Local filesystem or equivalent safe development storage adapter for local use.
- GitHub Actions for CI and deployment.
- Azure Bicep for reproducible infrastructure provisioning.
- Docker Compose for local development.
- Azure App Service managed identity for database access where supported.
- GitHub OIDC for deployment authentication.

Avoid unnecessary service dependencies.

Do not initially introduce Kubernetes, RabbitMQ, Kafka, MongoDB, Cosmos DB, or Redis.

Architect interfaces and module boundaries so appropriate services can be introduced later without major rewrites.

Do not create generic repositories or elaborate abstraction layers that add no real value over EF Core.

## 3. ARCHITECTURE

Organize the solution approximately as:

/src
  /backend
    /DaqqaTid.Api
    /DaqqaTid.Application
    /DaqqaTid.Domain
    /DaqqaTid.Infrastructure
  /frontend
    /src
      /app
      /features
        /auth
        /customers
        /workers
        /services
        /search
        /availability
        /bookings
        /quotes
        /payments
        /reviews
        /admin
      /components
      /lib
      /styles
/tests
  /DaqqaTid.UnitTests
  /DaqqaTid.IntegrationTests
  /e2e
/docs
/infra
/.github/workflows
/.agents/skills

Use vertical slices internally where useful.

Keep modules independently understandable and extensible:

- Identity and authorization
- Service catalog
- Customer profiles
- Worker profiles and verification
- Worker skills
- Availability
- Location and matching
- Job requests
- Quotations
- Booking orchestration
- Payments and commissions
- Messaging and notifications
- Reviews
- Administration
- Auditing

Favor clear feature-level application services over a large collection of trivial wrappers.

Create architectural decision records for significant design choices.

## 4. CUSTOMER EXPERIENCE

Build a polished, responsive customer application.

### Public landing page

Include:

- Daqqa t'Id branding.
- Clear value proposition.
- Service search.
- Browse service categories.
- Explanation of the three service modes.
- How the platform works.
- Customer and worker registration entry points.
- Malta and Gozo service coverage.
- Trust and safety messaging.
- Footer with appropriate legal and privacy placeholders.

The public page must feel like a credible modern marketplace, not an internal admin dashboard or default template.

### Customer registration and account

Support:

- Register and sign in.
- Sign out.
- Password reset flow, backed by a configured email sender when available.
- Profile editing.
- First name and last name.
- Phone contact.
- Preferred locality.
- Multiple saved addresses.
- Booking history.
- Current and previous jobs.

Do not pretend a reset email was delivered if no mail provider is configured.

### Search and discovery

Allow customers to:

- Browse categories.
- Choose a service.
- Select service mode.
- Enter locality or service address.
- Select ASAP or scheduled.
- View relevant available workers.
- Filter by category, price, availability, and locality.
- Open worker profiles.

Worker cards should display:

- Name and profile photo or placeholder.
- Skills.
- Experience level.
- Supported service modes.
- Hourly/fixed/quote pricing type.
- Relevant availability.
- Verification status.
- Genuine review summaries only when reviews exist.

Do not invent completed jobs, ratings, response times, live locations, or ETAs.

### Create job request

Required inputs:

- Category.
- Service mode.
- Brief problem description.
- Optional longer description.
- Address or locality.
- ASAP or requested date/time.
- Photos, when storage is configured.
- Any category-specific details.
- Estimated duration when appropriate.

Validate all fields.

The customer should receive a clear confirmation and be able to track the request.

### Booking

Customer can:

- Review candidate workers.
- Send a booking request.
- Receive acceptance or a quote.
- Confirm a booking.
- View booking status.
- Cancel under defined policies.
- Mark completion or acknowledge worker completion.
- Leave a review after legitimate completion.

Show transparent prices and distinguish estimates from confirmed amounts.

## 5. WORKER EXPERIENCE

Build a dedicated worker dashboard.

### Worker onboarding

Include:

- Worker registration and login.
- Display name.
- Profile biography.
- Profile photograph.
- Service locality and operating radius.
- Years of experience.
- Skills/categories.
- Supported service modes.
- Pricing configuration.
- Portfolio images.
- Professional verification submissions where required.
- Availability setup.

Differentiate between:

- Unverified
- Verification pending
- Verified
- Rejected or suspended

For regulated professions, restrict offers until required verification is approved.

Never display self-declared certifications as independently verified.

### Worker availability

Support:

- Available now toggle.
- Weekly recurring availability windows.
- Date-specific exceptions.
- Time off.
- Service radius.
- Maximum working capacity of one concurrent job for MVP.

The available-now toggle represents worker-declared availability, not GPS-confirmed presence.

Provide a clear indication of when availability was last updated.

### Worker jobs dashboard

Include:

- New compatible requests.
- Requests awaiting response.
- Quotes sent.
- Confirmed bookings.
- Upcoming jobs.
- Active jobs.
- Completed jobs.
- Cancellations.

Workers can:

- Accept or decline eligible requests.
- Propose a quote where the category allows quoting.
- View relevant job details.
- Start a job.
- Mark a job completed.
- Manage availability.
- Edit their profile.

Do not expose a customer's full private address to unrelated workers; reveal it only when operationally necessary and authorized.

## 6. ADMINISTRATION

Create a protected admin portal with real role-based authorization.

Admin capabilities:

- View customer accounts.
- View worker accounts.
- Approve/reject verification.
- Suspend problematic accounts.
- Create/update/deactivate categories.
- Configure supported service modes.
- Configure commission percentage.
- View requests and bookings.
- Review disputes and cancellations.
- View simulated payment records.
- View operational metrics.
- Examine an auditable history of important changes.

Useful metrics:

- Registered customers.
- Registered workers.
- Pending worker verification.
- Open job requests.
- Accepted bookings.
- Completed bookings.
- Cancelled bookings.
- Simulated gross transaction value.
- Simulated platform commissions.

Clearly label simulated financial figures.

No public admin credentials, no hardcoded production passwords.

## 7. DOMAIN AND DATABASE MODEL

Use proper EF Core migrations and a maintainable relational model.

Include appropriate entities and relationships for:

- ApplicationUser
- CustomerProfile
- WorkerProfile
- WorkerVerification
- WorkerSkill
- ServiceCategory
- CategoryAttributeDefinition
- CategorySupportedMode
- WorkerServiceOffering
- WorkerAvailabilityWindow
- WorkerAvailabilityException
- CustomerAddress
- JobRequest
- JobRequestPhoto
- JobOffer
- Quote
- Booking
- BookingStatusHistory
- Payment
- CommissionLedgerEntry
- Review
- Notification
- AuditEvent
- PlatformSetting

You may refine naming and boundaries if doing so improves the design.

Use:

- Primary and foreign keys.
- Appropriate relational constraints.
- Unique indexes where required.
- RowVersion/concurrency tokens.
- Currency decimal precision.
- UTC timestamps.
- Nullable values only when genuinely optional.
- Appropriate indexes for critical queries.
- SQL geography or another correctly implemented SQL Server spatial approach.
- Category-specific JSON metadata with server-side validation.

Persist geographical points with correct latitude/longitude ordering and SRID 4326.

Do not rely on naive string matching for proximity.

Use soft deletion or status-based deactivation where necessary to preserve booking and financial history.

Do not hard-delete transactional records casually.

## 8. BOOKING ENGINE — CRITICAL

The booking engine is the most important backend component.

Use explicit state transitions, for example:

REQUESTED
OFFERED
WORKER_ACCEPTED
CUSTOMER_CONFIRMED
IN_PROGRESS
COMPLETED
CANCELLED
EXPIRED

You may refine the state model, but transitions must be validated centrally.

Implement the following guarantees:

1. A job request cannot produce multiple confirmed assignments.
2. A worker cannot accept conflicting bookings for overlapping time windows.
3. Retries cannot create duplicate confirmed bookings.
4. A customer cannot confirm a canceled or expired offer.
5. Unauthorized users cannot update other users' bookings.
6. Cancellations correctly release reserved availability.
7. Financial records cannot be silently duplicated.
8. Invalid state transitions return meaningful API errors.

Use database-backed concurrency control, not only frontend checks.

For SQL Server, investigate an appropriate combination of transactions, rowversion-based optimistic concurrency, and transaction-scoped worker serialization/locking for the overlapping-booking invariant.

A simple unique index alone does not solve overlapping arbitrary time intervals.

Document the locking strategy and provide concurrency tests.

Support two initial booking styles:

### Direct booking
Customer selects a worker and agreed pricing configuration.

### Quote request
Customer describes a job, worker submits a quote, and customer accepts or declines it.

Preserve the design for future multiple-worker bidding, but do not overbuild bidding functionality now.

## 9. MATCHING ENGINE

Provide a simple deterministic matching engine that can be replaced or improved later.

Candidate workers must satisfy:

- Active account.
- Eligible verification status.
- Supported category.
- Supported service mode.
- Relevant location radius.
- Availability compatibility.
- No conflicting confirmed booking.
- Not suspended.

Rank eligible workers using explainable signals such as:

- Distance.
- Availability.
- Verified experience.
- Price fit.
- Genuine review quality when sufficient data exists.

Do not invent a proprietary AI ranking system.

Do not imply instantaneous GPS tracking when none exists.

Expose matching through an application interface with unit tests.

Use SQL spatial filtering and sensible indexes where appropriate. Keep the first algorithm simple and performant.

## 10. PRICING AND PAYMENTS

Support configurable pricing models:

- Hourly.
- Fixed price.
- Quote required.

The pricing display must distinguish:

- Worker subtotal.
- Any customer-facing platform/service fee.
- Total payable.
- Worker earnings.
- Platform commission.

These must not be conflated.

### MVP payment strategy

Implement a PaymentProvider abstraction.

Start with a DEMO/SIMULATED provider only.

A simulated payment may move through realistic internal test states but must NEVER represent an actual bank charge or transfer.

Clearly label all demo charges and dashboard figures.

Do not collect real card details.

Design provider interfaces for future integration with a licensed payment platform such as Stripe Connect, subject to verification of supported marketplace capabilities in Malta.

Use idempotency keys for payment operations and protect against duplicate settlement.

Commission rules must be configurable and produce auditable ledger entries.

Live payments and payouts are explicitly out of scope for the first public demo.

## 11. UI AND UX

Design a clean, modern, polished brand.

Visual direction:

- Warm Mediterranean character.
- Trustworthy and practical.
- Modern mobile marketplace rather than corporate SaaS.
- Friendly but professional.
- Large touch targets.
- Clear typography.
- Intuitive onboarding.
- Strong empty and loading states.
- Accessible color contrast.
- Minimal friction in booking.

Use a consistent design system with reusable components.

Create layouts for:

- Landing page.
- Category browse.
- Search results.
- Worker profile.
- Request wizard.
- Booking detail.
- Customer dashboard.
- Worker dashboard.
- Admin dashboard.
- Account settings.

Prioritize excellent mobile experience at approximately 375px width, while supporting tablets and desktops.

All primary actions must actually work.

Do not leave decorative buttons that do nothing.

Provide meaningful validation errors and success feedback.

Use original assets, simple SVG illustrations, or appropriately licensed imagery. No hotlinked competitor logos or copied screenshots.

## 12. AUTHENTICATION, SECURITY, AND PRIVACY

Implement authentication using ASP.NET Core Identity with secure, HTTP-only cookies where suitable for the same-origin frontend/API architecture.

Include:

- Role-based authorization.
- Server-side object ownership checks.
- Anti-forgery protection for cookie-authenticated state changes.
- Secure cookie settings.
- Login throttling.
- API rate limiting.
- Input validation.
- File type and size restrictions.
- Safe error handling.
- No secrets committed to Git.
- Restrictive production logging for personal data.
- Production HTTPS.
- Secure configuration defaults.
- CSRF/XSS protections.
- Appropriate session expiration.
- Audit events for sensitive admin actions.

GDPR-aware design:

- Data minimization.
- Privacy-policy and terms placeholders clearly labeled for legal review.
- Customer data export/delete request workflow or at least an actionable admin process.
- Account deletion with retention of records legitimately required for legal/accounting purposes.
- Limited location disclosure.
- Appropriate consent for optional marketing communications.

Do not present placeholder legal documents as professionally reviewed.

## 13. DEMO DATA AND ACCESS

Seed realistic but entirely fictional Malta-based demo data.

Include representative localities such as:

- Sliema
- St. Julian's
- Swieqi
- Mosta
- Naxxar
- Valletta
- Birkirkara
- Mellieha
- Victoria, Gozo

Seed:

- Service categories.
- Category attributes and modes.
- Fictional worker profiles.
- Worker skills.
- Availability.
- Pricing.
- Several sample requests.
- Representative booking states.

Use clearly marked fictitious demo providers.

Create a safe demo account strategy:

- Local development can seed documented test accounts using nonproduction credentials.
- Public staging must not expose hardcoded privileged credentials.
- Prefer controlled demo personas/session creation without access to real personal data.
- Demo data must never be confused with genuine available workers.

Keep public landing pages accessible.

For transactional demo actions, display a clear DEMO banner and simulated-money warning.

There must be a simple way for the repository owner to test the full experience.

## 14. REQUIRED END-TO-END SCENARIOS

The following scenarios must be implemented and verified.

### Scenario A — Urgent plumber

1. Customer opens the website.
2. Selects Plumbing.
3. Selects Do It For Me.
4. Enters a leaking toilet description.
5. Chooses ASAP.
6. Sees compatible workers.
7. Selects a worker.
8. Sends a request.
9. Worker accepts.
10. Customer confirms.
11. A booking is created.
12. Worker marks in progress.
13. Worker completes job.
14. Simulated payment is recorded.
15. Customer submits a review.
16. Admin sees the completed transaction.

### Scenario B — Tiling with customer participation

1. Customer selects Tiling.
2. Chooses Do It With Me.
3. Describes task and selects scheduled time.
4. Worker reviews request.
5. Worker submits a quote.
6. Customer accepts.
7. Booking is confirmed.
8. Booking appears in both dashboards.

### Scenario C — Teach Me

1. Customer selects an eligible service.
2. Chooses Teach Me.
3. Finds a worker offering lessons.
4. Selects a scheduled session.
5. Confirms the booking.
6. Both parties see the lesson appropriately labeled.

### Scenario D — Booking conflict

1. Two customers request the same worker for an overlapping period.
2. Concurrent acceptance attempts are triggered.
3. Exactly one conflicting reservation can be committed.
4. The unsuccessful attempt receives a sensible conflict response.
5. The database remains consistent.

### Scenario E — Admin verification

1. New worker registers.
2. Worker requests verification.
3. Admin reviews submission.
4. Admin approves or rejects it.
5. Worker eligibility and public profile update accordingly.

Implement Playwright tests for the customer-facing flows and automated integration/concurrency tests for critical invariants.

## 15. DEPLOYMENT — MAKE THIS LIVE

Prefer a low-complexity deployment.

Use one Azure App Service application serving:

- The compiled React application.
- The ASP.NET Core API under /api.
- Necessary static assets.
- Health endpoints.

Avoid unnecessary separate frontend hosting and CORS configuration in the first version.

Production database: Azure SQL Database.

Provide Azure Bicep files for:

- Resource group-scoped application resources.
- App Service plan.
- Web application.
- Azure SQL logical server/database where appropriate.
- Application monitoring.
- Storage resources if required.
- Managed identity and relevant configuration.

Use secure defaults where feasible.

Allow region, resource names, SKU, and environment names to be configured.

Provide a cost-conscious staging configuration and explain expected recurring resource categories. Do not claim a specific price without verified SKU/region pricing.

### Deployment automation

Create GitHub Actions workflows:

**ci.yml**
- Checkout.
- Install .NET SDK.
- Install Node.
- Restore dependencies.
- Type check.
- Lint.
- Build frontend.
- Build backend.
- Run backend unit tests.
- Run integration tests where database infrastructure is available.
- Run frontend tests.
- Publish artifacts.

**deploy-staging.yml**
- Only deploy following successful appropriate checks.
- Authenticate to Azure with OIDC.
- Build and publish the application.
- Apply reviewed EF Core migrations through an explicit, safe deployment step or documented migration bundle.
- Deploy to Azure App Service.
- Run health and smoke checks.
- Report application URL and deployment results.
- Protect the staging environment with appropriate GitHub permissions.

Do not introduce destructive database migration behavior.

Use a deployment approval checkpoint when needed.

If credentials are unavailable, keep deployment disabled or explicitly blocked rather than allowing misleading green deployment status.

### Exact operator instructions

Create `docs/DEPLOY-AZURE.md` including:

1. Azure prerequisites.
2. Required permissions.
3. Estimated resource categories and cost considerations.
4. Commands to provision resources.
5. How to configure GitHub OIDC.
6. Exact repository variables and secrets to configure.
7. How to initialize Azure SQL.
8. How to configure App Service identity.
9. How to apply migrations.
10. How to deploy.
11. How to access and test the website.
12. How to view logs.
13. How to roll back application releases.
14. How to stop or delete Azure resources to avoid unnecessary charges.

Never ask for secrets to be pasted into source files or pull-request comments.

## 16. ENGINEERING SKILLS AND MCP READINESS

Create AGENTS.md with concise, authoritative instructions for Codex.

It must define:

- Architecture and directory responsibilities.
- Build and test commands.
- Coding standards.
- Database migration policy.
- Security expectations.
- Definition of done.
- Expectations for PR descriptions.
- Rules against bypassing failing tests.

Create focused agent skills under `.agents/skills/`, using each skill's required SKILL.md format where supported.

Initial skills:

1. dotnet-backend
2. azure-sql-performance
3. booking-concurrency
4. react-frontend
5. testing-and-quality
6. secure-development

Keep skills short, scoped, and actionable.

Do not fill the repository with generic instructions repeated across every file.

MCP must remain optional.

Provide `docs/MCP-INTEGRATION.md` with a proposed extension contract for future project-context tools, without inventing an unavailable MCP server or making the MVP dependent on it.

Do not install external skill packages automatically.

Tessl and Promptfoo may be documented as later evaluation options, but they must not block the initial application delivery.

## 17. QUALITY REQUIREMENTS

Implement:

- Meaningful unit tests for domain rules.
- Integration tests with SQL Server for persistence behavior.
- Authentication and authorization tests.
- Booking concurrency tests.
- Price calculation tests.
- Matching tests.
- Playwright end-to-end tests.
- Frontend lint and type checks.
- Backend formatting or analyzer checks.
- Production build verification.
- Health/readiness endpoints.
- Structured error responses.
- Sensible seed-data management.
- Dependabot configuration or equivalent dependency maintenance.

Avoid brittle tests that only verify mocked implementation details.

Integration tests should exercise the actual SQL Server provider rather than substituting EF Core's in-memory provider for transactional invariants.

If Docker or database services are unavailable inside the Codex environment, run all independently executable tests and document the missing integration-test prerequisites. Ensure GitHub CI can execute the complete suite.

## 18. DEVELOPMENT PHASES

Execute in this order, but do not stop after describing the phases.

### Phase 1 — Foundation

- Repository structure.
- .NET solution and projects.
- React frontend.
- Azure SQL EF Core integration.
- Migrations.
- Authentication.
- Docker Compose.
- Health endpoint.
- CI build.
- AGENTS.md.

**Exit criterion:** Application builds and can run locally with a real SQL Server database.

### Phase 2 — Marketplace functionality

- Service catalog.
- Worker profiles.
- Customer accounts.
- Availability.
- Search and matching.
- Request creation.
- Booking state machine.
- Worker acceptance.
- Quotes.
- Cancellation.
- Simulated payment.
- Reviews.

**Exit criterion:** Urgent plumber scenario works end to end.

### Phase 3 — UI completeness

- Responsive landing page.
- Customer portal.
- Worker portal.
- Admin portal.
- Forms and validation.
- Booking status indicators.
- Useful loading/empty/error states.

**Exit criterion:** All main scenarios can be completed through the UI.

### Phase 4 — Verification

- Automated tests.
- Security review.
- Database concurrency tests.
- Accessibility checks.
- Bug fixing.
- Build verification.

**Exit criterion:** Mandatory test and build gates pass, and unresolved limitations are documented.

### Phase 5 — Azure deployment

- Bicep.
- GitHub Actions deployment workflow.
- Azure setup instructions.
- Environment configuration.
- Database migration strategy.
- Health and smoke checks.

**Exit criterion:** Website is publicly reachable in an authorized demo/staging environment, or the repository is fully deployment-ready with exact documented blockers requiring owner access.

## 19. DEFINITION OF DONE

Do not report success simply because files were generated.

The implementation is considered complete only when:

- Customer UI works.
- Worker UI works.
- Admin UI works.
- Azure SQL schema and migrations exist.
- Booking logic is transactionally correct.
- All three service modes are supported.
- Quote-based and direct bookings work.
- Simulated payments are clearly identified.
- Booking status is persisted and visible.
- At least one complete end-to-end customer journey passes.
- Automated backend and frontend checks pass.
- Critical concurrency tests pass.
- CI is functional.
- Deployment infrastructure and instructions are complete.
- A real public staging URL has been verified, if Azure access is available.
- Remaining blockers are explicitly documented.

## 20. EXPECTED OUTPUT

At the end, provide:

1. Link to the GitHub pull request.
2. Summary of implemented features.
3. Working URL if actually deployed.
4. Commands required to run locally.
5. Tests executed with actual results.
6. Known defects or incomplete features.
7. Database migration details.
8. Azure deployment instructions.
9. Approximate infrastructure cost considerations.
10. Next three development priorities.

Create a `docs/PROGRESS.md` containing:

- Completed work.
- Tests executed.
- Remaining work.
- Known risks.
- Deployment status.
- Decisions made.
- Exact next steps.

Update this document throughout implementation so progress is recoverable across Codex sessions.

## 21. AUTONOMY AND DECISION RULES

You have permission to make reasonable implementation decisions within the approved architecture.

Do not repeatedly ask questions whose answers can be established from these instructions.

Prefer working functionality over theoretical extensibility.

Never disable security or tests merely to make a build pass.

Never fabricate successful tests, live payments, external integrations, infrastructure provisioning, or deployment.

Never create chargeable Azure resources, make the repository public/private, or configure real payment providers without the repository owner's authorization.

Do not expose credentials.

Do not merge into main automatically.

Develop on a feature branch and open a pull request for review.

If the work is too large for one Codex run, prioritize a genuinely working booking vertical slice first. Commit recoverable progress, update PROGRESS.md, and clearly identify the continuation steps.

Begin now by inspecting the repository, selecting the simplest sound implementation, and then **writing and testing the application code**.

Do not respond with only a proposed plan.

The outcome must be a working, extensible Daqqa t'Id marketplace MVP, not a prototype consisting of static screens.
