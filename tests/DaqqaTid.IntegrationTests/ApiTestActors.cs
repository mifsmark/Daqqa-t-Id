using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace DaqqaTid.IntegrationTests;

internal static class ApiTestActors
{
    public static HttpClient NewClient(SqlApiFactory factory) => factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });

    public static async Task RefreshCsrf(HttpClient client)
    {
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", session.GetProperty("csrfToken").GetString());
    }

    public static async Task<HttpClient> Register(SqlApiFactory factory, string role)
    {
        var client = NewClient(factory);
        await RefreshCsrf(client);
        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email = $"regression-{Guid.NewGuid():N}@example.test",
            password = "Good-Password-2026",
            displayName = $"Regression {role}",
            phone = "+356 79000000",
            locality = "Mosta",
            role
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await RefreshCsrf(client);
        return client;
    }

    public static async Task<HttpClient> Admin(SqlApiFactory factory)
    {
        var email = $"regression-admin-{Guid.NewGuid():N}@example.test";
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser { UserName = email, Email = email, DisplayName = "Regression administrator" };
        Assert.True((await users.CreateAsync(user, "Good-Password-2026")).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, RoleNames.Admin)).Succeeded);
        return await Login(factory, email, "Good-Password-2026");
    }

    public static async Task<HttpClient> Login(SqlApiFactory factory, string email, string password)
    {
        var client = NewClient(factory);
        await RefreshCsrf(client);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/auth/login", new { email, password })).StatusCode);
        await RefreshCsrf(client);
        return client;
    }

    public static async Task<JsonElement> JsonOk(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"Unexpected HTTP {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
