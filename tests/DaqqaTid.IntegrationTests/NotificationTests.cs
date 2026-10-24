using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;
using DaqqaTid.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace DaqqaTid.IntegrationTests;

public sealed class NotificationTests : IAsyncLifetime
{
    private readonly SqlApiFactory factory = new();
    public async Task InitializeAsync() => await factory.InitializeDatabaseAsync();
    public async Task DisposeAsync() => await factory.DisposeAsync();

    [Fact]
    public async Task Inbox_is_scoped_to_recipient_and_read_is_csrf_protected()
    {
        using var owner = await ApiTestActors.Register(factory, "Customer");
        using var other = await ApiTestActors.Register(factory, "Customer");
        var session = await owner.GetFromJsonAsync<JsonElement>("/api/session");
        var ownerId = session.GetProperty("user").GetProperty("id").GetGuid();
        var notification = new UserNotification { RecipientId = ownerId, SourceType = "TestSeed", SourceId = Guid.NewGuid(), Kind = "Test", Title = "Unit notification", Message = "private to owner", Url = "/dashboard", CreatedAt = DateTimeOffset.UtcNow };
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); db.Notifications.Add(notification); await db.SaveChangesAsync(); }
        var inbox = await owner.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.Contains(inbox.GetProperty("items").EnumerateArray(), x => x.GetProperty("id").GetGuid() == notification.Id);
        Assert.DoesNotContain((await other.GetFromJsonAsync<JsonElement>("/api/notifications")).GetProperty("items").EnumerateArray(), x => x.GetProperty("id").GetGuid() == notification.Id);
        owner.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/api/notifications/{notification.Id}/read", new { })).StatusCode);
        await ApiTestActors.RefreshCsrf(owner);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsJsonAsync($"/api/notifications/{notification.Id}/read", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync($"/api/notifications/{notification.Id}/read", new { })).StatusCode);
    }

    [Fact]
    public async Task Push_subscription_rejects_unapproved_hosts_and_bad_keys()
    {
        using var client = await ApiTestActors.Register(factory, "Customer");
        var response = await client.PostAsJsonAsync("/api/notifications/push-subscriptions", new { endpoint = "https://127.0.0.1/private", keys = new { p256dh = "AAAA", auth = "AAAA" } });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var oversized = await client.PostAsJsonAsync("/api/notifications/push-subscriptions", new { endpoint = "https://fcm.googleapis.com/" + new string('a', 2100), keys = new { p256dh = "AAAA", auth = "AAAA" } });
        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
        var invalidPoint = new byte[65]; invalidPoint[0] = 4;
        static string B64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var malformedCurve = await client.PostAsJsonAsync("/api/notifications/push-subscriptions", new { endpoint = "https://fcm.googleapis.com/fcm/send/invalid", keys = new { p256dh = B64Url(invalidPoint), auth = B64Url(new byte[16]) } });
        Assert.Equal(HttpStatusCode.BadRequest, malformedCurve.StatusCode);
    }

    [Fact]
    public async Task Logout_revokes_the_device_cookie_subscription()
    {
        using var client = await ApiTestActors.Register(factory, "Customer");
        await client.GetAsync("/api/notifications/push-config");
        using var ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256); var q = ecdh.ExportParameters(false).Q; var publicKey = new byte[65]; publicKey[0] = 4; q.X!.CopyTo(publicKey, 1); q.Y!.CopyTo(publicKey, 33);
        var auth = new byte[16]; Random.Shared.NextBytes(auth);
        static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var endpoint = $"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}";
        var subscribe = await client.PostAsJsonAsync("/api/notifications/push-subscriptions", new { endpoint, keys = new { p256dh = B64(publicKey), auth = B64(auth) } });
        Assert.Equal(HttpStatusCode.NoContent, subscribe.StatusCode);
        var userId = (await client.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").GetProperty("id").GetGuid();
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); Assert.Equal(1, await db.NotificationDevices.CountAsync(x => x.UserId == userId)); }
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/auth/logout", new { })).StatusCode);
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); Assert.Equal(0, await db.NotificationDevices.CountAsync(x => x.UserId == userId)); }
    }
}
