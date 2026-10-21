namespace DaqqaTid.Domain;

using NetTopologySuite.Geometries;

public enum UserRole { Customer, Worker, Admin }
public enum BookingMode { ForMe, WithMe, TeachMe }
public enum PricingType { Hourly, Fixed, Quote }
public enum VerificationStatus { Unverified, Pending, Verified, Rejected, Suspended }
public enum BookingStatus { Requested, Quoted, WorkerAccepted, Confirmed, InProgress, Completed, Cancelled, Expired }

public sealed class Category
{
    public Guid Id { get; set; } = Guid.NewGuid(); public string Slug { get; set; } = ""; public string Name { get; set; } = "";
    public string Description { get; set; } = ""; public string Icon { get; set; } = ""; public bool RequiresVerification { get; set; }
    public bool IsActive { get; set; } = true; public List<CategoryMode> Modes { get; set; } = [];
}
public sealed class CategoryMode { public Guid CategoryId { get; set; } public BookingMode Mode { get; set; } }
public sealed class Locality { public string Name { get; set; } = ""; public Point Location { get; set; } = new Point(0, 0) { SRID = 4326 }; }
public sealed class WorkerProfile
{
    public Guid Id { get; set; } = Guid.NewGuid(); public Guid UserId { get; set; }
    public string DisplayName { get; set; } = ""; public string Bio { get; set; } = "";
    public string Locality { get; set; } = ""; public int YearsExperience { get; set; }
    public double RadiusKm { get; set; } = 10;
    public decimal HourlyRate { get; set; }
    public PricingType PricingType { get; set; }
    public VerificationStatus VerificationStatus { get; set; }
    public string? VerificationReference { get; set; }
    public string? VerificationNotes { get; set; }
    public bool AvailableNow { get; set; }
    public DateTimeOffset AvailabilityUpdatedAt { get; set; }
    public bool IsDemo { get; set; }
    public byte[] RowVersion { get; set; } = []; public List<Offering> Offerings { get; set; } = []; public List<Review> Reviews { get; set; } = [];
    public List<AvailabilityWindow> Availability { get; set; } = []; public List<AvailabilityException> Exceptions { get; set; } = [];
}
public sealed class Offering { public Guid Id { get; set; } = Guid.NewGuid(); public Guid WorkerId { get; set; } public Guid CategoryId { get; set; } public Category? Category { get; set; } public PricingType PricingType { get; set; } public decimal? Price { get; set; } public List<OfferingMode> Modes { get; set; } = []; }
public sealed class OfferingMode { public Guid OfferingId { get; set; } public BookingMode Mode { get; set; } }
public sealed class AvailabilityWindow { public Guid Id { get; set; } = Guid.NewGuid(); public Guid WorkerId { get; set; } public DayOfWeek DayOfWeek { get; set; } public TimeOnly StartTime { get; set; } public TimeOnly EndTime { get; set; } }
public sealed class AvailabilityException { public Guid Id { get; set; } = Guid.NewGuid(); public Guid WorkerId { get; set; } public DateOnly Date { get; set; } public bool IsAvailable { get; set; } }
public sealed class CustomerAddress { public Guid Id { get; set; } = Guid.NewGuid(); public Guid UserId { get; set; } public string Label { get; set; } = ""; public string Address { get; set; } = ""; public string Locality { get; set; } = ""; }
public sealed class SavedMedia { public Guid Id { get; set; } = Guid.NewGuid(); public Guid OwnerId { get; set; } public string Purpose { get; set; } = ""; public Guid? BookingId { get; set; } public string ContentType { get; set; } = ""; public string StorageKey { get; set; } = ""; public string? OriginalName { get; set; } public DateTimeOffset CreatedAt { get; set; } public long Size { get; set; } }
public sealed class Booking
{
    public Guid Id { get; set; } = Guid.NewGuid(); public Guid CustomerId { get; set; }
    public Guid WorkerId { get; set; }
    public Guid CategoryId { get; set; }
    public BookingMode Mode { get; set; }
    public string Summary { get; set; } = "";
    public string Description { get; set; } = ""; public string Locality { get; set; } = ""; public string PrivateAddress { get; set; } = "";
    public DateTimeOffset StartAt { get; set; }
    public DateTimeOffset EndAt { get; set; }
    public BookingStatus Status { get; set; } = BookingStatus.Requested;
    public PricingType PricingType { get; set; }
    public decimal? Amount { get; set; }
    public decimal? CommissionAmount { get; set; }
    public decimal? QuoteAmount { get; set; }
    public string IdempotencyKey { get; set; } = ""; public string RequestFingerprint { get; set; } = ""; public bool IsSimulated { get; set; } = true; public byte[] RowVersion { get; set; } = [];
    public List<BookingHistory> History { get; set; } = [];
}
public sealed class BookingHistory { public Guid Id { get; set; } = Guid.NewGuid(); public Guid BookingId { get; set; } public BookingStatus Status { get; set; } public DateTimeOffset At { get; set; } }
public sealed class Review { public Guid Id { get; set; } = Guid.NewGuid(); public Guid BookingId { get; set; } public Guid CustomerId { get; set; } public Guid WorkerId { get; set; } public int Rating { get; set; } public string Comment { get; set; } = ""; public DateTimeOffset CreatedAt { get; set; } }
public sealed class SimulatedPayment { public Guid Id { get; set; } = Guid.NewGuid(); public Guid BookingId { get; set; } public decimal Amount { get; set; } public decimal CommissionAmount { get; set; } public bool IsSimulated { get; set; } = true; public string Status { get; set; } = "Succeeded"; public DateTimeOffset CreatedAt { get; set; } public List<PaymentLedgerEntry> LedgerEntries { get; set; } = []; }
public enum PaymentLedgerKind { Gross, Commission }
public sealed class PaymentLedgerEntry { public Guid Id { get; set; } = Guid.NewGuid(); public Guid PaymentId { get; set; } public PaymentLedgerKind Kind { get; set; } public decimal Amount { get; set; } public DateTimeOffset CreatedAt { get; set; } }
public sealed class PrivacyRequest { public Guid Id { get; set; } = Guid.NewGuid(); public Guid UserId { get; set; } public string Kind { get; set; } = ""; public DateTimeOffset CreatedAt { get; set; } public string Status { get; set; } = "Open"; }
public sealed class AuditEntry { public Guid Id { get; set; } = Guid.NewGuid(); public string Action { get; set; } = ""; public Guid? ActorId { get; set; } public DateTimeOffset CreatedAt { get; set; } public string Details { get; set; } = ""; }
public sealed class AppSetting { public int Id { get; set; } = 1; public decimal CommissionPercent { get; set; } = 12; }

