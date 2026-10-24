# Pilot operations

Use real worker availability and verification before advertising coverage. A worker's available-now switch is self-declared; it is not live tracking. Demo profiles and simulated financial records must stay visibly distinguished from a genuine pilot.

## Verification and support

An authorized admin reviews worker submissions in `/admin`, checks references against appropriate independent evidence, and records the decision. Do not approve a professional merely because a reference was supplied. Regulated categories allow only Do It For Me and require approval. Suspend accounts when an eligibility or conduct issue needs investigation; the server immediately rejects further authenticated activity from suspended users.

For cancellations and disputes, locate the booking through the admin account's booking dashboard, review the status history and contact details, contact the participants through an authorized support channel, and retain an access-controlled case record outside the application. The MVP has no integrated dispute ticketing, refunds, or live settlement. Do not describe simulated balances as money owed or paid. Keep support contact and response responsibilities defined before a real pilot.

## Privacy requests

Customers and workers submit export/delete requests from Account. An admin finds them in the privacy queue with the account ID and submission time. Assign a named operator and record the response deadline and outcome in an access-controlled support register. Verify the requester through their existing authenticated account/contact channel; never ask for their password.

For export, have an authorized operator gather only that account's profile, saved addresses, worker offerings/availability/media metadata, owned booking/history/review data and simulated records. Use the protected admin/account read paths and a reviewed, narrowly scoped database export where the UI lacks a read path. Exclude other customers' addresses and identity/security records such as password hashes, tokens, security stamps and authentication cookies. Deliver securely to the verified requester; do not attach exports to public issues or PRs.

For deletion, acknowledge the request, suspend the account if requested, then have the data owner review lawful retention of transactional/audit data. A database administrator must perform a reviewed account-specific erasure/anonymization and delete the corresponding local/Blob media objects, retaining only records that have a documented legal basis. Preserve booking/financial references needed for legitimate retention; do not hard-delete transaction history indiscriminately. Record completion and tell the requester what was retained and why. Automatic export/erasure and queue resolution controls remain future work.

## First users

Use the assisted onboarding and recruitment checklist in LAUNCH-AND-GROWTH.md. Start with services/localities that actually have eligible workers. Help workers set their own password and review their own profile; do not collect passwords or post on their behalf without consent. Public profile links and WhatsApp share buttons open a user-controlled composer and never send automatic invitations.
