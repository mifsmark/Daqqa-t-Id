using DaqqaTid.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using NetTopologySuite.Geometries;

namespace DaqqaTid.Infrastructure;

public static class DatabaseSeeder
{
    private static readonly (string Name, double Lat, double Lon)[] Places =
    [("Valletta", 35.8992, 14.5141), ("Sliema", 35.9122, 14.5042), ("St Julian's", 35.9184, 14.4891), ("St. Julian's", 35.9184, 14.4891), ("Swieqi", 35.9200, 14.4800), ("Naxxar", 35.9130, 14.4430), ("Mellieha", 35.9560, 14.3620), ("Mosta", 35.9090, 14.4256), ("Birkirkara", 35.8972, 14.4611), ("Rabat", 35.8815, 14.3988), ("Mdina", 35.8858, 14.4031), ("Marsaxlokk", 35.8417, 14.5447), ("Victoria", 36.0444, 14.2397), ("Xlendi", 36.0296, 14.2170), ("Nadur", 36.0378, 14.2940)];
    private static readonly (string Slug, string Name, string Description, string Icon, bool Regulated, BookingMode[] Modes)[] ServiceCategories =
    [
        ("plumbing", "Plumbing", "Repairs and installations by verified plumbers. Customers cannot participate in hazardous plumbing work.", "wrench", true, [BookingMode.ForMe]),
        ("electrical", "Electrical", "Electrical repairs and installations by verified electricians. Customers cannot participate in electrical work.", "bolt", true, [BookingMode.ForMe]),
        ("cleaning", "Cleaning", "Home and workplace cleaning. WithMe and TeachMe are limited to safe, non-hazardous tasks.", "sparkles", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe]),
        ("handyman", "Handyman", "Minor non-regulated repairs and maintenance. No electrical, plumbing, structural or hazardous work; participation must stay clear of tools and hazards.", "hammer", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe]),
        ("furniture-assembly", "Furniture assembly", "Furniture assembly and setup. TeachMe and WithMe exclude power-tool operation, heavy lifting and hazardous tasks.", "package", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe]),
        ("painting", "Painting", "Interior painting and preparation. Participation is limited to safe, reachable areas without hazardous coatings or equipment.", "paintbrush", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe]),
        ("tiling", "Tiling", "Tile repairs and installation. Cutting, hazardous materials and power-tool operation are worker-only tasks.", "grid-3x3", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe]),
        ("gardening", "Gardening", "Garden care and planting. Power tools, chemicals and other hazardous tasks are worker-only.", "leaf", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe]),
        ("moving-lifting", "Moving and lifting", "Moving assistance and safe lifting support. Heavy or hazardous lifts remain worker-only; TeachMe covers safe planning and technique.", "move", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe]),
        ("home-maintenance", "Home maintenance", "Routine non-regulated home maintenance. No hazardous, structural, plumbing or electrical work; participation stays clear of tools and risks.", "home", false, [BookingMode.ForMe, BookingMode.WithMe, BookingMode.TeachMe])
    ];

    public static async Task SeedReferenceDataAsync(AppDbContext db, CancellationToken ct = default)
    {
        foreach (var (name, lat, lon) in Places)
            if (!await db.Localities.AnyAsync(x => x.Name == name, ct)) db.Localities.Add(new Locality { Name = name, Location = new Point(lon, lat) { SRID = 4326 } });
        foreach (var (slug, name, description, icon, regulated, modes) in ServiceCategories)
        {
            var category = await db.Categories.Include(x => x.Modes).SingleOrDefaultAsync(x => x.Slug == slug, ct);
            if (category is null) db.Categories.Add(new Category { Slug = slug, Name = name, Description = description, Icon = icon, RequiresVerification = regulated, IsActive = true, Modes = modes.Select(mode => new CategoryMode { Mode = mode }).ToList() });
        }
        if (!await db.Settings.AnyAsync(x => x.Id == 1, ct)) db.Settings.Add(new AppSetting { Id = 1, CommissionPercent = 12 });
        await db.SaveChangesAsync(ct);
    }
    public static async Task SeedRolesAsync(RoleManager<IdentityRole<Guid>> roles)
    {
        foreach (var role in new[] { RoleNames.Customer, RoleNames.Worker, RoleNames.Admin })
            if (!await roles.RoleExistsAsync(role))
            {
                var result = await roles.CreateAsync(new IdentityRole<Guid>(role));
                if (!result.Succeeded) throw new InvalidOperationException($"Could not seed role {role}: {string.Join("; ", result.Errors.Select(x => x.Description))}");
            }
    }
    public static async Task SeedBootstrapAdminAsync(UserManager<ApplicationUser> users, IConfiguration configuration)
    {
        var email = configuration["BootstrapAdmin:Email"]?.Trim(); var password = configuration["BootstrapAdmin:Password"];
        if (string.IsNullOrWhiteSpace(email) && string.IsNullOrEmpty(password)) return;
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password)) throw new InvalidOperationException("Bootstrap admin email and password must be configured together.");
        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new ApplicationUser { Id = Guid.NewGuid(), Email = email, UserName = email, DisplayName = "Administrator", EmailConfirmed = true };
            var created = await users.CreateAsync(user, password);
            if (!created.Succeeded) throw new InvalidOperationException($"Could not create bootstrap admin: {string.Join("; ", created.Errors.Select(x => x.Description))}");
        }
        if (user.IsSuspended) throw new InvalidOperationException("Configured bootstrap admin account is suspended.");
        if (!await users.IsInRoleAsync(user, RoleNames.Admin))
        {
            var added = await users.AddToRoleAsync(user, RoleNames.Admin);
            if (!added.Succeeded) throw new InvalidOperationException($"Could not assign bootstrap admin role: {string.Join("; ", added.Errors.Select(x => x.Description))}");
        }
    }
}
