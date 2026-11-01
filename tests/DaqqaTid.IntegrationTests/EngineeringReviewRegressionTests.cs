using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using static DaqqaTid.IntegrationTests.ApiTestActors;

namespace DaqqaTid.IntegrationTests;

public sealed class EngineeringReviewRegressionTests : IAsyncLifetime
{
    // Fixed near-now keeps ASAP tests deterministic, including around Malta midnight/DST.
    private static readonly DateTimeOffset Now = new(DateTime.UtcNow.Date.AddDays(1).AddHours(10), TimeSpan.Zero);
    private readonly SqlApiFactory factory = new(new FixedClock(Now));

    public Task InitializeAsync() => factory.InitializeDatabaseAsync();
    public async Task DisposeAsync() => await factory.DisposeAsync();

    [Fact]
    public async Task Worker_hours_round_trip_as_numeric_weekdays_and_minute_times_for_the_shared_setup_form()
    {
        using var worker = await Register(factory, RoleNames.Worker);
        var (workerId, _) = await ConfigureWorker(worker);
        await JsonOk(await worker.PutAsJsonAsync("/api/worker/availability", new
        {
            availableNow = false,
            windows = new[] { new { dayOfWeek = 1, startTime = "09:00", endTime = "17:00" } },
            exceptions = Array.Empty<object>()
        }));
        var ownProfile = await worker.GetFromJsonAsync<JsonElement>("/api/worker/profile");
        var ownHours = ownProfile.GetProperty("availability").EnumerateArray().Single();
        Assert.Equal(JsonValueKind.Number, ownHours.GetProperty("dayOfWeek").ValueKind);
        Assert.Equal(1, ownHours.GetProperty("dayOfWeek").GetInt32());
        Assert.Equal("09:00", ownHours.GetProperty("startTime").GetString());
        Assert.Equal("17:00", ownHours.GetProperty("endTime").GetString());
        var publicProfile = await worker.GetFromJsonAsync<JsonElement>($"/api/workers/{workerId}");
        Assert.Equal(ownHours.GetRawText(), publicProfile.GetProperty("availability").EnumerateArray().Single().GetRawText());
        await JsonOk(await worker.PutAsJsonAsync("/api/worker/availability", new
        {
            availableNow = false,
            windows = ownProfile.GetProperty("availability"),
            exceptions = Array.Empty<object>()
        }));
        var reloaded = await worker.GetFromJsonAsync<JsonElement>("/api/worker/profile");
        Assert.Equal(1, reloaded.GetProperty("availability").EnumerateArray().Single().GetProperty("dayOfWeek").GetInt32());
    }

