# Media uploads and password reset email

## Media

`POST /api/media` requires a signed-in Worker or Customer and the normal `X-CSRF-TOKEN` header. Send `multipart/form-data` with one file field and a `purpose` field. The supported purposes are:

| Purpose | Allowed account | Additional field | Read access |
| --- | --- | --- | --- |
| `avatar` | Worker | none | Public |
| `portfolio` | Worker | none | Public |
| `booking` | Customer on the booking or its assigned Worker | `bookingId` | Those two booking participants, after confirmation |

Uploads are limited to 5 MB and accepted only when PNG, JPEG, or WebP file signatures match. SVG and other active content are rejected. A successful response is `{ "id": "…", "url": "/api/media/…", "contentType": "image/png" }`. `GET /api/workers/{workerProfileId}/media` lists public avatar and portfolio rows as `{id,url,contentType,purpose}`. `GET /api/bookings/{bookingId}/media` lists private booking images for the customer or assigned worker only while the booking is Confirmed, InProgress, or Completed; private object reads use the same rule and return 404 for other callers. Booking media uploads are only accepted after a booking reaches Confirmed, InProgress, or Completed, so customers cannot attach images to a request before confirmation.

Files are stored outside `wwwroot`, under `App_Data/uploads` by default. Set `Media__StoragePath` to change the local location. When `Media__BlobServiceUri` is set to the HTTPS Blob service endpoint, the API uses Azure Blob Storage instead; `Media__ContainerName` selects the pre-provisioned container and defaults to `uploads`. The Azure container must remain private. The adapter uses `DefaultAzureCredential`, which uses the App Service managed identity in Azure; grant that identity the **Storage Blob Data Contributor** role on the storage account or container. It does not use account keys, connection strings, public access, or SAS URLs. Provision the container before enabling the setting. The repository Bicep provisions a private `media` container and grants the App Service identity the storage role, so set `Media__ContainerName=media` for that deployment. When `Media__BlobServiceUri` is absent, local filesystem storage is used. The generated key is private and is never returned by the API.

## Password recovery

Configure SMTP through environment-backed configuration keys. TLS is required for SMTP connections; optional credentials must be supplied as a pair.

| Key | Required | Example |
| --- | --- | --- |
| `MAIL_HOST` | Yes | `smtp.example.net` |
| `MAIL_PORT` | Yes | `587` |
| `MAIL_FROM` | Yes | `no-reply@example.net` |
| `MAIL_USERNAME` | No | Set with `MAIL_PASSWORD` |
| `MAIL_PASSWORD` | No | Set with `MAIL_USERNAME` |
| `PublicOrigin` / `PUBLIC_ORIGIN` | Yes | `https://daqqatid.example` |

Keep credentials in the hosting environment or secret store. Do not commit them to `appsettings.json` or `.env.example` with real values. When SMTP or the public origin is missing, `POST /api/auth/forgot-password` returns 503 and does not issue reset tokens. Once configured, it returns the same generic response for known and unknown addresses; delivery failures return 503 without disclosing the address, token, or SMTP error. Reset links lead to `/reset-password?email=…&token=…`; the client submits these values with the new password to `POST /api/auth/reset-password`. Identity validates and consumes the reset token. Reset tokens are never returned by the API or written to application logs.
