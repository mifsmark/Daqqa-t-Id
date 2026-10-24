# Booking updates and phone alerts

Signed-in customers and helpers have an **Updates** inbox behind the bell. New items show an unread count; opening an item marks it read and takes the recipient to their booking. The inbox refreshes while the app is visible and when the user returns to it. It works without phone-alert permission.

| Event | Recipient |
| --- | --- |
| New request; customer confirms | Helper offering the service |
| Helper quotes, accepts, starts or completes | Customer |
| Cancellation or expiry event | Both participants |
| Customer review | Helper |

Events are recorded with the booking change or review in the same transaction. Request retries and losing concurrent transitions do not create another event. The inbox returns the latest 40 items and the total unread count. Older history is retained. No new automatic expiry scheduler is introduced by this feature.

## Turn on phone alerts

1. Sign in on the phone you will use, open the bell, and choose **Turn on phone alerts**.
2. Allow notifications in the browser prompt. Permission is requested only after this action.
3. Choose **Send a test alert**. The app confirms that the test was queued; check the phone itself for receipt.
4. A helper should test a new request from a separate customer session and the customer's confirmation. The customer should test acceptance, start and completion updates.

On iPhone/iPad, add the app to the Home Screen using the browser's Share menu, then open that installed icon before enabling alerts. Browser support, device settings, focus modes and network conditions affect delivery. If permission was denied, change it in browser/device settings. In-app updates remain available. No SMS or email notification provider is configured.

**Turn off phone alerts** revokes this device's subscription. Logout also revokes it; expired/revoked sessions and suspended accounts are excluded from new sends. On a shared device, log out before another person uses it. A push already accepted by a provider can still arrive. Notification text is generic and excludes job addresses, contact details and private descriptions.

## Configuration and delivery

Apply reviewed D1 migration `0002_booking_notifications.sql` or SQL Server migration `20261024132800_AddNotifications` before publishing the corresponding backend. Existing data is preserved; no reset is needed. For optional standard Web Push, configure a matching P-256 VAPID pair and a valid HTTPS or mailto contact subject:

| Backend | Configuration |
| --- | --- |
| Cloudflare secrets | `VAPID_SERVER_PUBLIC_KEY`, `VAPID_SERVER_PRIVATE_KEY`, `VAPID_SUBJECT` |
| .NET environment | `Notifications__VapidPublicKey`, `Notifications__VapidPrivateKey`, `Notifications__VapidSubject` |

Keep the private key out of the repository, console output and public API. Reuse it across releases. A key rotation requires the device to register again. Missing configuration leaves the inbox usable and phone alerts unavailable. .NET intentionally skips delivery polling when keys are missing.

Cloudflare schedules delivery after relevant requests with `waitUntil` and uses a one-minute staging cron for retries, processing at most two jobs per drain. The .NET hosted worker drains its SQL-backed outbox. Both use a lease and conditional acknowledgement, up to six attempts with backoff, and a 24-hour job expiry. Provider 404/410 removes a dead subscription; redirects are not followed. Stale booking-status pushes are suppressed, including cancelled requests and new requests whose start time has elapsed; in-app history remains. Delivery can occur more than once if a provider accepts a request before its acknowledgement is saved; a shared notification tag replaces duplicate booking cards where supported.

Registration accepts approved browser push-provider HTTPS endpoints, validates subscription keys and caps subscriptions at five per account. Test alerts are limited to three per ten minutes. Phone subscriptions and provider endpoints are private account data. No paid queue, SMS, email, or third-party notification subscription is required. Free Cloudflare quotas still apply; delivery time is not guaranteed.

## API

All routes require the current unsuspended account. All writes require CSRF. IDs from another recipient return 404; reads and read-all are scoped to the current user.

- `GET /api/notifications` → `{items:[{id,bookingId,kind,title,message,url,createdAt,readAt}],unreadCount}`. Booking IDs are canonical lowercase UUID strings or null for a test.
- `POST /api/notifications/{id}/read {}` and `POST /api/notifications/read-all {}` → 204.
- `GET /api/notifications/push-config` → `{enabled,publicKey,subscribed}` for this device/session.
- `POST /api/notifications/push-subscriptions {endpoint,keys:{p256dh,auth}}` → 204; `DELETE` at the same path revokes this device/session.
- `POST /api/notifications/test {}` → 202 `{queued:true}`. A queued response is not proof that the operating system displayed an alert.

Automated SQL/D1 tests exercise recipients, ownership, retries and provider responses; browser tests exercise the real inbox. A real opted-in phone is required to verify the final OS notification display.
