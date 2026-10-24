using DaqqaTid.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace DaqqaTid.Infrastructure;

public static class RoleNames { public const string Customer = "Customer", Worker = "Worker", Admin = "Admin"; }
public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = ""; public string Locality { get; set; } = ""; public bool IsSuspended { get; set; }
    public WorkerProfile? WorkerProfile { get; set; }
}
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Category> Categories => Set<Category>(); public DbSet<CategoryMode> CategoryModes => Set<CategoryMode>();
    public DbSet<Locality> Localities => Set<Locality>();
    public DbSet<WorkerProfile> Workers => Set<WorkerProfile>(); public DbSet<Offering> Offerings => Set<Offering>(); public DbSet<OfferingMode> OfferingModes => Set<OfferingMode>();
    public DbSet<AvailabilityWindow> AvailabilityWindows => Set<AvailabilityWindow>(); public DbSet<AvailabilityException> AvailabilityExceptions => Set<AvailabilityException>();
    public DbSet<CustomerAddress> Addresses => Set<CustomerAddress>(); public DbSet<Booking> Bookings => Set<Booking>(); public DbSet<BookingHistory> BookingHistory => Set<BookingHistory>();
    public DbSet<SavedMedia> Media => Set<SavedMedia>();
    public DbSet<Review> Reviews => Set<Review>(); public DbSet<SimulatedPayment> Payments => Set<SimulatedPayment>(); public DbSet<PrivacyRequest> PrivacyRequests => Set<PrivacyRequest>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>(); public DbSet<AppSetting> Settings => Set<AppSetting>();
    public DbSet<UserNotification> Notifications => Set<UserNotification>();
    public DbSet<NotificationDevice> NotificationDevices => Set<NotificationDevice>();
    public DbSet<NotificationOutbox> NotificationOutbox => Set<NotificationOutbox>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.Entity<UserNotification>(e => { e.HasKey(x => x.Id); e.Property(x => x.Kind).HasMaxLength(32); e.Property(x => x.Title).HasMaxLength(120); e.Property(x => x.Message).HasMaxLength(300); e.Property(x => x.Url).HasMaxLength(200); e.Property(x => x.SourceType).HasMaxLength(32); e.HasIndex(x => new { x.SourceType, x.SourceId, x.RecipientId }).IsUnique(); e.HasIndex(x => new { x.RecipientId, x.ReadAt, x.CreatedAt }); e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RecipientId).OnDelete(DeleteBehavior.Cascade); });
        b.Entity<NotificationDevice>(e => { e.HasKey(x => x.Id); e.Property(x => x.DeviceTokenHash).HasMaxLength(64); e.Property(x => x.Endpoint).HasMaxLength(2048); e.Property(x => x.EndpointHash).HasMaxLength(64); e.Property(x => x.P256dh).HasMaxLength(200); e.Property(x => x.Auth).HasMaxLength(100); e.Property(x => x.SecurityStamp).HasMaxLength(128); e.HasIndex(x => x.DeviceTokenHash).IsUnique(); e.HasIndex(x => x.EndpointHash).IsUnique(); e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade); });
        b.Entity<NotificationOutbox>(e => { e.HasKey(x => x.Id); e.Property(x => x.LeaseToken); e.HasIndex(x => new { x.DueAt, x.LeaseUntil, x.SentAt }); e.HasIndex(x => new { x.NotificationId, x.DeviceId }).IsUnique(); });
        b.Entity<Category>().HasIndex(x => x.Slug).IsUnique(); b.Entity<Category>().Property(x => x.Slug).HasMaxLength(100);
        b.Entity<Locality>().HasKey(x => x.Name); b.Entity<Locality>().Property(x => x.Name).HasMaxLength(100); b.Entity<Locality>().Property(x => x.Location).HasColumnType("geography");
        b.Entity<CategoryMode>().HasKey(x => new { x.CategoryId, x.Mode }); b.Entity<CategoryMode>().HasOne<Category>().WithMany(x => x.Modes).HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<WorkerProfile>().HasIndex(x => x.UserId).IsUnique(); b.Entity<WorkerProfile>().HasOne<ApplicationUser>().WithOne(x => x.WorkerProfile).HasForeignKey<WorkerProfile>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<WorkerProfile>().Property(x => x.HourlyRate).HasPrecision(10, 2); b.Entity<WorkerProfile>().Property(x => x.RowVersion).IsRowVersion();
        b.Entity<Offering>().HasOne<WorkerProfile>().WithMany(x => x.Offerings).HasForeignKey(x => x.WorkerId).OnDelete(DeleteBehavior.Cascade); b.Entity<Offering>().HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict); b.Entity<Offering>().HasIndex(x => new { x.WorkerId, x.CategoryId }).IsUnique(); b.Entity<Offering>().Property(x => x.Price).HasPrecision(10, 2);
        b.Entity<OfferingMode>().HasKey(x => new { x.OfferingId, x.Mode }); b.Entity<OfferingMode>().HasOne<Offering>().WithMany(x => x.Modes).HasForeignKey(x => x.OfferingId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<AvailabilityWindow>().HasOne<WorkerProfile>().WithMany(x => x.Availability).HasForeignKey(x => x.WorkerId).OnDelete(DeleteBehavior.Cascade); b.Entity<AvailabilityWindow>().HasIndex(x => new { x.WorkerId, x.DayOfWeek }); b.Entity<AvailabilityException>().HasOne<WorkerProfile>().WithMany(x => x.Exceptions).HasForeignKey(x => x.WorkerId).OnDelete(DeleteBehavior.Cascade); b.Entity<AvailabilityException>().HasIndex(x => new { x.WorkerId, x.Date }).IsUnique();
        b.Entity<CustomerAddress>().HasIndex(x => x.UserId); b.Entity<CustomerAddress>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PrivacyRequest>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<SavedMedia>().HasIndex(x => new { x.OwnerId, x.BookingId }); b.Entity<SavedMedia>().Property(x => x.Purpose).HasMaxLength(40); b.Entity<SavedMedia>().Property(x => x.ContentType).HasMaxLength(120); b.Entity<SavedMedia>().Property(x => x.StorageKey).HasMaxLength(500); b.Entity<SavedMedia>().Property(x => x.OriginalName).HasMaxLength(260); b.Entity<SavedMedia>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade); b.Entity<SavedMedia>().HasOne<Booking>().WithMany().HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<AuditEntry>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<Booking>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Booking>().HasOne<WorkerProfile>().WithMany().HasForeignKey(x => x.WorkerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Booking>().HasOne<Category>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Booking>().HasIndex(x => new { x.CustomerId, x.IdempotencyKey }).IsUnique(); b.Entity<Booking>().HasIndex(x => new { x.WorkerId, x.StartAt, x.EndAt, x.Status });
        b.Entity<Booking>().Property(x => x.Amount).HasPrecision(10, 2); b.Entity<Booking>().Property(x => x.CommissionAmount).HasPrecision(10, 2); b.Entity<Booking>().Property(x => x.QuoteAmount).HasPrecision(10, 2);
        b.Entity<Booking>().Property(x => x.IdempotencyKey).HasMaxLength(120); b.Entity<Booking>().Property(x => x.RequestFingerprint).HasMaxLength(64); b.Entity<Booking>().Property(x => x.RowVersion).IsRowVersion(); b.Entity<BookingHistory>().HasIndex(x => new { x.BookingId, x.At });
        b.Entity<BookingHistory>().HasOne<Booking>().WithMany(x => x.History).HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Review>().HasOne<WorkerProfile>().WithMany(x => x.Reviews).HasForeignKey(x => x.WorkerId).OnDelete(DeleteBehavior.Cascade); b.Entity<Review>().HasOne<Booking>().WithOne().HasForeignKey<Review>(x => x.BookingId).OnDelete(DeleteBehavior.Restrict); b.Entity<Review>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict); b.Entity<Review>().HasIndex(x => x.BookingId).IsUnique(); b.Entity<Review>().HasIndex(x => x.WorkerId);
        b.Entity<SimulatedPayment>().HasOne<Booking>().WithOne().HasForeignKey<SimulatedPayment>(x => x.BookingId).OnDelete(DeleteBehavior.Restrict); b.Entity<SimulatedPayment>().HasIndex(x => x.BookingId).IsUnique(); b.Entity<SimulatedPayment>().Property(x => x.Amount).HasPrecision(10, 2); b.Entity<SimulatedPayment>().Property(x => x.CommissionAmount).HasPrecision(10, 2);
        b.Entity<PaymentLedgerEntry>().HasOne<SimulatedPayment>().WithMany(x => x.LedgerEntries).HasForeignKey(x => x.PaymentId).OnDelete(DeleteBehavior.Cascade); b.Entity<PaymentLedgerEntry>().HasIndex(x => new { x.PaymentId, x.Kind }).IsUnique(); b.Entity<PaymentLedgerEntry>().Property(x => x.Amount).HasPrecision(10, 2);
        b.Entity<AppSetting>().HasKey(x => x.Id); b.Entity<AppSetting>().Property(x => x.Id).ValueGeneratedNever(); b.Entity<AppSetting>().Property(x => x.CommissionPercent).HasPrecision(5, 2);
    }
}