    [Fact]
    public async Task Verification_resubmission_preserves_approval_and_cannot_clear_admin_suspension()
    {
        using var customer = await Register(factory, RoleNames.Customer);
        using var worker = await Register(factory, RoleNames.Worker);
        using var admin = await Admin(factory);
        var (workerId, categoryId) = await ConfigureWorker(worker, includePlumbing: true);
        await JsonOk(await admin.PostAsJsonAsync($"/api/admin/workers/{workerId}/verification", new { status = "Verified" }));
        var resubmission = await JsonOk(await worker.PostAsJsonAsync("/api/worker/verification", new { reference = "Updated reference", notes = "Additional material" }));
        Assert.Equal("Verified", resubmission.GetProperty("verificationStatus").GetString());
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var plumbing = await db.Categories.Where(x => x.Slug == "plumbing").Select(x => x.Id).SingleAsync();
            Assert.Contains((await customer.GetFromJsonAsync<JsonElement>($"/api/workers?categoryId={plumbing}")).EnumerateArray(), x => x.GetProperty("id").GetGuid() == workerId);
        }
        await JsonOk(await admin.PostAsJsonAsync($"/api/admin/workers/{workerId}/verification", new { status = "Suspended" }));
        var denied = await worker.PostAsJsonAsync("/api/worker/verification", new { reference = "Try to bypass suspension", notes = "New material" });
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.DoesNotContain((await customer.GetFromJsonAsync<JsonElement>("/api/workers")).EnumerateArray(), x => x.GetProperty("id").GetGuid() == workerId);
        Assert.Equal(HttpStatusCode.Conflict, (await Request(customer, workerId, categoryId, Now.AddHours(1), false)).StatusCode);
        using var verificationScope = factory.Services.CreateScope();
        var database = verificationScope.ServiceProvider.GetRequiredService<AppDbContext>();
        var persisted = await database.Workers.AsNoTracking().SingleAsync(x => x.Id == workerId);
        Assert.Equal(VerificationStatus.Suspended, persisted.VerificationStatus);
        Assert.Equal("Updated reference", persisted.VerificationReference);
        Assert.Single(await database.AuditEntries.Where(x => x.Action == "worker.verification.submitted" && x.Details == workerId.ToString()).ToListAsync());
    }

    [Fact]
    public async Task Future_ASAP_is_rejected_and_valid_ASAP_is_canonical_and_idempotent()
    {
        using var customer = await Register(factory, RoleNames.Customer);
        using var worker = await Register(factory, RoleNames.Worker);
        var (workerId, categoryId) = await ConfigureWorker(worker);
        var future = await Request(customer, workerId, categoryId, Now.AddDays(7), true);
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        var key = Guid.NewGuid().ToString();
        var created = await JsonOk(await Request(customer, workerId, categoryId, Now.AddMinutes(10), true, key));
        Assert.Equal(Now.AddMinutes(5), created.GetProperty("startAt").GetDateTimeOffset());
        var retry = await JsonOk(await Request(customer, workerId, categoryId, Now.AddMinutes(10), true, key));
        Assert.Equal(created.GetProperty("id").GetGuid(), retry.GetProperty("id").GetGuid());
        Assert.Equal(HttpStatusCode.BadRequest, (await customer.GetAsync($"/api/workers?availableNow=true&startAt={Uri.EscapeDataString(Now.AddDays(7).ToString("O"))}")).StatusCode);
    }

    [Fact]
    public async Task ASAP_respects_weekly_hours_and_explicit_time_off_in_matching_creation_acceptance_and_confirmation()
    {
        using var customer = await Register(factory, RoleNames.Customer);
        using var worker = await Register(factory, RoleNames.Worker);
        var (workerId, categoryId) = await ConfigureWorker(worker);
        await Availability(worker, closed: true);
        await AssertUnavailable(customer, workerId, categoryId);
        await Availability(worker, noWindows: true);
        await AssertUnavailable(customer, workerId, categoryId);

        await Availability(worker);
        var booking = await JsonOk(await Request(customer, workerId, categoryId, Now, true));
        var id = booking.GetProperty("id").GetGuid();
        await Availability(worker, closed: true);
        Assert.Equal(HttpStatusCode.Conflict, (await worker.PostAsJsonAsync($"/api/bookings/{id}/action", new { action = "accept" })).StatusCode);
        await Availability(worker);
        await JsonOk(await worker.PostAsJsonAsync($"/api/bookings/{id}/action", new { action = "accept" }));
        await Availability(worker, closed: true);
        Assert.Equal(HttpStatusCode.Conflict, (await customer.PostAsJsonAsync($"/api/bookings/{id}/action", new { action = "confirm" })).StatusCode);
        var unchanged = await customer.GetFromJsonAsync<JsonElement>($"/api/bookings/{id}");
        Assert.Equal("WorkerAccepted", unchanged.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Concurrent_ASAP_accepts_have_one_winner_and_busy_worker_is_excluded_from_matching_and_new_requests()
    {
        using var first = await Register(factory, RoleNames.Customer);
        using var second = await Register(factory, RoleNames.Customer);
        using var worker = await Register(factory, RoleNames.Worker);
        var (workerId, categoryId) = await ConfigureWorker(worker);
        var a = (await JsonOk(await Request(first, workerId, categoryId, Now, true))).GetProperty("id").GetGuid();
        var b = (await JsonOk(await Request(second, workerId, categoryId, Now, true))).GetProperty("id").GetGuid();
        var responses = await Task.WhenAll(worker.PostAsJsonAsync($"/api/bookings/{a}/action", new { action = "accept" }), worker.PostAsJsonAsync($"/api/bookings/{b}/action", new { action = "accept" }));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict);
        var rows = await first.GetFromJsonAsync<JsonElement>("/api/workers?availableNow=true");
        Assert.DoesNotContain(rows.EnumerateArray(), x => x.GetProperty("id").GetGuid() == workerId);
        Assert.Equal(HttpStatusCode.Conflict, (await Request(second, workerId, categoryId, Now, true)).StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<AppDbContext>().Bookings.CountAsync(x => x.WorkerId == workerId && x.Status == BookingStatus.WorkerAccepted));
    }

    private async Task<(Guid WorkerId, Guid CategoryId)> ConfigureWorker(HttpClient worker, bool includePlumbing = false)
    {
        var catalog = await worker.GetFromJsonAsync<JsonElement>("/api/catalog");
        var categoryId = catalog.EnumerateArray().Single(x => x.GetProperty("slug").GetString() == "cleaning").GetProperty("id").GetGuid();
        var categories = new List<Guid> { categoryId };
        if (includePlumbing) categories.Add(catalog.EnumerateArray().Single(x => x.GetProperty("slug").GetString() == "plumbing").GetProperty("id").GetGuid());
        var result = await JsonOk(await worker.PutAsJsonAsync("/api/worker/profile", new { displayName = "SQL regression helper", bio = "Regression fixture", locality = "Mosta", yearsExperience = 2, radiusKm = 10, hourlyRate = 20, categoryIds = categories, modes = new[] { "ForMe" }, pricingType = "Hourly" }));
        await Availability(worker);
        return (result.GetProperty("id").GetGuid(), categoryId);
    }

    private static async Task Availability(HttpClient worker, bool closed = false, bool noWindows = false)
    {
        var localDay = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Now, TimeZoneInfo.FindSystemTimeZoneById("Europe/Malta")).DateTime);
        await JsonOk(await worker.PutAsJsonAsync("/api/worker/availability", new
        {
            availableNow = true,
            windows = noWindows ? [] : Enumerable.Range(0, 7).Select(day => new { dayOfWeek = day, startTime = "00:00", endTime = "23:59" }).ToArray(),
            exceptions = closed ? new[] { new { date = localDay.ToString("yyyy-MM-dd"), isAvailable = false } } : []
        }));
    }

    private static async Task AssertUnavailable(HttpClient customer, Guid workerId, Guid categoryId)
    {
        Assert.Equal(HttpStatusCode.Conflict, (await Request(customer, workerId, categoryId, Now, true)).StatusCode);
        var results = await customer.GetFromJsonAsync<JsonElement>("/api/workers?availableNow=true");
        Assert.DoesNotContain(results.EnumerateArray(), x => x.GetProperty("id").GetGuid() == workerId);
    }

    private static Task<HttpResponseMessage> Request(HttpClient customer, Guid workerId, Guid categoryId, DateTimeOffset startAt, bool isAsap, string? key = null) => customer.PostAsJsonAsync("/api/bookings", new
    {
        workerId,
        categoryId,
        mode = "ForMe",
        summary = "Regression request",
        description = "Real SQL-backed regression",
        address = "Fictional test address",
        locality = "Mosta",
        startAt,
        durationMinutes = 60,
        isAsap,
        idempotencyKey = key ?? Guid.NewGuid().ToString()
    });

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
}