public static class BookingRules
{
    private static readonly IReadOnlyDictionary<BookingStatus, BookingStatus[]> Transitions = new Dictionary<BookingStatus, BookingStatus[]>
    {
        [BookingStatus.Requested] = [BookingStatus.Quoted, BookingStatus.WorkerAccepted, BookingStatus.Cancelled, BookingStatus.Expired],
        [BookingStatus.Quoted] = [BookingStatus.Confirmed, BookingStatus.Cancelled, BookingStatus.Expired],
        [BookingStatus.WorkerAccepted] = [BookingStatus.Confirmed, BookingStatus.Cancelled, BookingStatus.Expired],
        [BookingStatus.Confirmed] = [BookingStatus.InProgress, BookingStatus.Cancelled],
        [BookingStatus.InProgress] = [BookingStatus.Completed],
        [BookingStatus.Completed] = [],
        [BookingStatus.Cancelled] = [],
        [BookingStatus.Expired] = []
    };
    public static bool CanTransition(BookingStatus from, BookingStatus to) => Transitions[from].Contains(to);
    public static void EnsureTransition(BookingStatus from, BookingStatus to) { if (!CanTransition(from, to)) throw new InvalidOperationException($"Cannot move a booking from {from} to {to}."); }
    public static DateTimeOffset ResolveStartAt(DateTimeOffset requested, bool isAsap, DateTimeOffset now)
    {
        if (!isAsap) return requested.ToUniversalTime();
        if (requested > now.AddMinutes(15)) throw new ArgumentException("ASAP requests cannot specify a future scheduled time. Choose a scheduled request instead.");
        return now.ToUniversalTime().AddMinutes(5);
    }
    public static DateTimeOffset EnsureValidInterval(DateTimeOffset start, int durationMinutes, DateTimeOffset? now = null)
    { if (start.Offset != TimeSpan.Zero) start = start.ToUniversalTime(); if (durationMinutes is < 15 or > 720) throw new ArgumentOutOfRangeException(nameof(durationMinutes)); if (start <= (now ?? DateTimeOffset.UtcNow).AddMinutes(-5)) throw new ArgumentException("Booking must start in the future."); return start.AddMinutes(durationMinutes); }
    public static bool Overlaps(DateTimeOffset aStart, DateTimeOffset aEnd, DateTimeOffset bStart, DateTimeOffset bEnd) => aStart < bEnd && bStart < aEnd;
    public static decimal? Price(PricingType type, decimal? rate, int durationMinutes, decimal? fixedPrice = null) => type switch
    { PricingType.Hourly when rate is not null => decimal.Round(rate.Value * durationMinutes / 60m, 2, MidpointRounding.AwayFromZero), PricingType.Fixed => fixedPrice ?? rate, _ => null };
    public static decimal Commission(decimal amount, decimal percent) { if (amount < 0 || percent is < 0 or > 100) throw new ArgumentOutOfRangeException(); return decimal.Round(amount * percent / 100m, 2, MidpointRounding.AwayFromZero); }
}
