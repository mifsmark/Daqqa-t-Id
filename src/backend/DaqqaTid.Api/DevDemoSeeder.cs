using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

public static class DevDemoSeeder
{
    public static async Task SeedAsync(AppDbContext db, UserManager<ApplicationUser> users, CancellationToken ct = default)
    {
        var tiling = await db.Categories.Include(x => x.Modes).SingleOrDefaultAsync(x => x.Slug == "tiling", ct);
        if (tiling is null)
        {
            tiling = new Category
            {
                Slug = "tiling",
                Name = "Tiling",
                Description = "Tile fitting, repair and practical tiling lessons.",
                Icon = "grid-3x3",
                IsActive = true,
                Modes = [new() { Mode = BookingMode.ForMe }, new() { Mode = BookingMode.WithMe }, new() { Mode = BookingMode.TeachMe }]
            };
            db.Categories.Add(tiling);
            await db.SaveChangesAsync(ct);
        }

        var plumbing = await db.Categories.SingleAsync(x => x.Slug == "plumbing", ct);
        var handyman = await db.Categories.SingleAsync(x => x.Slug == "handyman", ct);
        await EnsureWorkerAsync(db, users, "demo.worker@daqqatid.local", "Noah Borg (Demo)", "Valletta",
            "Fictional demo profile. Explore home repairs, tiling and practical help in the demo journey.",
            VerificationStatus.Verified, PricingType.Hourly, 25m, [
                (plumbing.Id, PricingType.Hourly, 25m, new[] { BookingMode.ForMe }),
                (tiling.Id, PricingType.Hourly, 25m, new[] { BookingMode.ForMe, BookingMode.WithMe }),
                (handyman.Id, PricingType.Hourly, 25m, new[] { BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe })
            ], ct);

        await EnsureWorkerAsync(db, users, "demo.quotes@daqqatid.local", "Sofia Vella (Demo)", "Mosta",
            "Fictional demo profile. Offers tiling help and lessons after agreeing on a quote.",
            VerificationStatus.Unverified, PricingType.Quote, 0m, [
                (tiling.Id, PricingType.Quote, (decimal?)null, new[] { BookingMode.WithMe, BookingMode.TeachMe })
            ], ct);
    }

    private static async Task EnsureWorkerAsync(AppDbContext db, UserManager<ApplicationUser> users,
        string email, string displayName, string locality, string bio, VerificationStatus verification,
        PricingType profilePricing, decimal hourlyRate,
        (Guid CategoryId, PricingType Pricing, decimal? Price, BookingMode[] Modes)[] offerings,
        CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new ApplicationUser
            {
                UserName = email,
                Email = email,
                EmailConfirmed = true,
                DisplayName = displayName,
                PhoneNumber = "+356 7900 0000",
                Locality = locality
            };
            var generatedPassword = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48)) + "Aa1!";
            var created = await users.CreateAsync(user, generatedPassword);
            if (!created.Succeeded)
                throw new InvalidOperationException($"Could not create development persona: {string.Join("; ", created.Errors.Select(x => x.Description))}");
        }

        if (user.IsSuspended) return;
        if (!await users.IsInRoleAsync(user, RoleNames.Worker))
        {
            var added = await users.AddToRoleAsync(user, RoleNames.Worker);
            if (!added.Succeeded)
                throw new InvalidOperationException($"Could not assign development worker role: {string.Join("; ", added.Errors.Select(x => x.Description))}");
        }

        var worker = await db.Workers.Include(x => x.Offerings).ThenInclude(x => x.Modes)
            .Include(x => x.Availability).SingleOrDefaultAsync(x => x.UserId == user.Id, ct);
        if (worker is not null && (!worker.IsDemo || worker.Offerings.Count > 0 ||
            (!string.IsNullOrWhiteSpace(worker.Bio) && worker.Bio != "Development persona"))) return;
        // Upgrade the old empty development persona once; populated profiles remain untouched.
        var isNew = worker is null;
        worker ??= new WorkerProfile();
        worker.UserId = user.Id;
        worker.DisplayName = displayName;
        worker.Bio = bio;
        worker.Locality = locality;
        worker.YearsExperience = 6;
        worker.RadiusKm = 40;
        worker.HourlyRate = hourlyRate;
        worker.PricingType = profilePricing;
        worker.VerificationStatus = verification;
        worker.AvailableNow = true;
        worker.AvailabilityUpdatedAt = DateTimeOffset.UtcNow;
        worker.IsDemo = true;
        if (worker.Availability.Count == 0)
        {
            for (var day = 0; day < 7; day++)
                worker.Availability.Add(new AvailabilityWindow
                {
                    WorkerId = worker.Id,
                    DayOfWeek = (DayOfWeek)day,
                    StartTime = new TimeOnly(8, 0),
                    EndTime = new TimeOnly(20, 0)
                });
        }
        foreach (var (categoryId, pricing, price, modes) in offerings)
            worker.Offerings.Add(new Offering
            {
                WorkerId = worker.Id,
                CategoryId = categoryId,
                PricingType = pricing,
                Price = price,
                Modes = modes.Select(mode => new OfferingMode { Mode = mode }).ToList()
            });
        if (isNew) db.Workers.Add(worker);
        await db.SaveChangesAsync(ct);
    }
}
