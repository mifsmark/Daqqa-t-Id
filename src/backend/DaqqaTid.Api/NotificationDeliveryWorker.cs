using System.Text.Json;
using DaqqaTid.Infrastructure;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DaqqaTid.Api;

public sealed class NotificationPushSender(PushServiceClient client)
{
    public Task SendAsync(NotificationDevice device, UserNotification notification, string subject, string publicKey, string privateKey, CancellationToken ct)
    {
        var auth = new VapidAuthentication(publicKey, privateKey) { Subject = subject };
        var subscription = new PushSubscription { Endpoint = device.Endpoint };
        subscription.SetKey(PushEncryptionKeyName.P256DH, device.P256dh); subscription.SetKey(PushEncryptionKeyName.Auth, device.Auth);
        var payload = JsonSerializer.Serialize(new { title = notification.Title, body = notification.Message, url = notification.Url, tag = notification.BookingId?.ToString() ?? notification.Id.ToString() });
        return client.RequestPushMessageDeliveryAsync(subscription, new PushMessage(payload) { TimeToLive = 3600 }, auth, ct);
    }
}

public sealed class NotificationDeliveryWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<NotificationDeliveryWorker> logger, NotificationPushSender sender) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (!PushConfigured())
            {
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                continue;
            }
            try { if (!await DeliverOneAsync(stoppingToken)) await Task.Delay(TimeSpan.FromSeconds(4), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
        }
    }

    private async Task<bool> DeliverOneAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddHours(-24);
        await db.NotificationOutbox.Where(x => x.SentAt == null && x.Attempts < 6 && db.Notifications.Any(n => n.Id == x.NotificationId && n.CreatedAt < cutoff))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Attempts, 6).SetProperty(x => x.LeaseUntil, (DateTimeOffset?)null).SetProperty(x => x.LeaseToken, (Guid?)null), ct);
        await db.NotificationOutbox.Where(x => x.SentAt == null && x.Attempts >= 6 && x.LeaseUntil != null && x.LeaseUntil <= now)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.LeaseUntil, (DateTimeOffset?)null).SetProperty(x => x.LeaseToken, (Guid?)null), ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var row = await db.NotificationOutbox.FromSqlInterpolated($"SELECT TOP (1) * FROM [NotificationOutbox] WITH (UPDLOCK, READPAST, ROWLOCK) WHERE [SentAt] IS NULL AND [DueAt] <= {now} AND ([LeaseUntil] IS NULL OR [LeaseUntil] < {now}) AND [Attempts] < 6 AND EXISTS (SELECT 1 FROM [Notifications] n WHERE n.[Id] = [NotificationOutbox].[NotificationId] AND n.[CreatedAt] >= {cutoff}) ORDER BY [DueAt], [Id]").FirstOrDefaultAsync(ct);
        if (row is null) { await tx.RollbackAsync(ct); return false; }
        var leaseToken = Guid.NewGuid(); row.LeaseUntil = now.AddMinutes(2); row.LeaseToken = leaseToken; row.Attempts++; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        var device = await db.NotificationDevices.SingleOrDefaultAsync(x => x.Id == row.DeviceId, ct);
        var notification = await db.Notifications.SingleOrDefaultAsync(x => x.Id == row.NotificationId, ct);
        if (device is null || notification is null) { await db.NotificationOutbox.Where(x => x.Id == row.Id && x.LeaseToken == leaseToken && x.SentAt == null).ExecuteDeleteAsync(ct); return true; }
        if (!WithinPushWindow(notification, now))
        { await DeferAsync(db, row.Id, leaseToken, now, ct, terminal: true); return true; }
        if (notification.BookingId is Guid bookingId && notification.Kind != "Review")
        {
            var current = await db.Bookings.Where(x => x.Id == bookingId).Select(x => new { Status = x.Status.ToString(), x.StartAt }).SingleOrDefaultAsync(ct);
            if (!BookingEventIsCurrent(notification, current?.Status, current?.StartAt, now))
            { await DeferAsync(db, row.Id, leaseToken, now, ct, terminal: true); return true; }
        }
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(device.UserId.ToString());
        if (user is null || user.IsSuspended || user.SecurityStamp != device.SecurityStamp || device.ExpiresAt <= now || !Approved(device.Endpoint))
        { await DeleteDeviceIfUnchangedAsync(db, device, ct); await DeferAsync(db, row.Id, leaseToken, now, ct, terminal: true); return true; }
        try
        {
            var pub = configuration["Notifications:VapidPublicKey"]; var priv = configuration["Notifications:VapidPrivateKey"]; var subject = configuration["Notifications:VapidSubject"];
            if (string.IsNullOrWhiteSpace(pub) || string.IsNullOrWhiteSpace(priv) || string.IsNullOrWhiteSpace(subject)) { await DeferAsync(db, row.Id, leaseToken, now.AddMinutes(10), ct); return true; }
            await sender.SendAsync(device, notification, subject, pub, priv, ct);
            await db.NotificationOutbox.Where(x => x.Id == row.Id && x.LeaseToken == leaseToken && x.SentAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.SentAt, now).SetProperty(x => x.LeaseUntil, (DateTimeOffset?)null).SetProperty(x => x.LeaseToken, (Guid?)null), ct);
        }
        catch (PushServiceClientException ex) when ((int)ex.StatusCode is 404 or 410)
        { if (await db.NotificationOutbox.AnyAsync(x => x.Id == row.Id && x.LeaseToken == leaseToken, ct)) await DeleteDeviceIfUnchangedAsync(db, device, ct); }
        catch (PushServiceClientException ex) when ((int)ex.StatusCode is >= 300 and < 400)
        { await DeferAsync(db, row.Id, leaseToken, now, ct, terminal: true); }
        catch (PushServiceClientException ex) when ((int)ex.StatusCode is >= 400 and < 500 && (int)ex.StatusCode != 429)
        { await db.NotificationOutbox.Where(x => x.Id == row.Id && x.LeaseToken == leaseToken).ExecuteUpdateAsync(s => s.SetProperty(x => x.Attempts, 6).SetProperty(x => x.LeaseUntil, (DateTimeOffset?)null).SetProperty(x => x.LeaseToken, (Guid?)null), ct); }
        catch
        {
            logger.LogWarning("Push delivery failed; retry state was recorded.");
            if (row.Attempts >= 6) await DeferAsync(db, row.Id, leaseToken, now, ct, terminal: true);
            else await DeferAsync(db, row.Id, leaseToken, now.AddSeconds(Math.Min(3600, 15 * Math.Pow(2, row.Attempts - 1))), ct);
        }
        return true;
    }

    private static Task<int> DeleteDeviceIfUnchangedAsync(AppDbContext db, NotificationDevice device, CancellationToken ct) =>
        db.NotificationDevices.Where(x => x.Id == device.Id && x.UpdatedAt == device.UpdatedAt && x.SecurityStamp == device.SecurityStamp)
            .ExecuteDeleteAsync(ct);

    private bool PushConfigured() => !string.IsNullOrWhiteSpace(configuration["Notifications:VapidPublicKey"])
        && !string.IsNullOrWhiteSpace(configuration["Notifications:VapidPrivateKey"])
        && !string.IsNullOrWhiteSpace(configuration["Notifications:VapidSubject"]);

    public static bool WithinPushWindow(UserNotification notification, DateTimeOffset now) => notification.CreatedAt >= now.AddHours(-24) && notification.CreatedAt <= now.AddMinutes(5);
    public static bool BookingEventIsCurrent(UserNotification notification, string? currentStatus, DateTimeOffset? startAt, DateTimeOffset now) =>
        notification.Kind == "Review" || notification.BookingId is null || (currentStatus == notification.Kind && !(notification.Kind == "Requested" && startAt <= now));

    private static Task<int> DeferAsync(AppDbContext db, Guid id, Guid token, DateTimeOffset due, CancellationToken ct, bool terminal = false) =>
        db.NotificationOutbox.Where(x => x.Id == id && x.LeaseToken == token && x.SentAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.DueAt, due).SetProperty(x => x.LeaseUntil, (DateTimeOffset?)null).SetProperty(x => x.LeaseToken, (Guid?)null).SetProperty(x => x.Attempts, x => terminal ? 6 : x.Attempts), ct);

    private static bool Approved(string endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var u) || u.Scheme != "https" || u.UserInfo.Length > 0 || u.Port != 443) return false;
        var h = u.Host.ToLowerInvariant(); return h is "fcm.googleapis.com" or "updates.push.services.mozilla.com" or "web.push.apple.com" || h.EndsWith(".push.services.mozilla.com", StringComparison.Ordinal) || h.EndsWith(".notify.windows.com", StringComparison.Ordinal);
    }
}
