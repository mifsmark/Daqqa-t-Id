using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DaqqaTid.IntegrationTests;

public sealed class MarketplaceLifecycleTests : IAsyncLifetime
{
    private readonly SqlApiFactory factory = new();
    private Guid categoryId;
    private Guid plumbingCategoryId;
    private string categorySlug = "";

    public async Task InitializeAsync()
    {
        await factory.InitializeDatabaseAsync();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        categorySlug = $"e2e-learn-{Guid.NewGuid():N}";
        var category = new Category { Slug = categorySlug, Name = "Test household and learning service", Description = "Integration fixture", Icon = "book", RequiresVerification = false, Modes = [new CategoryMode { Mode = BookingMode.ForMe }, new CategoryMode { Mode = BookingMode.WithMe }, new CategoryMode { Mode = BookingMode.TeachMe }] };
        db.Categories.Add(category);
        await db.SaveChangesAsync();
        categoryId = category.Id;
        plumbingCategoryId = await db.Categories.Where(x => x.Slug == "plumbing").Select(x => x.Id).SingleAsync();
    }

    public async Task DisposeAsync() => await factory.DisposeAsync();

    [Fact]
    public async Task Quote_teach_booking_is_owned_idempotent_completable_reviewable_and_payment_is_simulated_once()
    {
        using var customer = await RegisteredClient("Customer");
        using var worker = await RegisteredClient("Worker");
        using var otherCustomer = await RegisteredClient("Customer");
        using var admin = await RegisteredAdminClient();

        var categoryUpdate = new
        {
            name = "Test household and learning service",
            slug = categorySlug,
            description = "Integration fixture",
            icon = "book",
            requiresVerification = false,
            isActive = true,
            modes = new[] { "ForMe", "WithMe", "TeachMe" }
        };
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/categories/{categoryId}", categoryUpdate)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/categories/{categoryId}", categoryUpdate)).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(3, await db.CategoryModes.CountAsync(x => x.CategoryId == categoryId));
        }

        var profile = await worker.PutAsJsonAsync("/api/worker/profile", new
        {
            displayName = "Teach Test Helper",
            bio = "Patient lessons",
            locality = "Mosta",
            yearsExperience = 8,
            radiusKm = 12,
            hourlyRate = 35m,
            categoryIds = new[] { categoryId, plumbingCategoryId },
            modes = new[] { "TeachMe", "ForMe", "WithMe" },
            pricingType = "Quote"
        });
        Assert.True(profile.StatusCode == HttpStatusCode.OK,
            $"Worker profile setup failed ({(int)profile.StatusCode}): {await profile.Content.ReadAsStringAsync()}");
        var workerProfile = await profile.Content.ReadFromJsonAsync<JsonElement>();
        var workerId = workerProfile.GetProperty("id").GetGuid();
        var availability = await worker.PutAsJsonAsync("/api/worker/availability", new
        {
            availableNow = false,
            windows = Enumerable.Range(0, 7).Select(day => new { dayOfWeek = day, startTime = "00:00", endTime = "23:59" }).ToArray(),
            exceptions = Array.Empty<object>()
        });
        Assert.Equal(HttpStatusCode.OK, availability.StatusCode);

        using (var anonymous = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") }))
        {
            var session = await anonymous.GetFromJsonAsync<JsonElement>("/api/session");
            anonymous.DefaultRequestHeaders.Add("X-CSRF-TOKEN", session.GetProperty("csrfToken").GetString());
            using var unauthenticatedImage = ImageForm("avatar", null, PngHeader, "avatar.png");
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/media", unauthenticatedImage)).StatusCode);
        }
        using (var invalidImage = ImageForm("portfolio", null, "not an image"u8.ToArray(), "picture.png"))
            Assert.Equal(HttpStatusCode.BadRequest, (await worker.PostAsync("/api/media", invalidImage)).StatusCode);
        using (var oversizedImage = ImageForm("portfolio", null, new byte[5 * 1024 * 1024 + 1], "large.png"))
            Assert.Equal(HttpStatusCode.BadRequest, (await worker.PostAsync("/api/media", oversizedImage)).StatusCode);

        var start = DateTimeOffset.UtcNow.AddDays(3).Date.AddHours(10);
        var request = new
        {
            workerId,
            categoryId,
            mode = "TeachMe",
            summary = "Learn basic repairs",
            description = "Show me how to fix a loose shelf.",
            address = "17 Private Lane",
            locality = "Mosta",
            startAt = start,
            durationMinutes = 60,
            isAsap = false,
            idempotencyKey = $"request-{Guid.NewGuid():N}"
        };
        var create = await customer.PostAsJsonAsync("/api/bookings", request);
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        var first = await create.Content.ReadFromJsonAsync<JsonElement>();
        var bookingId = first.GetProperty("id").GetGuid();
        Assert.Equal("Requested", first.GetProperty("status").GetString());
        var requestedInbox = await worker.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.Contains(requestedInbox.GetProperty("items").EnumerateArray(), item => string.Equals(item.GetProperty("bookingId").GetString(), bookingId.ToString(), StringComparison.Ordinal) && item.GetProperty("kind").GetString() == "Requested");
        var customerInbox = await customer.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.DoesNotContain(customerInbox.GetProperty("items").EnumerateArray(), item => string.Equals(item.GetProperty("bookingId").GetString(), bookingId.ToString(), StringComparison.Ordinal));

        var unverifiedPlumber = await customer.PostAsJsonAsync("/api/bookings", new
        {
            workerId,
            categoryId = plumbingCategoryId,
            mode = "ForMe",
            summary = "Fix a leaking tap",
            description = "The kitchen tap is dripping.",
            address = "17 Private Lane",
            locality = "Mosta",
            startAt = start.AddDays(1),
            durationMinutes = 60,
            isAsap = false,
            idempotencyKey = $"plumber-denied-{Guid.NewGuid():N}"
        });
        Assert.Equal(HttpStatusCode.Conflict, unverifiedPlumber.StatusCode);

        var verification = await worker.PostAsJsonAsync("/api/worker/verification", new { reference = "TEST-REG-42", notes = "Integration-only credential review" });
        Assert.Equal(HttpStatusCode.OK, verification.StatusCode);
        Assert.Equal("Pending", (await verification.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("verificationStatus").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await worker.PostAsJsonAsync($"/api/admin/workers/{workerId}/verification", new { status = "Verified" })).StatusCode);
        var approval = await admin.PostAsJsonAsync($"/api/admin/workers/{workerId}/verification", new { status = "Verified" });
        Assert.Equal(HttpStatusCode.OK, approval.StatusCode);
        Assert.Equal("Verified", (await approval.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("verificationStatus").GetString());
        var audit = await admin.GetFromJsonAsync<JsonElement[]>("/api/admin/audit");
        Assert.Contains(audit!, item => item.GetProperty("action").GetString() == "worker.verification");

        var hourlyProfile = await worker.PutAsJsonAsync("/api/worker/profile", new
        {
            displayName = "Teach Test Helper",
            bio = "Patient lessons",
            locality = "Mosta",
            yearsExperience = 8,
            radiusKm = 12,
            hourlyRate = 35m,
            categoryIds = new[] { categoryId, plumbingCategoryId },
            modes = new[] { "TeachMe", "ForMe", "WithMe" },
            pricingType = "Hourly"
        });
        Assert.Equal(HttpStatusCode.OK, hourlyProfile.StatusCode);

        var plumberRequest = await customer.PostAsJsonAsync("/api/bookings", new
        {
            workerId,
            categoryId = plumbingCategoryId,
            mode = "ForMe",
            summary = "Fix a leaking tap",
            description = "The kitchen tap is dripping.",
            address = "17 Private Lane",
            locality = "Mosta",
            startAt = start.AddDays(1),
            durationMinutes = 60,
            isAsap = false,
            idempotencyKey = $"plumber-{Guid.NewGuid():N}"
        });
        Assert.Equal(HttpStatusCode.OK, plumberRequest.StatusCode);
        var plumberBooking = await plumberRequest.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Requested", plumberBooking.GetProperty("status").GetString());
        Assert.Equal("ForMe", plumberBooking.GetProperty("mode").GetString());
        var plumberBookingId = plumberBooking.GetProperty("id").GetGuid();
        using (var inspect = factory.Services.CreateScope())
        {
            var db = inspect.ServiceProvider.GetRequiredService<AppDbContext>();
            var persisted = await db.Bookings.AsNoTracking().SingleAsync(x => x.Id == plumberBookingId);
            Assert.True(persisted.RowVersion.Length > 0, "SQL Server should have generated the booking rowversion.");
        }
        Assert.Equal("WorkerAccepted", (await Action(worker, plumberBookingId, "accept")).GetProperty("status").GetString());
        Assert.Equal("Confirmed", (await Action(customer, plumberBookingId, "confirm")).GetProperty("status").GetString());
        Assert.Equal("InProgress", (await Action(worker, plumberBookingId, "start")).GetProperty("status").GetString());
        var plumberCompleted = await Action(worker, plumberBookingId, "complete");
        Assert.Equal("Completed", plumberCompleted.GetProperty("status").GetString());
        Assert.True(plumberCompleted.GetProperty("isSimulated").GetBoolean());

        Assert.Equal(JsonValueKind.Null, first.GetProperty("amount").ValueKind);
        Assert.Equal("17 Private Lane", first.GetProperty("address").GetString());

        var retry = await customer.PostAsJsonAsync("/api/bookings", request);
        Assert.Equal(bookingId, (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(1, await db.Notifications.CountAsync(x => x.BookingId == bookingId && x.Kind == "Requested"));
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await otherCustomer.GetAsync($"/api/bookings/{bookingId}")).StatusCode);

        var workerView = await worker.GetAsync($"/api/bookings/{bookingId}");
        workerView.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Null, (await workerView.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("address").ValueKind);

        var quote = await Action(worker, bookingId, "quote", 42m);
        Assert.Equal("Quoted", quote.GetProperty("status").GetString());
        Assert.Equal(42m, quote.GetProperty("quoteAmount").GetDecimal());
        var quotedInbox = await customer.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.Contains(quotedInbox.GetProperty("items").EnumerateArray(), item => string.Equals(item.GetProperty("bookingId").GetString(), bookingId.ToString(), StringComparison.Ordinal) && item.GetProperty("kind").GetString() == "Quoted");
        using (var prematureImage = ImageForm("booking", bookingId, PngHeader, "repair.png"))
            Assert.Equal(HttpStatusCode.Conflict, (await customer.PostAsync("/api/media", prematureImage)).StatusCode);
        var confirmed = await Action(customer, bookingId, "confirm");
        Assert.Equal("Confirmed", confirmed.GetProperty("status").GetString());
        Assert.Equal("17 Private Lane", confirmed.GetProperty("address").GetString());
        Guid attachmentId;
        using (var bookingImage = ImageForm("booking", bookingId, PngHeader, "repair.png"))
        {
            var uploaded = await customer.PostAsync("/api/media", bookingImage);
            Assert.Equal(HttpStatusCode.Created, uploaded.StatusCode);
            attachmentId = (await uploaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        }
        Assert.Equal(HttpStatusCode.OK, (await worker.GetAsync($"/api/media/{attachmentId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherCustomer.GetAsync($"/api/media/{attachmentId}")).StatusCode);
        Assert.Equal("InProgress", (await Action(worker, bookingId, "start")).GetProperty("status").GetString());
        var completed = await Action(worker, bookingId, "complete");
        Assert.Equal("Completed", completed.GetProperty("status").GetString());
        Assert.True(completed.GetProperty("isSimulated").GetBoolean());

        var review = await customer.PostAsJsonAsync($"/api/bookings/{bookingId}/review", new { rating = 5, comment = "Clear and helpful." });
        Assert.Equal(HttpStatusCode.OK, review.StatusCode);
        var reviewInbox = await worker.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.Contains(reviewInbox.GetProperty("items").EnumerateArray(), item => string.Equals(item.GetProperty("bookingId").GetString(), bookingId.ToString(), StringComparison.Ordinal) && item.GetProperty("kind").GetString() == "Review");
        Assert.Equal(HttpStatusCode.Conflict, (await customer.PostAsJsonAsync($"/api/bookings/{bookingId}/review", new { rating = 5, comment = "Duplicate" })).StatusCode);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(1, await db.Payments.CountAsync(x => x.BookingId == bookingId));
            var payment = await db.Payments.SingleAsync(x => x.BookingId == bookingId);
            Assert.True(payment.IsSimulated);
            Assert.Equal(42m, payment.Amount);
            Assert.Equal(1, await db.Payments.CountAsync(x => x.BookingId == plumberBookingId));
        }

        var quoteProfile = await worker.PutAsJsonAsync("/api/worker/profile", new
        {
            displayName = "Teach Test Helper",
            bio = "Patient lessons",
            locality = "Mosta",
            yearsExperience = 8,
            radiusKm = 12,
            hourlyRate = 35m,
            categoryIds = new[] { categoryId, plumbingCategoryId },
            modes = new[] { "TeachMe", "ForMe", "WithMe" },
            pricingType = "Quote"
        });
        Assert.Equal(HttpStatusCode.OK, quoteProfile.StatusCode);
        var withMeResponse = await customer.PostAsJsonAsync("/api/bookings", new
        {
            workerId,
            categoryId,
            mode = "WithMe",
            summary = "Work together on a shelf",
            description = "Guide me while I fit a shelf.",
            address = "17 Private Lane",
            locality = "Mosta",
            startAt = start.AddDays(3),
            durationMinutes = 60,
            isAsap = false,
            idempotencyKey = $"withme-{Guid.NewGuid():N}"
        });
        Assert.Equal(HttpStatusCode.OK, withMeResponse.StatusCode);
        var withMeBooking = await withMeResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("WithMe", withMeBooking.GetProperty("mode").GetString());
        var withMeBookingId = withMeBooking.GetProperty("id").GetGuid();
        Assert.Equal("Quoted", (await Action(worker, withMeBookingId, "quote", 55m)).GetProperty("status").GetString());
        Assert.Equal("Confirmed", (await Action(customer, withMeBookingId, "confirm")).GetProperty("status").GetString());

        var hourlyOverlapProfile = await worker.PutAsJsonAsync("/api/worker/profile", new
        {
            displayName = "Teach Test Helper",
            bio = "Patient lessons",
            locality = "Mosta",
            yearsExperience = 8,
            radiusKm = 12,
            hourlyRate = 35m,
            categoryIds = new[] { categoryId, plumbingCategoryId },
            modes = new[] { "TeachMe", "ForMe", "WithMe" },
            pricingType = "Hourly"
        });
        Assert.Equal(HttpStatusCode.OK, hourlyOverlapProfile.StatusCode);
        var overlapStart = start.AddDays(2);
        var left = await CreateBooking(customer, workerId, categoryId, overlapStart, "left");
        var right = await CreateBooking(otherCustomer, workerId, categoryId, overlapStart, "right");
        var attempts = await Task.WhenAll(ActionResponse(worker, left, "accept"), ActionResponse(worker, right, "accept"));
        Assert.Single(attempts, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(attempts, x => x.StatusCode == HttpStatusCode.Conflict);
        var reservedId = attempts[0].StatusCode == HttpStatusCode.OK ? left : right;
        var waitingId = reservedId == left ? right : left;
        var reservedOwner = reservedId == left ? customer : otherCustomer;
        Assert.Equal("Cancelled", (await Action(reservedOwner, reservedId, "cancel")).GetProperty("status").GetString());
        Assert.Equal("WorkerAccepted", (await Action(worker, waitingId, "accept")).GetProperty("status").GetString());
    }

    private async Task<HttpClient> RegisteredClient(string role)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        var sessionResponse = await client.GetAsync("/api/session");
        sessionResponse.EnsureSuccessStatusCode();
        var token = (await sessionResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("csrfToken").GetString()!;
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token);
        var email = $"{role.ToLowerInvariant()}-{Guid.NewGuid():N}@example.test";
        var registered = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Good-Password-2026",
            displayName = $"SQL {role}",
            phone = "+356 79000000",
            locality = "Mosta",
            role
        });
        Assert.Equal(HttpStatusCode.OK, registered.StatusCode);
        await RefreshCsrf(client);
        return client;
    }

    private static async Task RefreshCsrf(HttpClient client)
    {
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", session.GetProperty("csrfToken").GetString());
    }

    private async Task<HttpClient> RegisteredAdminClient()
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        var sessionResponse = await client.GetAsync("/api/session");
        sessionResponse.EnsureSuccessStatusCode();
        var token = (await sessionResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("csrfToken").GetString()!;
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token);
        var email = $"admin-{Guid.NewGuid():N}@example.test";
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser { UserName = email, Email = email, DisplayName = "SQL Test Admin", Locality = "Mosta" };
        Assert.True((await users.CreateAsync(user, "Good-Password-2026")).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, "Admin")).Succeeded);
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "Good-Password-2026" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        await RefreshCsrf(client);
        return client;
    }

    private static async Task<Guid> CreateBooking(HttpClient customer, Guid workerId, Guid categoryId, DateTimeOffset start, string suffix)
    {
        var response = await customer.PostAsJsonAsync("/api/bookings", new
        {
            workerId,
            categoryId,
            mode = "TeachMe",
            summary = $"Overlap {suffix}",
            description = "Competing reservation",
            address = "Private address",
            locality = "Mosta",
            startAt = start,
            durationMinutes = 60,
            isAsap = false,
            idempotencyKey = $"overlap-{Guid.NewGuid():N}"
        });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<JsonElement> Action(HttpClient client, Guid bookingId, string action, decimal? amount = null)
    {
        var response = await ActionResponse(client, bookingId, action, amount);
        Assert.True(response.StatusCode == HttpStatusCode.OK,
            $"Booking action '{action}' failed ({(int)response.StatusCode}): {await response.Content.ReadAsStringAsync()}");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static readonly byte[] PngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    private static MultipartFormDataContent ImageForm(string purpose, Guid? bookingId, byte[] bytes, string fileName)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(purpose), "purpose");
        if (bookingId is not null) form.Add(new StringContent(bookingId.Value.ToString()), "bookingId");
        form.Add(new ByteArrayContent(bytes), "file", fileName);
        return form;
    }

    private static Task<HttpResponseMessage> ActionResponse(HttpClient client, Guid bookingId, string action, decimal? amount = null) =>
        client.PostAsJsonAsync($"/api/bookings/{bookingId}/action", new { action, amount });
}
