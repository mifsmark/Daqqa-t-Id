using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting.Internal;
using Xunit;
using static DaqqaTid.IntegrationTests.ApiTestActors;

namespace DaqqaTid.IntegrationTests;

public sealed class StagingDemoTests
{
    [Theory]
    [InlineData("normal-marketplace", "normal-marketplace")]
    [InlineData("expected_staging_demo", "different_staging_demo")]
    public void Staging_demo_refuses_nonisolated_or_mismatched_database_names(string expectedDatabase, string actualDatabase)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["StagingDemo:Enabled"] = "true",
            ["StagingDemo:DatabaseName"] = expectedDatabase
        }).Build();
        var environment = new HostingEnvironment { EnvironmentName = "Staging" };
        Assert.Throws<InvalidOperationException>(() => StagingDemoEndpoints.ValidateConfiguration(environment, configuration, $"Server=localhost;Database={actualDatabase};Integrated Security=True"));
    }

    [Fact]
    public async Task Isolated_staging_fixture_requires_admin_and_csrf_and_completes_a_real_SQL_booking()
    {
        await using var factory = new SqlApiFactory(environment: "Staging", stagingDemo: true);
        await factory.InitializeDatabaseAsync();
        using var anonymous = NewClient(factory);
        await RefreshCsrf(anonymous);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/admin/staging-demo/fixture", new { })).StatusCode);
        var session = await anonymous.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.True(session.GetProperty("stagingDemoEnabled").GetBoolean());
        Assert.False(session.GetProperty("demoEnabled").GetBoolean());
        Assert.Equal("noindex, nofollow", (await anonymous.GetAsync("/health/live")).Headers.GetValues("X-Robots-Tag").Single());
        Assert.Equal("User-agent: *\nDisallow: /\n", await anonymous.GetStringAsync("/robots.txt"));
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/sitemap.xml")).StatusCode);
        using var ordinaryUser = await Register(factory, RoleNames.Customer);
        Assert.Equal(HttpStatusCode.Forbidden, (await ordinaryUser.PostAsJsonAsync("/api/admin/staging-demo/fixture", new { })).StatusCode);
        using var admin = await Admin(factory);
        admin.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/staging-demo/fixture", new { })).StatusCode);
        await RefreshCsrf(admin);
        var fixture = await JsonOk(await admin.PostAsJsonAsync("/api/admin/staging-demo/fixture", new { }));
        var workerId = fixture.GetProperty("workerId").GetGuid();
        var categoryId = fixture.GetProperty("categoryId").GetGuid();
        using var customer = await FixtureLogin(factory, fixture.GetProperty("customer"));
        using var worker = await FixtureLogin(factory, fixture.GetProperty("worker"));
        var publicProfile = await customer.GetFromJsonAsync<JsonElement>($"/api/workers/{workerId}");
        Assert.True(publicProfile.GetProperty("isDemo").GetBoolean());
        Assert.Contains("Fictional", publicProfile.GetProperty("displayName").GetString());
        var startAt = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(2).AddHours(10), TimeSpan.Zero);
        var requested = await JsonOk(await customer.PostAsJsonAsync("/api/bookings", new
        {
            workerId,
            categoryId,
            mode = "ForMe",
            summary = "Fictional staging smoke request",
            description = "No actual services or money",
            address = "Fictional address",
            locality = "Mosta",
            startAt,
            durationMinutes = 60,
            isAsap = false,
            idempotencyKey = fixture.GetProperty("runId").GetString()
        }));
        var id = requested.GetProperty("id").GetGuid();
        foreach (var (actor, action, expected) in new[] { (worker, "accept", "WorkerAccepted"), (customer, "confirm", "Confirmed"), (worker, "start", "InProgress"), (worker, "complete", "Completed") })
        {
            var result = await JsonOk(await actor.PostAsJsonAsync($"/api/bookings/{id}/action", new { action }));
            Assert.Equal(expected, result.GetProperty("status").GetString());
            Assert.True(result.GetProperty("isSimulated").GetBoolean());
        }
        await JsonOk(await customer.PostAsJsonAsync($"/api/bookings/{id}/review", new { rating = 5, comment = "Fictional staging test review" }));
        var adminPayments = await admin.GetFromJsonAsync<JsonElement>("/api/admin/payments");
        Assert.Contains(adminPayments.EnumerateArray(), x => x.GetProperty("bookingId").GetGuid() == id && x.GetProperty("isSimulated").GetBoolean());
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.EndsWith("_staging_demo", db.Database.GetDbConnection().Database);
        Assert.Equal(BookingStatus.Completed, (await db.Bookings.SingleAsync(x => x.Id == id)).Status);
        Assert.Single(await db.Payments.Where(x => x.BookingId == id).ToListAsync());
        Assert.True(await db.Workers.Where(x => x.Id == workerId).Select(x => x.IsDemo).SingleAsync());
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Development")]
    public async Task Staging_demo_cannot_be_enabled_outside_Staging(string environment)
    {
        await using var factory = new SqlApiFactory(environment: environment, stagingDemo: true);
        var error = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("Staging demo requires", error.Message);
    }

    [Fact]
    public async Task Production_has_no_fixture_endpoint_or_public_demo_personas()
    {
        await using var factory = new SqlApiFactory(environment: "Production");
        using var client = NewClient(factory);
        await RefreshCsrf(client);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/admin/staging-demo/fixture", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/auth/demo", new { persona = "admin" })).StatusCode);
    }

    private static Task<HttpClient> FixtureLogin(SqlApiFactory factory, JsonElement credentials) => Login(factory, credentials.GetProperty("email").GetString()!, credentials.GetProperty("password").GetString()!);
}
