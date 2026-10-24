using System.Net;
using System.Security.Cryptography;
using DaqqaTid.Api;
using DaqqaTid.Infrastructure;
using Lib.Net.Http.WebPush;
using Xunit;

namespace DaqqaTid.IntegrationTests;

public sealed class NotificationPushSenderTests
{
    [Theory]
    [InlineData(HttpStatusCode.Created, false)]
    [InlineData(HttpStatusCode.Gone, true)]
    [InlineData(HttpStatusCode.TooManyRequests, true)]
    [InlineData(HttpStatusCode.Redirect, true)]
    public async Task Sender_uses_fake_provider_and_preserves_provider_status(HttpStatusCode status, bool shouldThrow)
    {
        using var appKey = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var parameters = appKey.ExportParameters(true);
        static string B64(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var publicKey = new byte[65]; publicKey[0] = 4; parameters.Q.X!.CopyTo(publicKey, 1); parameters.Q.Y!.CopyTo(publicKey, 33);
        using var userKey = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var userParameters = userKey.ExportParameters(true); var p256dh = new byte[65]; p256dh[0] = 4; userParameters.Q.X!.CopyTo(p256dh, 1); userParameters.Q.Y!.CopyTo(p256dh, 33);
        var auth = RandomNumberGenerator.GetBytes(16);
        var handler = new FakeHandler(status);
        var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
        var sender = new NotificationPushSender(new PushServiceClient(http));
        var device = new NotificationDevice { Endpoint = "https://fcm.googleapis.com/fcm/send/unit", P256dh = B64(p256dh), Auth = B64(auth) };
        var notification = new UserNotification { Title = "Booking update", Message = "A booking changed.", Url = "/dashboard" };
        if (shouldThrow)
        {
            var error = await Assert.ThrowsAsync<PushServiceClientException>(() => sender.SendAsync(device, notification, "mailto:test@example.test", B64(publicKey), B64(parameters.D!), CancellationToken.None));
            Assert.Equal(status, error.StatusCode);
        }
        else await sender.SendAsync(device, notification, "mailto:test@example.test", B64(publicKey), B64(parameters.D!), CancellationToken.None);
        Assert.Equal(1, handler.Requests);
    }

    [Fact]
    public void Old_and_superseded_booking_events_are_not_deliverable()
    {
        var now = DateTimeOffset.UtcNow;
        var old = new UserNotification { CreatedAt = now.AddHours(-25), Kind = "Requested", BookingId = Guid.NewGuid() };
        Assert.False(NotificationDeliveryWorker.WithinPushWindow(old, now));
        var recent = new UserNotification { CreatedAt = now, Kind = "Requested", BookingId = Guid.NewGuid() };
        Assert.True(NotificationDeliveryWorker.WithinPushWindow(recent, now));
        Assert.False(NotificationDeliveryWorker.BookingEventIsCurrent(recent, "Cancelled", now.AddHours(1), now));
        Assert.False(NotificationDeliveryWorker.BookingEventIsCurrent(recent, "Requested", now.AddMinutes(-1), now));
        Assert.True(NotificationDeliveryWorker.BookingEventIsCurrent(recent, "Requested", now.AddMinutes(1), now));
    }

    private sealed class FakeHandler(HttpStatusCode status) : HttpMessageHandler
    {
        public int Requests { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        { Requests++; return Task.FromResult(new HttpResponseMessage(status)); }
    }
}
