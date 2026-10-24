namespace DaqqaTid.Infrastructure;

public sealed class UserNotification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipientId { get; set; }
    public Guid? BookingId { get; set; }
    public string SourceType { get; set; } = "";
    public Guid SourceId { get; set; }
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public string Url { get; set; } = "/dashboard";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
}

public sealed class NotificationDevice
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string DeviceTokenHash { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string EndpointHash { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public string SecurityStamp { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class NotificationOutbox
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid NotificationId { get; set; }
    public Guid DeviceId { get; set; }
    public DateTimeOffset DueAt { get; set; }
    public DateTimeOffset? LeaseUntil { get; set; }
    public Guid? LeaseToken { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset? SentAt { get; set; }
}
