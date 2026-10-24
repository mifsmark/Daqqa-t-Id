using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace DaqqaTid.Api;

public static class NotificationEndpoints
{
    private const string CookieName = "DaqqaTid.NotificationDevice";
    public static RouteGroupBuilder MapNotifications(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/notifications").RequireAuthorization();
        group.MapGet("", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = UserId(ctx); var items = await db.Notifications.AsNoTracking().Where(x => x.RecipientId == uid).OrderByDescending(x => x.CreatedAt).Take(40).Select(x => new { id = x.Id, bookingId = x.BookingId, kind = x.Kind, title = x.Title, message = x.Message, url = x.Url, createdAt = x.CreatedAt, readAt = x.ReadAt }).ToListAsync(ct);
            var unread = await db.Notifications.CountAsync(x => x.RecipientId == uid && x.ReadAt == null, ct); return Results.Ok(new { items, unreadCount = unread });
        });
        group.MapPost("/{id:guid}/read", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) => { var item = await db.Notifications.SingleOrDefaultAsync(x => x.Id == id && x.RecipientId == UserId(ctx), ct); if (item is null) return Results.NotFound(); item.ReadAt ??= DateTimeOffset.UtcNow; await db.SaveChangesAsync(ct); return Results.NoContent(); });
        group.MapPost("/read-all", async (HttpContext ctx, AppDbContext db, CancellationToken ct) => { var uid = UserId(ctx); await db.Notifications.Where(x => x.RecipientId == uid && x.ReadAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.ReadAt, DateTimeOffset.UtcNow), ct); return Results.NoContent(); });
        group.MapGet("/push-config", async (HttpContext ctx, AppDbContext db, IConfiguration config, UserManager<ApplicationUser> users, CancellationToken ct) =>
        {
            var token = DeviceCookie(ctx); var uid = UserId(ctx); var hash = Hash(token);
            var user = await users.FindByIdAsync(uid.ToString());
            var subscribed = user is not null && !user.IsSuspended && await db.NotificationDevices.AnyAsync(x => x.UserId == uid && x.DeviceTokenHash == hash && x.ExpiresAt > DateTimeOffset.UtcNow && x.SecurityStamp == (user.SecurityStamp ?? ""), ct);
            var enabled = !string.IsNullOrWhiteSpace(config["Notifications:VapidPublicKey"]) && !string.IsNullOrWhiteSpace(config["Notifications:VapidPrivateKey"]) && !string.IsNullOrWhiteSpace(config["Notifications:VapidSubject"]);
            return Results.Ok(new { enabled, publicKey = enabled ? config["Notifications:VapidPublicKey"] : null, subscribed });
        });
        group.MapPost("/push-subscriptions", async (PushInput input, HttpContext ctx, AppDbContext db, UserManager<ApplicationUser> users, CancellationToken ct) =>
        {
            if (!Valid(input)) return Results.BadRequest(new { title = "Invalid push subscription", status = 400 });
            var uid = UserId(ctx); var token = DeviceCookie(ctx); var hash = Hash(token); var user = await users.FindByIdAsync(uid.ToString()); if (user is null || user.IsSuspended) return Results.Forbid();
            await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUserAsync(db, uid, ct);
            await db.NotificationDevices.Where(x => x.UserId == uid && (x.ExpiresAt <= DateTimeOffset.UtcNow || x.SecurityStamp != (user.SecurityStamp ?? ""))).ExecuteDeleteAsync(ct);
            var ticket = await ctx.AuthenticateAsync(); var expiresAt = ticket.Properties?.ExpiresUtc?.ToUniversalTime() ?? DateTimeOffset.UtcNow.AddDays(14);
            var endpointHash = Hash(input.Endpoint!);
            var endpoint = await db.NotificationDevices.SingleOrDefaultAsync(x => x.EndpointHash == endpointHash, ct);
            if (endpoint is not null && endpoint.UserId != uid) return Results.Conflict(new { title = "Endpoint belongs to another account", status = 409 });
            var device = await db.NotificationDevices.SingleOrDefaultAsync(x => x.DeviceTokenHash == hash, ct);
            if (device is not null && device.UserId != uid) return Results.Conflict();
            if (endpoint is not null && endpoint != device) db.NotificationDevices.Remove(endpoint);
            if (device is null) { if (await db.NotificationDevices.CountAsync(x => x.UserId == uid, ct) >= 5) return Results.Conflict(new { title = "Maximum active subscriptions reached", status = 409 }); device = new NotificationDevice { UserId = uid, DeviceTokenHash = hash, CreatedAt = DateTimeOffset.UtcNow }; db.NotificationDevices.Add(device); }
            device.SecurityStamp = user.SecurityStamp ?? ""; device.ExpiresAt = expiresAt;
            device.Endpoint = input.Endpoint!; device.EndpointHash = endpointHash; device.P256dh = input.Keys!.P256dh!; device.Auth = input.Keys.Auth!; device.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Results.NoContent();
        });
        group.MapDelete("/push-subscriptions", async (HttpContext ctx, AppDbContext db, CancellationToken ct) => { var hash = Hash(DeviceCookie(ctx)); var uid = UserId(ctx); await db.NotificationDevices.Where(x => x.UserId == uid && x.DeviceTokenHash == hash).ExecuteDeleteAsync(ct); return Results.NoContent(); });
        group.MapPost("/test", async (HttpContext ctx, AppDbContext db, IConfiguration config, UserManager<ApplicationUser> users, CancellationToken ct) =>
        {
            var uid = UserId(ctx); var hash = Hash(DeviceCookie(ctx));
            await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUserAsync(db, uid, ct);
            var user = await users.FindByIdAsync(uid.ToString());
            var device = user is null || user.IsSuspended ? null : await db.NotificationDevices.SingleOrDefaultAsync(x => x.UserId == uid && x.DeviceTokenHash == hash && x.ExpiresAt > DateTimeOffset.UtcNow && x.SecurityStamp == (user.SecurityStamp ?? ""), ct);
            var configured = !string.IsNullOrWhiteSpace(config["Notifications:VapidPublicKey"]) && !string.IsNullOrWhiteSpace(config["Notifications:VapidPrivateKey"]) && !string.IsNullOrWhiteSpace(config["Notifications:VapidSubject"]);
            if (device is null || !configured) return Results.Conflict(new { title = "Push is not configured for this device", status = 409 });
            if (await db.Notifications.CountAsync(x => x.RecipientId == uid && x.Kind == "Test" && x.CreatedAt > DateTimeOffset.UtcNow.AddMinutes(-10), ct) >= 3) return Results.StatusCode(429);
            var notification = new UserNotification { RecipientId = uid, SourceType = "Test", SourceId = Guid.NewGuid(), Kind = "Test", Title = "Daqqa t’Id test notification", Message = "Push notifications are enabled on this device.", Url = "/dashboard", CreatedAt = DateTimeOffset.UtcNow };
            db.Notifications.Add(notification); db.NotificationOutbox.Add(new NotificationOutbox { NotificationId = notification.Id, DeviceId = device.Id, DueAt = notification.CreatedAt }); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Results.Accepted(value: new { queued = true });
        });
        return api;
    }
    private static Guid UserId(HttpContext ctx) => Guid.Parse(ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
    private static string DeviceCookie(HttpContext ctx) { var token = ctx.Request.Cookies[CookieName]; if (string.IsNullOrEmpty(token)) { token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)); ctx.Response.Cookies.Append(CookieName, token, new CookieOptions { HttpOnly = true, Secure = !ctx.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment(), SameSite = SameSiteMode.Strict, Path = "/", IsEssential = true, MaxAge = TimeSpan.FromDays(365) }); } return token; }
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static async Task LockUserAsync(AppDbContext db, Guid userId, CancellationToken ct) { var connection = db.Database.GetDbConnection(); await using var command = connection.CreateCommand(); command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction(); command.CommandText = "SELECT [Id] FROM [AspNetUsers] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = @id"; var p = command.CreateParameter(); p.ParameterName = "@id"; p.Value = userId; command.Parameters.Add(p); await command.ExecuteScalarAsync(ct); }
    private static bool Valid(PushInput x)
    {
        if (string.IsNullOrWhiteSpace(x.Endpoint) || x.Endpoint.Length > 2048 || !Uri.TryCreate(x.Endpoint, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length != 0 || uri.Port != 443 || !string.IsNullOrEmpty(uri.Fragment)
            || !string.Equals(uri.AbsoluteUri, x.Endpoint, StringComparison.Ordinal)) return false;
        var host = uri.Host.ToLowerInvariant(); var allowed = host is "fcm.googleapis.com" or "updates.push.services.mozilla.com" or "web.push.apple.com" || host.EndsWith(".push.services.mozilla.com", StringComparison.Ordinal) || host.EndsWith(".notify.windows.com", StringComparison.Ordinal);
        if (!allowed || x.Keys?.P256dh is not { Length: <= 100 } p256dh || x.Keys.Auth is not { Length: <= 32 } auth || !Decode(p256dh, 65) || !Decode(auth, 16)) return false;
        try
        {
            var key = Convert.FromBase64String(Pad(p256dh));
            if (key[0] != 4) return false;
            using var curveKey = ECDiffieHellman.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = key[1..33], Y = key[33..65] } });
            return true;
        }
        catch (CryptographicException) { return false; }
        catch (ArgumentException) { return false; }
    }
    private static bool Decode(string? s, int length) { try { return s is not null && s.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') && Convert.FromBase64String(Pad(s)).Length == length; } catch { return false; } }
    private static string Pad(string s) => s.Replace('-', '+').Replace('_', '/') + new string('=', (4 - s.Length % 4) % 4);
    public sealed record PushInput(string? Endpoint, PushKeys? Keys);
    public sealed record PushKeys(string? P256dh, string? Auth);
}
