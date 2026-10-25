using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DaqqaTid.IntegrationTests;

public sealed class HostingSmokeTests : IAsyncLifetime
{
    private readonly OfflineSqlFactory factory = new();
    private HttpClient client = null!;

    public Task InitializeAsync()
    {
        client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        client.Dispose();
        await factory.DisposeAsync();
    }

    [Fact]
    public async Task Development_host_serves_sql_independent_routes_and_enforces_csrf_and_robots_headers()
    {
        var live = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal("nosniff", live.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", live.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("live", (await live.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());

        var sessionResponse = await client.GetAsync("/api/session");
        Assert.Equal(HttpStatusCode.OK, sessionResponse.StatusCode);
        var session = await sessionResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
        var token = session.GetProperty("csrfToken").GetString();
        Assert.False(string.IsNullOrWhiteSpace(token));

        var protectedPage = await client.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, protectedPage.StatusCode);
        var missingCsrf = await client.PostAsJsonAsync("/api/auth/logout", new { });
        Assert.Equal(HttpStatusCode.BadRequest, missingCsrf.StatusCode);

        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token);
        var forgot = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = "nobody@example.test" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, forgot.StatusCode);
        var forgotProblem = await forgot.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Password reset mail is not configured.", forgotProblem.GetProperty("detail").GetString());

        var home = await client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, home.StatusCode);
        var html = await home.Content.ReadAsStringAsync();
        Assert.Contains("<title>Daqqa t’Id | Find local help in Malta &amp; Gozo</title>", html);
        Assert.Contains("<link rel=\"canonical\" href=\"https://market.example/\">", html);
        Assert.Contains("application/ld+json", html);
        Assert.Contains("<h1>Find local help. Get things done.</h1>", html);

        var robots = await client.GetAsync("/robots.txt");
        Assert.Equal(HttpStatusCode.OK, robots.StatusCode);
        var robotsText = await robots.Content.ReadAsStringAsync();
        Assert.Contains("Disallow: /api/", robotsText);
        Assert.Contains("Sitemap: https://market.example/sitemap.xml", robotsText);

        var dashboard = await client.GetAsync("/dashboard");
        Assert.Equal(HttpStatusCode.OK, dashboard.StatusCode);
        Assert.Equal("noindex, nofollow", dashboard.Headers.GetValues("X-Robots-Tag").Single());
        Assert.False(robots.Headers.Contains("X-Robots-Tag"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/missing-endpoint")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/workers/not-a-guid")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/missing-page")).StatusCode);
    }

    [Fact]
    public async Task Contact_and_support_are_directly_routable_server_rendered_documents()
    {
        var contact = await client.GetAsync("/contact");
        Assert.Equal(HttpStatusCode.OK, contact.StatusCode);
        Assert.Contains("text/html", contact.Content.Headers.ContentType?.MediaType);
        var contactHtml = await contact.Content.ReadAsStringAsync();
        Assert.Contains("<title>Contact Daqqa t’Id</title>", contactHtml);
        Assert.Contains("<h1>Contact Daqqa t’Id</h1>", contactHtml);
        Assert.Contains("mailto:markanthonymifsud@yahoo.com", contactHtml);
        Assert.Contains("https://wa.me/35699894619", contactHtml);

        var support = await client.GetAsync("/support");
        Assert.Equal(HttpStatusCode.OK, support.StatusCode);
        Assert.Contains("text/html", support.Content.Headers.ContentType?.MediaType);
        var supportHtml = await support.Content.ReadAsStringAsync();
        Assert.Contains("<title>Support Daqqa t’Id</title>", supportHtml);
        Assert.Contains("<h1>Support a useful local service.</h1>", supportHtml);
        Assert.Contains("href=\"/contact\"", supportHtml);
    }

    private sealed class OfflineSqlFactory : WebApplicationFactory<Program>
    {
        private readonly string webRoot = Path.Combine(Path.GetTempPath(), "daqqa-hosting-smoke-" + Guid.NewGuid().ToString("N"));

        public OfflineSqlFactory()
        {
            Directory.CreateDirectory(webRoot);
            File.WriteAllText(Path.Combine(webRoot, "index.html"), "<!doctype html><html><head><title>Daqqa t’Id</title></head><body><div id=\"root\"></div></body></html>");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.UseWebRoot(webRoot);
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = "Server=127.0.0.1,1;Database=Unavailable;User Id=invalid;Password=invalid;TrustServerCertificate=True;Connect Timeout=1",
                ["Database:SeedReferenceDataOnStartup"] = "false",
                ["PublicOrigin"] = "https://market.example",
                ["MAIL_HOST"] = "",
                ["MAIL_FROM"] = "",
                ["MAIL_PORT"] = ""
            }));
        }

        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync();
            try { Directory.Delete(webRoot, recursive: true); } catch (IOException) { }
        }
    }
}
