using DaqqaTid.Domain;
using DaqqaTid.Application;
using Xunit;

namespace DaqqaTid.UnitTests;

public sealed class BookingRulesTests
{
    [Theory]
    [InlineData(BookingStatus.Requested, BookingStatus.Quoted, true)]
    [InlineData(BookingStatus.Quoted, BookingStatus.Confirmed, true)]
    [InlineData(BookingStatus.Completed, BookingStatus.Confirmed, false)]
    [InlineData(BookingStatus.InProgress, BookingStatus.Cancelled, false)]
    public void Transitions_are_centralized(BookingStatus from, BookingStatus to, bool expected) => Assert.Equal(expected, BookingRules.CanTransition(from, to));
    [Fact] public void Intervals_treat_touching_edges_as_non_overlapping() { Assert.False(BookingRules.Overlaps(DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch.AddHours(1), DateTimeOffset.UnixEpoch.AddHours(1), DateTimeOffset.UnixEpoch.AddHours(2))); }
    [Fact] public void Hourly_pricing_rounds_to_cents() { Assert.Equal(37.50m, BookingRules.Price(PricingType.Hourly, 25m, 90)); }
    [Fact] public void Quote_pricing_stays_unset_until_worker_quotes() { Assert.Null(BookingRules.Price(PricingType.Quote, 100m, 60)); }
    [Fact] public void Commission_is_decimal_and_rounded() { Assert.Equal(1.23m, BookingRules.Commission(10.25m, 12)); }
    [Fact]
    public void Matching_uses_geographic_radius_category_mode_and_availability()
    {
        var category = Guid.NewGuid(); var mode = BookingMode.ForMe; var close = Guid.NewGuid(); var far = Guid.NewGuid();
        var rows = new[] { new WorkerCandidate(close, "Sliema", 10, true, new HashSet<Guid> { category }, new HashSet<BookingMode> { mode }, 25), new WorkerCandidate(far, "Gozo", 10, true, new HashSet<Guid> { category }, new HashSet<BookingMode> { mode }, 20) };
        var places = new Dictionary<string, (double, double)> { { "Valletta", (35.8992, 14.5141) }, { "Sliema", (35.9122, 14.5019) }, { "Gozo", (36.0444, 14.2512) } };
        var result = WorkerMatching.Match(rows, category, mode, "Valletta", places, x => x, availableNow: true, maxPrice: 30);
        Assert.Single(result); Assert.Equal(close, result[0].WorkerId);
    }
    [Fact]
    public void Availability_windows_use_Malta_local_time()
    {
        var worker = new WorkerProfile { Availability = [new AvailabilityWindow { DayOfWeek = DayOfWeek.Tuesday, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(10, 0) }] };
        var start = new DateTimeOffset(2026, 10, 20, 6, 30, 0, TimeSpan.Zero); // 08:30 in Malta (UTC+2)
        Assert.True(WorkerMatching.IsAvailableAt(worker, start, start.AddMinutes(45)));
        Assert.False(WorkerMatching.IsAvailableAt(worker, start.AddHours(-1), start.AddMinutes(-15)));
    }
    [Fact]
    public void Availability_exception_can_close_an_open_weekly_window()
    {
        var worker = new WorkerProfile { Availability = [new AvailabilityWindow { DayOfWeek = DayOfWeek.Tuesday, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(17, 0) }], Exceptions = [new AvailabilityException { Date = new DateOnly(2026, 10, 20), IsAvailable = false }] };
        var start = new DateTimeOffset(2026, 10, 20, 7, 0, 0, TimeSpan.Zero);
        Assert.False(WorkerMatching.IsAvailableAt(worker, start, start.AddHours(1)));
    }
    [Fact]
    public void Booking_time_windows_crossing_local_midnight_are_rejected()
    {
        var worker = new WorkerProfile { Availability = [new AvailabilityWindow { DayOfWeek = DayOfWeek.Tuesday, StartTime = new TimeOnly(23, 0), EndTime = new TimeOnly(23, 59) }] };
        var start = new DateTimeOffset(2026, 10, 20, 21, 30, 0, TimeSpan.Zero);
        Assert.False(WorkerMatching.IsAvailableAt(worker, start, start.AddHours(1)));
    }
}
