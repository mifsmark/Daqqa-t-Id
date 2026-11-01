using System.Security.Claims;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;

public static class MediaEndpoints
{
    private const long MaxUploadBytes = 5 * 1024 * 1024;

    public static RouteGroupBuilder MapMediaEndpoints(this RouteGroupBuilder api)
    {
        api.MapPost("/media", UploadAsync).RequireAuthorization();
        // Avatar and portfolio media are public. Booking attachments are returned only after
        // the booking has been confirmed and to one of its two participants.
        api.MapGet("/media/{id:guid}", ReadAsync);
        api.MapGet("/workers/{id:guid}/media", ListWorkerMediaAsync);
        api.MapGet("/bookings/{id:guid}/media", ListBookingMediaAsync).RequireAuthorization();
        return api;
    }

    private static async Task<IResult> UploadAsync(HttpRequest request, ClaimsPrincipal principal,
        AppDbContext db, IConfiguration configuration, IWebHostEnvironment environment, CancellationToken ct)
    {
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var ownerId))
            return Results.Unauthorized();
        var role = principal.FindFirstValue(ClaimTypes.Role);
        if (role is not (RoleNames.Worker or RoleNames.Customer)) return Results.Forbid();
        if (!request.HasFormContentType) return Results.BadRequest(new { title = "Expected multipart form data", status = 400 });

        const long maxRequestBytes = MaxUploadBytes + 128 * 1024;
        var bodyLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = maxRequestBytes;
        if (request.ContentLength is > maxRequestBytes) return Results.BadRequest(new { title = "Image exceeds the 5 MB limit", status = 400 });
        request.HttpContext.Features.Set<IFormFeature>(new FormFeature(request, new FormOptions
        {
            MultipartBodyLengthLimit = maxRequestBytes,
            ValueLengthLimit = 4096,
            ValueCountLimit = 16,
            KeyLengthLimit = 128,
            MultipartHeadersCountLimit = 16,
            MultipartHeadersLengthLimit = 8192
        }));

        IFormCollection form;
        try { form = await request.ReadFormAsync(ct); }
        catch (InvalidDataException) { return Results.BadRequest(new { title = "Image exceeds the 5 MB request limit", status = 400 }); }
        if (form.Files.Count != 1) return Results.BadRequest(new { title = "Upload one image at a time", status = 400 });
        var purpose = form["purpose"].ToString().Trim().ToLowerInvariant();
        var bookingIdText = form["bookingId"].ToString();
        Guid? bookingId = null;
        if (purpose is "avatar" or "portfolio")
        {
            if (role != RoleNames.Worker || !string.IsNullOrEmpty(bookingIdText)) return Results.BadRequest(new { title = "Invalid media purpose", status = 400 });
            if (!await db.Workers.AnyAsync(x => x.UserId == ownerId, ct)) return Results.Forbid();
        }
        else if (purpose == "booking")
        {
            if (!Guid.TryParse(bookingIdText, out var parsedBooking)) return Results.BadRequest(new { title = "A bookingId is required", status = 400 });
            bookingId = parsedBooking;
            var booking = await db.Bookings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == parsedBooking, ct);
            if (booking is null || (booking.CustomerId != ownerId && !await db.Workers.AnyAsync(x => x.Id == booking.WorkerId && x.UserId == ownerId, ct))) return Results.NotFound();
            if (booking.Status is not (BookingStatus.Confirmed or BookingStatus.InProgress or BookingStatus.Completed))
                return Results.Conflict(new { title = "Booking images are available after confirmation", status = 409 });
        }
        else return Results.BadRequest(new { title = "Purpose must be avatar, portfolio, or booking", status = 400 });

        var file = form.Files[0];
        if (file.Length is <= 0 or > MaxUploadBytes) return Results.BadRequest(new { title = "Image must be between 1 byte and 5 MB", status = 400 });
        byte[] bytes;
        await using (var input = file.OpenReadStream())
        await using (var output = new MemoryStream((int)Math.Min(file.Length, MaxUploadBytes)))
        {
            var buffer = new byte[81920];
            int read;
            while ((read = await input.ReadAsync(buffer, ct)) != 0)
            {
                if (output.Length + read > MaxUploadBytes) return Results.BadRequest(new { title = "Image exceeds the 5 MB limit", status = 400 });
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            bytes = output.ToArray();
        }

        var contentType = DetectImageType(bytes);
        if (contentType is null) return Results.BadRequest(new { title = "Only PNG, JPEG, and WebP images are accepted", status = 400 });
        var key = Guid.NewGuid().ToString("N") + (contentType switch { "image/png" => ".png", "image/jpeg" => ".jpg", _ => ".webp" });
        try
        {
            await MediaStorage.WriteAsync(configuration, environment, key, contentType, bytes, ct);
            var media = new SavedMedia
            {
                OwnerId = ownerId,
                Purpose = purpose,
                BookingId = bookingId,
                ContentType = contentType,
                StorageKey = key,
                OriginalName = SafeOriginalName(file.FileName),
                CreatedAt = DateTimeOffset.UtcNow,
                Size = bytes.LongLength
            };
            db.Media.Add(media);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/media/{media.Id}", new { id = media.Id, url = $"/api/media/{media.Id}", contentType = media.ContentType });
        }
        catch
        {
            try { await MediaStorage.DeleteAsync(configuration, environment, key, CancellationToken.None); } catch { }
            throw;
        }
    }

    private static async Task<IResult> ReadAsync(Guid id, ClaimsPrincipal principal, AppDbContext db,
        IConfiguration configuration, IWebHostEnvironment environment, CancellationToken ct)
    {
        var media = await db.Media.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        if (media is null) return Results.NotFound();
        var isPublic = media.BookingId is null && media.Purpose is "avatar" or "portfolio"
            && await db.Workers.AnyAsync(w => w.UserId == media.OwnerId && w.VerificationStatus != VerificationStatus.Suspended
                && db.Users.Any(u => u.Id == w.UserId && !u.IsSuspended), ct);
        if (!isPublic)
        {
            if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return Results.NotFound();
            var booking = media.BookingId is null ? null : await db.Bookings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == media.BookingId, ct);
            if (booking is null || booking.Status is not (BookingStatus.Confirmed or BookingStatus.InProgress or BookingStatus.Completed)
                || (booking.CustomerId != userId && !await db.Workers.AnyAsync(x => x.Id == booking.WorkerId && x.UserId == userId, ct)))
                return Results.NotFound();
        }

        if (string.IsNullOrWhiteSpace(media.StorageKey) || Path.GetFileName(media.StorageKey) != media.StorageKey
            || media.StorageKey.Contains('/') || media.StorageKey.Contains('\\'))
            return Results.NotFound();
        var stream = await MediaStorage.OpenReadAsync(configuration, environment, media.StorageKey, ct);
        if (stream is null) return Results.NotFound();
        return Results.Stream(stream, media.ContentType, enableRangeProcessing: false);
    }

    private static async Task<IResult> ListWorkerMediaAsync(Guid id, AppDbContext db, CancellationToken ct)
    {
        var workerIsPublic = await db.Workers.AnyAsync(w => w.Id == id && w.VerificationStatus != VerificationStatus.Suspended
            && db.Users.Any(u => u.Id == w.UserId && !u.IsSuspended), ct);
        if (!workerIsPublic) return Results.NotFound();
        var ownerId = await db.Workers.Where(w => w.Id == id).Select(w => w.UserId).SingleAsync(ct);
        var rows = await db.Media.AsNoTracking().Where(m => m.OwnerId == ownerId && m.BookingId == null
                && (m.Purpose == "avatar" || m.Purpose == "portfolio"))
            .OrderBy(m => m.CreatedAt).Select(m => new { id = m.Id, url = $"/api/media/{m.Id}", contentType = m.ContentType, purpose = m.Purpose })
            .ToListAsync(ct);
        return Results.Ok(rows);
    }

    private static async Task<IResult> ListBookingMediaAsync(Guid id, ClaimsPrincipal principal, AppDbContext db, CancellationToken ct)
    {
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return Results.NotFound();
        var booking = await db.Bookings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        if (booking is null || booking.Status is not (BookingStatus.Confirmed or BookingStatus.InProgress or BookingStatus.Completed)
            || (booking.CustomerId != userId && !await db.Workers.AnyAsync(x => x.Id == booking.WorkerId && x.UserId == userId, ct)))
            return Results.NotFound();
        var rows = await db.Media.AsNoTracking().Where(m => m.BookingId == id && m.Purpose == "booking")
            .OrderBy(m => m.CreatedAt).Select(m => new { id = m.Id, url = $"/api/media/{m.Id}", contentType = m.ContentType, purpose = m.Purpose })
            .ToListAsync(ct);
        return Results.Ok(rows);
    }

    private static string? DetectImageType(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 8 && bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff) return "image/jpeg";
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }

    private static string? SafeOriginalName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var safe = Path.GetFileName(name.Replace('\\', '/'));
        return safe.Length <= 260 ? safe : safe[..260];
    }
}
