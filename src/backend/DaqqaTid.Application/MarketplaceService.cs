using System.Data;
using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace DaqqaTid.Application;

public sealed class BookingConcurrencyException(string message, Exception innerException) : Exception(message, innerException);

public sealed record CreateBookingRequest(Guid WorkerId, Guid CategoryId, BookingMode Mode, string Summary, string Description, string Address, string Locality, DateTimeOffset StartAt, int DurationMinutes, bool IsAsap, string IdempotencyKey);
public sealed record BookingActionRequest(string Action, decimal? Amount = null);
public interface IMarketplaceService
{
    Task<Booking> CreateBookingAsync(Guid customerId, CreateBookingRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Booking>> GetBookingsAsync(Guid actorId, string role, CancellationToken cancellationToken = default);
    Task<Booking> GetBookingAsync(Guid actorId, string role, Guid bookingId, CancellationToken cancellationToken = default);
    Task<Booking> ActAsync(Guid actorId, string role, Guid bookingId, BookingActionRequest request, CancellationToken cancellationToken = default);
    Task<Review> ReviewAsync(Guid actorId, Guid bookingId, int rating, string? comment, CancellationToken cancellationToken = default);
}

public interface ISimulatedPaymentLedger
{
    SimulatedPayment CreateCompletedBookingLedger(Booking booking, decimal commissionPercent);
}
public sealed class SimulatedPaymentLedger : ISimulatedPaymentLedger
{
    public SimulatedPayment CreateCompletedBookingLedger(Booking booking, decimal commissionPercent)
    {
        var amount = booking.Amount ?? throw new InvalidOperationException("Cannot settle an unpriced booking.");
        var commission = BookingRules.Commission(amount, commissionPercent);
        return new SimulatedPayment { BookingId = booking.Id, Amount = amount, CommissionAmount = commission, IsSimulated = true, Status = "Succeeded", CreatedAt = DateTimeOffset.UtcNow, LedgerEntries = [new PaymentLedgerEntry { Kind = PaymentLedgerKind.Gross, Amount = amount, CreatedAt = DateTimeOffset.UtcNow }, new PaymentLedgerEntry { Kind = PaymentLedgerKind.Commission, Amount = commission, CreatedAt = DateTimeOffset.UtcNow }] };
    }
}

public sealed class MarketplaceService(AppDbContext db, ISimulatedPaymentLedger paymentLedger, TimeProvider clock) : IMarketplaceService
{
    public async Task<Booking> CreateBookingAsync(Guid customerId, CreateBookingRequest r, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(r.IdempotencyKey) || r.IdempotencyKey.Length > 120) throw new ArgumentException("A valid idempotency key is required.");
        var fingerprint = RequestFingerprint(r);
        var existing = await db.Bookings.Include(x => x.History).SingleOrDefaultAsync(x => x.CustomerId == customerId && x.IdempotencyKey == r.IdempotencyKey, ct);
        if (existing is not null)
        {
            if (existing.RequestFingerprint != fingerprint)
                throw new InvalidOperationException("Idempotency key was already used for a different booking request.");
            return existing;
        }
        if (await db.Users.AnyAsync(x => x.Id == customerId && x.IsSuspended, ct)) throw new UnauthorizedAccessException("Account is suspended.");
        if (string.IsNullOrWhiteSpace(r.Summary) || string.IsNullOrWhiteSpace(r.Address) || string.IsNullOrWhiteSpace(r.Locality)) throw new ArgumentException("A summary, address, and locality are required.");
        var now = clock.GetUtcNow();
        var startAt = BookingRules.ResolveStartAt(r.StartAt, r.IsAsap, now);
        var end = BookingRules.EnsureValidInterval(startAt, r.DurationMinutes, now);
        await using var tx = await db.Database.BeginTransactionAsync(IsSqlServer() ? IsolationLevel.ReadCommitted : IsolationLevel.Serializable, ct);
        var worker = await db.Workers.Include(x => x.Offerings).ThenInclude(x => x.Modes).Include(x => x.Availability).Include(x => x.Exceptions).SingleOrDefaultAsync(x => x.Id == r.WorkerId, ct) ?? throw new KeyNotFoundException("Worker not found.");
        if (worker.VerificationStatus == VerificationStatus.Suspended || await db.Users.AnyAsync(x => x.Id == worker.UserId && x.IsSuspended, ct)) throw new InvalidOperationException("Worker is unavailable.");
        if (r.IsAsap && !worker.AvailableNow) throw new InvalidOperationException("Worker is not currently available.");
        if (IsSqlServer()) await LockWorkerRowAsync(worker.Id, ct);
        var category = await db.Categories.Include(x => x.Modes).SingleOrDefaultAsync(x => x.Id == r.CategoryId, ct) ?? throw new KeyNotFoundException("Category not found.");
        if (!category.IsActive || !category.Modes.Any(x => x.Mode == r.Mode)) throw new InvalidOperationException("Category is inactive or does not support this mode.");
        if (category.RequiresVerification && worker.VerificationStatus != VerificationStatus.Verified) throw new InvalidOperationException("This service requires a verified worker.");
        var offering = worker.Offerings.SingleOrDefault(x => x.CategoryId == r.CategoryId && x.Modes.Any(m => m.Mode == r.Mode)) ?? throw new InvalidOperationException("Worker does not offer this service and mode.");
        if (!WorkerMatching.IsAvailableAt(worker, startAt, end)) throw new InvalidOperationException("Worker is not available for the requested time.");
        var origin = await db.Localities.SingleOrDefaultAsync(x => x.Name == r.Locality, ct); var destination = await db.Localities.SingleOrDefaultAsync(x => x.Name == worker.Locality, ct);
        if (origin is null || destination is null) throw new InvalidOperationException("A supported locality is required.");
        var distance = WorkerMatching.DistanceKm(origin.Location.Y, origin.Location.X, destination.Location.Y, destination.Location.X);
        if (distance > worker.RadiusKm) throw new InvalidOperationException("Worker does not serve the requested locality.");
        var overlaps = await db.Bookings.AnyAsync(x => x.WorkerId == worker.Id && (x.Status == BookingStatus.WorkerAccepted || x.Status == BookingStatus.Confirmed || x.Status == BookingStatus.InProgress) && x.StartAt < end && startAt < x.EndAt, ct);
        if (overlaps) throw new InvalidOperationException("Worker is already booked for that time.");
        var price = BookingRules.Price(offering.PricingType, offering.Price ?? worker.HourlyRate, r.DurationMinutes);
        var booking = new Booking { CustomerId = customerId, WorkerId = worker.Id, CategoryId = r.CategoryId, Mode = r.Mode, Summary = r.Summary.Trim(), Description = r.Description.Trim(), Locality = r.Locality.Trim(), PrivateAddress = r.Address.Trim(), StartAt = startAt.ToUniversalTime(), EndAt = end, Status = BookingStatus.Requested, PricingType = offering.PricingType, Amount = offering.PricingType == PricingType.Quote ? null : price, IdempotencyKey = r.IdempotencyKey, RequestFingerprint = fingerprint };
        booking.History.Add(new BookingHistory { Status = BookingStatus.Requested, At = DateTimeOffset.UtcNow }); db.Bookings.Add(booking);
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateException) { await tx.RollbackAsync(ct); var prior = await db.Bookings.Include(x => x.History).SingleOrDefaultAsync(x => x.CustomerId == customerId && x.IdempotencyKey == r.IdempotencyKey, ct); if (prior is not null) { if (prior.RequestFingerprint != fingerprint) throw new InvalidOperationException("Idempotency key was already used for a different booking request."); return prior; } throw; }
        return booking;
    }
    public async Task<IReadOnlyList<Booking>> GetBookingsAsync(Guid actorId, string role, CancellationToken ct = default)
    {
        var q = db.Bookings.Include(x => x.History).AsQueryable(); if (role == RoleNames.Admin) return await q.OrderByDescending(x => x.StartAt).ToListAsync(ct);
        if (role == RoleNames.Worker) { var workerId = await db.Workers.Where(x => x.UserId == actorId).Select(x => (Guid?)x.Id).SingleOrDefaultAsync(ct) ?? throw new UnauthorizedAccessException(); return await q.Where(x => x.WorkerId == workerId).OrderByDescending(x => x.StartAt).ToListAsync(ct); }
        return await q.Where(x => x.CustomerId == actorId).OrderByDescending(x => x.StartAt).ToListAsync(ct);
    }
    public async Task<Booking> GetBookingAsync(Guid actorId, string role, Guid id, CancellationToken ct = default)
    { var b = await db.Bookings.Include(x => x.History).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new KeyNotFoundException(); await EnsureOwner(actorId, role, b, ct); return b; }
    public async Task<Booking> ActAsync(Guid actorId, string role, Guid id, BookingActionRequest r, CancellationToken ct = default)
    {
        var b = await db.Bookings.Include(x => x.History).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new KeyNotFoundException(); await EnsureOwner(actorId, role, b, ct);
        var workerAction = role == RoleNames.Worker && await db.Workers.AnyAsync(x => x.Id == b.WorkerId && x.UserId == actorId, ct); var customerAction = role == RoleNames.Customer && b.CustomerId == actorId;
        BookingStatus to = r.Action.ToLowerInvariant() switch
        {
            "accept" when workerAction => BookingStatus.WorkerAccepted,
            "decline" when workerAction => BookingStatus.Cancelled,
            "quote" when workerAction => BookingStatus.Quoted,
            "confirm" when customerAction => BookingStatus.Confirmed,
            "start" when workerAction => BookingStatus.InProgress,
            "complete" when workerAction => BookingStatus.Completed,
            "cancel" when customerAction || workerAction => BookingStatus.Cancelled,
            _ => throw new UnauthorizedAccessException("Action is not allowed.")
        };
        BookingRules.EnsureTransition(b.Status, to);
        if (r.Action.Equals("quote", StringComparison.OrdinalIgnoreCase)) { if (r.Amount is null or <= 0) throw new ArgumentException("A positive quote amount is required."); b.QuoteAmount = r.Amount; b.Amount = r.Amount; }
        if (to == BookingStatus.WorkerAccepted && b.PricingType == PricingType.Quote) throw new InvalidOperationException("Quote-priced requests must use the quote action.");
        if (to == BookingStatus.Confirmed)
        {
            if (b.PricingType == PricingType.Quote && b.QuoteAmount is null) throw new InvalidOperationException("Worker must provide a quote first.");
            if (b.Amount is null) throw new InvalidOperationException("Booking price is not set.");
            await using var tx = await db.Database.BeginTransactionAsync(IsSqlServer() ? IsolationLevel.ReadCommitted : IsolationLevel.Serializable, ct);
            if (IsSqlServer()) await LockWorkerRowAsync(b.WorkerId, ct);
            await EnsureBookingStillValidAsync(b, ct);
            if (await db.Bookings.AnyAsync(x => x.Id != b.Id && x.WorkerId == b.WorkerId && (x.Status == BookingStatus.WorkerAccepted || x.Status == BookingStatus.Confirmed || x.Status == BookingStatus.InProgress) && x.StartAt < b.EndAt && b.StartAt < x.EndAt, ct)) throw new InvalidOperationException("Worker is already booked for that time.");
            await SaveTransition(b, to, ct); await tx.CommitAsync(ct); return b;
        }
        if (to == BookingStatus.WorkerAccepted)
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsSqlServer() ? IsolationLevel.ReadCommitted : IsolationLevel.Serializable, ct);
            if (IsSqlServer()) await LockWorkerRowAsync(b.WorkerId, ct);
            await EnsureBookingStillValidAsync(b, ct);
            if (await db.Bookings.AnyAsync(x => x.Id != b.Id && x.WorkerId == b.WorkerId && (x.Status == BookingStatus.WorkerAccepted || x.Status == BookingStatus.Confirmed || x.Status == BookingStatus.InProgress) && x.StartAt < b.EndAt && b.StartAt < x.EndAt, ct)) throw new InvalidOperationException("Worker is already booked for that time.");
            await SaveTransition(b, to, ct); await tx.CommitAsync(ct); return b;
        }
        if (to == BookingStatus.Completed)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var settings = await db.Settings.SingleOrDefaultAsync(x => x.Id == 1, ct); var payment = paymentLedger.CreateCompletedBookingLedger(b, settings?.CommissionPercent ?? 12);
            b.CommissionAmount = payment.CommissionAmount; b.Status = to;
            AddHistory(b, to);
            db.Payments.Add(payment);
            try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException ex) { throw new BookingConcurrencyException("Booking changed while this action was being saved. Reload and retry.", ex); }
            await tx.CommitAsync(ct); return b;
        }
        await SaveTransition(b, to, ct);
        return b;
    }
    public async Task<Review> ReviewAsync(Guid actorId, Guid bookingId, int rating, string? comment, CancellationToken ct = default)
    { if (rating is < 1 or > 5) throw new ArgumentOutOfRangeException(nameof(rating)); var b = await db.Bookings.SingleOrDefaultAsync(x => x.Id == bookingId, ct) ?? throw new KeyNotFoundException(); if (b.CustomerId != actorId) throw new UnauthorizedAccessException(); if (b.Status != BookingStatus.Completed) throw new InvalidOperationException("Only completed bookings can be reviewed."); if (await db.Reviews.AnyAsync(x => x.BookingId == bookingId, ct)) throw new InvalidOperationException("Booking already reviewed."); var review = new Review { BookingId = b.Id, CustomerId = actorId, WorkerId = b.WorkerId, Rating = rating, Comment = (comment ?? "").Trim(), CreatedAt = DateTimeOffset.UtcNow }; db.Reviews.Add(review); await db.SaveChangesAsync(ct); return review; }
    private async Task EnsureOwner(Guid actor, string role, Booking b, CancellationToken ct) { if (role == RoleNames.Admin) return; if (role == RoleNames.Customer && b.CustomerId == actor) return; if (role == RoleNames.Worker && await db.Workers.AnyAsync(x => x.Id == b.WorkerId && x.UserId == actor, ct)) return; throw new UnauthorizedAccessException(); }
    private void AddHistory(Booking booking, BookingStatus status)
    {
        var entry = new BookingHistory { BookingId = booking.Id, Status = status, At = DateTimeOffset.UtcNow };
        // Existing bookings are loaded with their history collection. Explicitly mark the
        // new GUID-key row as Added instead of relying on graph state inference from Add().
        db.BookingHistory.Add(entry);
        booking.History.Add(entry);
    }
    private async Task SaveTransition(Booking b, BookingStatus to, CancellationToken ct) { b.Status = to; AddHistory(b, to); try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException ex) { throw new BookingConcurrencyException("Booking changed while this action was being saved. Reload and retry.", ex); } }
    private async Task EnsureBookingStillValidAsync(Booking b, CancellationToken ct)
    {
        if (b.StartAt <= clock.GetUtcNow()) throw new InvalidOperationException("Booking start time has passed.");
        if (await db.Users.AnyAsync(x => x.Id == b.CustomerId && x.IsSuspended, ct)) throw new UnauthorizedAccessException("Customer account is suspended.");
        var worker = await db.Workers.Include(x => x.Availability).Include(x => x.Exceptions).SingleOrDefaultAsync(x => x.Id == b.WorkerId, ct) ?? throw new KeyNotFoundException("Worker not found.");
        if (worker.VerificationStatus == VerificationStatus.Suspended || await db.Users.AnyAsync(x => x.Id == worker.UserId && x.IsSuspended, ct)) throw new InvalidOperationException("Worker is unavailable.");
        var category = await db.Categories.Include(x => x.Modes).SingleOrDefaultAsync(x => x.Id == b.CategoryId, ct) ?? throw new KeyNotFoundException("Category not found.");
        if (!category.IsActive || !category.Modes.Any(x => x.Mode == b.Mode) || (category.RequiresVerification && worker.VerificationStatus != VerificationStatus.Verified)) throw new InvalidOperationException("Category or worker is no longer eligible.");
        if (!WorkerMatching.IsAvailableAt(worker, b.StartAt, b.EndAt)) throw new InvalidOperationException("Worker is no longer available for that time.");
        var origin = await db.Localities.SingleOrDefaultAsync(x => x.Name == b.Locality, ct); var destination = await db.Localities.SingleOrDefaultAsync(x => x.Name == worker.Locality, ct);
        if (origin is null || destination is null || WorkerMatching.DistanceKm(origin.Location.Y, origin.Location.X, destination.Location.Y, destination.Location.X) > worker.RadiusKm) throw new InvalidOperationException("Worker no longer serves this locality.");
    }
    private bool IsSqlServer() => db.Database.ProviderName?.Contains("SqlServer", StringComparison.OrdinalIgnoreCase) == true;
    private static string RequestFingerprint(CreateBookingRequest r)
    {
        var value = string.Join("\n", r.WorkerId, r.CategoryId, r.Mode, r.Summary.Trim(), r.Description.Trim(), r.Address.Trim(), r.Locality.Trim(), r.StartAt.ToUniversalTime().ToString("O"), r.DurationMinutes, r.IsAsap);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    }
    private async Task LockWorkerRowAsync(Guid workerId, CancellationToken ct)
    { var connection = db.Database.GetDbConnection(); await using var command = connection.CreateCommand(); command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction(); command.CommandText = "SELECT [Id] FROM [Workers] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = @id"; var p = command.CreateParameter(); p.ParameterName = "@id"; p.Value = workerId; command.Parameters.Add(p); await command.ExecuteScalarAsync(ct); }
}
