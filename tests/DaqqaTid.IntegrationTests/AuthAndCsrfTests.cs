using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Data.SqlClient;
using Xunit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace DaqqaTid.IntegrationTests;

public sealed class SqlApiFactory(TimeProvider? clock = null, string environment = "Testing", bool stagingDemo = false) : WebApplicationFactory<Program>
{
    private readonly string connection = Connection(stagingDemo);
    private readonly string mediaDirectory = Path.Combine(Path.GetTempPath(), "daqqa-sql-media-" + Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Avoid appsettings.Development.json's LocalDB and bootstrap defaults. Test data is
        // initialized explicitly against TEST_SQL_CONNECTION in InitializeDatabaseAsync.
        builder.UseEnvironment(environment);
        builder.UseSetting("ConnectionStrings:DefaultConnection", connection);
        builder.UseSetting("StagingDemo:Enabled", stagingDemo.ToString());
        builder.UseSetting("StagingDemo:DatabaseName", new SqlConnectionStringBuilder(connection).InitialCatalog);
        if (clock is not null) builder.ConfigureServices(services => services.AddSingleton(clock));
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = connection,
                ["Demo:Enabled"] = "false",
                ["StagingDemo:Enabled"] = stagingDemo.ToString(),
                ["StagingDemo:DatabaseName"] = new SqlConnectionStringBuilder(connection).InitialCatalog,
                ["Database:SeedReferenceDataOnStartup"] = "false",
                ["BootstrapAdmin:Email"] = "",
                ["BootstrapAdmin:Password"] = "",
                ["Media:StoragePath"] = mediaDirectory
            }));
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        try { Directory.Delete(mediaDirectory, recursive: true); } catch (IOException) { }
    }

    public async Task InitializeDatabaseAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (stagingDemo) await db.Database.MigrateAsync();
        else await db.Database.EnsureCreatedAsync();
        await DatabaseSeeder.SeedReferenceDataAsync(db);
        var roles = scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.RoleManager<Microsoft.AspNetCore.Identity.IdentityRole<Guid>>>();
        foreach (var role in new[] { "Customer", "Worker", "Admin" })
            if (!await roles.RoleExistsAsync(role)) await roles.CreateAsync(new(role));
    }

    private static string Connection(bool stagingDemo)
    {
        var value = Environment.GetEnvironmentVariable("TEST_SQL_CONNECTION")
            ?? throw new InvalidOperationException("TEST_SQL_CONNECTION is required. Point it to a dedicated SQL Server test database.");
        if (!stagingDemo) return value;
        var builder = new SqlConnectionStringBuilder(value);
        builder.InitialCatalog += "_staging_demo";
        return builder.ConnectionString;
    }
}

public sealed class AuthAndCsrfTests : IAsyncLifetime
{
    private readonly SqlApiFactory factory = new();
    private HttpClient client = null!;

    public async Task InitializeAsync()
    {
        await factory.InitializeDatabaseAsync();
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, BaseAddress = new Uri("https://localhost") });
    }

    public async Task DisposeAsync() { client.Dispose(); await factory.DisposeAsync(); }

    [Fact]
    public async Task Registration_requires_csrf_and_establishes_customer_session()
    {
        var sessionResponse = await client.GetAsync("/api/session");
        sessionResponse.EnsureSuccessStatusCode();
        var session = await sessionResponse.Content.ReadFromJsonAsync<JsonElement>();
        var token = session.GetProperty("csrfToken").GetString();
        Assert.False(string.IsNullOrWhiteSpace(token));

        var payload = new { email = $"customer-{Guid.NewGuid():N}@example.test", password = "Good-Password-2026", displayName = "SQL Test Customer", phone = "+356 79000000", locality = "Mosta", role = "Customer" };
        var withoutToken = await client.PostAsJsonAsync("/api/auth/register", payload);
        Assert.Equal(HttpStatusCode.BadRequest, withoutToken.StatusCode);

        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token);
        var registered = await client.PostAsJsonAsync("/api/auth/register", payload);
        Assert.Equal(HttpStatusCode.OK, registered.StatusCode);
        Assert.Equal("Customer", (await registered.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("role").GetString());

        var authenticated = await client.GetAsync("/api/session");
        authenticated.EnsureSuccessStatusCode();
        Assert.Equal(payload.email, (await authenticated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("user").GetProperty("email").GetString());
    }
}
