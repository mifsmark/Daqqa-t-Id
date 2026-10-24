using System.Security.Claims;
using System.Security.Cryptography;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

public static class StagingDemoEndpoints
{
    public static bool ValidateConfiguration(IHostEnvironment environment, IConfiguration configuration, string connection)
    {
        if (!configuration.GetValue<bool>("StagingDemo:Enabled")) return false;
        var database = configuration["StagingDemo:DatabaseName"];
        if (!environment.IsStaging() || string.IsNullOrWhiteSpace(database)
            || !database.EndsWith("_staging_demo", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(new SqlConnectionStringBuilder(connection).InitialCatalog, database, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Staging demo requires the Staging environment and an explicitly matched, isolated database ending in _staging_demo. Never enable it in production.");
        return true;
    }

    public static void MapStagingDemo(this RouteGroupBuilder admin)
    {
        // This group already requires the Admin role, the global API limiter and CSRF.
        // No privileged persona login or shared account password is exposed.
        admin.MapPost("/staging-demo/fixture", async (ClaimsPrincipal principal, AppDbContext db,
            UserManager<ApplicationUser> users, CancellationToken ct) =>
        {
            if (await db.Workers.AnyAsync(x => !x.IsDemo, ct))
                return Results.Conflict(new { title = "The isolated demo database must not contain real worker profiles." });
            var category = await db.Categories.Include(x => x.Modes).SingleOrDefaultAsync(x => x.Slug == "cleaning" && x.IsActive && !x.RequiresVerification, ct);
            if (category is null || !category.Modes.Any(x => x.Mode == BookingMode.ForMe))
                return Results.Conflict(new { title = "Seed the standard cleaning category before creating the fixture." });
            var run = Guid.NewGuid().ToString("N");
            var customerPassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) + "aA1!";
            var workerPassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) + "aA1!";
            var customer = new ApplicationUser { Email = $"customer-{run}@staging.demo.invalid", DisplayName = "Fictional staging customer", Locality = "Mosta", PhoneNumber = "+356 00000000" };
            var workerUser = new ApplicationUser { Email = $"worker-{run}@staging.demo.invalid", DisplayName = "Fictional staging helper", Locality = "Mosta", PhoneNumber = "+356 00000000" };
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await CreateUser(customer, customerPassword, RoleNames.Customer, users);
            await CreateUser(workerUser, workerPassword, RoleNames.Worker, users);
            var worker = new WorkerProfile
            {
                UserId = workerUser.Id,
                DisplayName = workerUser.DisplayName,
                Locality = "Mosta",
                IsDemo = true,
                Bio = "Fictional staging fixture for testing only. No real services or money.",
                HourlyRate = 20m,
                PricingType = PricingType.Hourly,
                RadiusKm = 10,
                YearsExperience = 0,
                VerificationStatus = VerificationStatus.Unverified,
                AvailableNow = false,
                AvailabilityUpdatedAt = DateTimeOffset.UtcNow,
                Offerings = [new Offering { CategoryId = category.Id, PricingType = PricingType.Hourly, Price = 20m, Modes = [new OfferingMode { Mode = BookingMode.ForMe }] }],
                Availability = Enumerable.Range(0, 7).Select(day => new AvailabilityWindow { DayOfWeek = (DayOfWeek)day, StartTime = TimeOnly.MinValue, EndTime = new TimeOnly(23, 59) }).ToList()
            };
            db.Workers.Add(worker);
            db.AuditEntries.Add(new AuditEntry { ActorId = Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!), Action = "staging.fixture.created", Details = run, CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new
            {
                runId = run,
                workerId = worker.Id,
                categoryId = category.Id,
                customer = new { email = customer.Email, password = customerPassword },
                worker = new { email = workerUser.Email, password = workerPassword }
            });
        });
    }

    private static async Task CreateUser(ApplicationUser user, string password, string role, UserManager<ApplicationUser> users)
    {
        user.UserName = user.Email;
        if (!(await users.CreateAsync(user, password)).Succeeded || !(await users.AddToRoleAsync(user, role)).Succeeded)
            throw new InvalidOperationException("Could not create the isolated staging fixture.");
    }
}
