using System.Security.Claims;
using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Threading.RateLimiting;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using DaqqaTid.Application;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? Environment.GetEnvironmentVariable("DAQQATID_SQL_CONNECTION")
    ?? (builder.Environment.IsDevelopment() ? "Server=(localdb)\\mssqllocaldb;Database=DaqqaTid;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True" : null)
    ?? throw new InvalidOperationException("Configure ConnectionStrings:DefaultConnection or DAQQATID_SQL_CONNECTION.");
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connection, sql => sql.UseNetTopologySuite()));
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    foreach (var value in builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
        if (System.Net.IPAddress.TryParse(value, out var ip)) o.KnownProxies.Add(ip);
});
builder.Services.AddIdentity<ApplicationUser, IdentityRole<Guid>>(o =>
{
    o.User.RequireUniqueEmail = true;
    o.Password.RequiredLength = 10;
    o.Password.RequireDigit = true;
    o.Password.RequireUppercase = true;
    o.Password.RequireNonAlphanumeric = false;
    o.Lockout.MaxFailedAccessAttempts = 5;
    o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
}).AddEntityFrameworkStores<AppDbContext>().AddDefaultTokenProviders();
builder.Services.AddAuthorization();
builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "DaqqaTid.Auth"; o.Cookie.HttpOnly = true; o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Lax; o.SlidingExpiration = true; o.ExpireTimeSpan = TimeSpan.FromHours(12);
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAntiforgery(o =>
{
    o.HeaderName = "X-CSRF-TOKEN"; o.Cookie.Name = "DaqqaTid.Csrf"; o.Cookie.HttpOnly = true;
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Lax; o.Cookie.Path = "/";
});
builder.Services.AddScoped<IMarketplaceService, MarketplaceService>();
builder.Services.AddScoped<ISimulatedPaymentLedger, SimulatedPaymentLedger>();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
    o.AddPolicy("api", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
});
builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();
app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["X-Frame-Options"] = "DENY";
        context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        if (context.Request.Path.StartsWithSegments("/api")) context.Response.Headers.CacheControl = "no-store";
        if (!app.Environment.IsDevelopment()) context.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self'; manifest-src 'self'";
        return Task.CompletedTask;
    });
    await next();
});
var seedDemo = app.Environment.IsDevelopment() && app.Configuration.GetValue<bool>("Demo:Enabled");
if (seedDemo || app.Configuration.GetValue<bool>("Database:SeedReferenceDataOnStartup") || !string.IsNullOrWhiteSpace(app.Configuration["BootstrapAdmin:Email"]) || !string.IsNullOrWhiteSpace(app.Configuration["BootstrapAdmin:Password"]))
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (!await db.Database.CanConnectAsync()) throw new InvalidOperationException("Database bootstrap was configured but SQL Server is unavailable.");
    var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
    var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
    await DatabaseSeeder.SeedRolesAsync(roles);
    if (seedDemo || app.Configuration.GetValue<bool>("Database:SeedReferenceDataOnStartup")) await DatabaseSeeder.SeedReferenceDataAsync(db);
    if (seedDemo) await DevDemoSeeder.SeedAsync(db, users);
    await DatabaseSeeder.SeedBootstrapAdminAsync(users, app.Configuration);
}
if (!app.Environment.IsDevelopment()) { app.UseHsts(); app.UseHttpsRedirection(); }
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var error = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    var (status, title) = error switch
    {
        UnauthorizedAccessException => (403, "Forbidden"),
        KeyNotFoundException => (404, "Not found"),
        BookingConcurrencyException or DbUpdateConcurrencyException => (409, "Request conflict"),
        ArgumentException => (400, "Invalid request"),
        InvalidOperationException => (409, "Request conflict"),
        _ => (500, "Server error")
    };
    context.Response.StatusCode = status; context.Response.ContentType = "application/problem+json";
    await context.Response.WriteAsJsonAsync(new { title, detail = status == 500 ? "The request could not be completed." : error?.Message, status });
}));
app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
app.Use(async (ctx, next) =>
{
    if (ctx.User.Identity?.IsAuthenticated == true && ctx.Request.Path.StartsWithSegments("/api") && !ctx.Request.Path.Equals("/api/session"))
    {
        var users = ctx.RequestServices.GetRequiredService<UserManager<ApplicationUser>>(); var user = await users.GetUserAsync(ctx.User);
        if (user is null || user.IsSuspended) { await ctx.SignOutAsync(); ctx.Response.StatusCode = 403; return; }
    }
    await next();
});

// Antiforgery validates every cookie-authenticated state change, including auth endpoints.
app.Use(async (ctx, next) =>
{
    if (HttpMethods.IsPost(ctx.Request.Method) || HttpMethods.IsPut(ctx.Request.Method) || HttpMethods.IsDelete(ctx.Request.Method) || HttpMethods.IsPatch(ctx.Request.Method))
    {
        try { await ctx.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(ctx); }
        catch (AntiforgeryValidationException) { ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { title = "CSRF validation failed", status = 400 }); return; }
    }
    await next();
});

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (AppDbContext db, CancellationToken ct) => await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));
if (app.Environment.IsDevelopment()) app.MapOpenApi("/openapi/v1.json");

var api = app.MapGroup("/api").RequireRateLimiting("api");
api.AddEndpointFilter(async (context, next) =>
{
    var errors = new Dictionary<string, string[]>();
    foreach (var argument in context.Arguments)
        if (argument is not null && (argument is CreateBookingRequest || argument.GetType().GetCustomAttribute<ApiRequestAttribute>() is not null))
            ApiRequestValidator.Validate(argument, errors);
    return errors.Count > 0 ? Results.ValidationProblem(errors) : await next(context);
});
api.MapMediaEndpoints();
api.MapPasswordRecovery();
api.MapGet("/session", async (HttpContext ctx, IConfiguration cfg, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, IAntiforgery antiforgery) =>
{
    var token = antiforgery.GetAndStoreTokens(ctx).RequestToken;
    object? user = null;
    if (ctx.User.Identity?.IsAuthenticated == true)
    {
        var current = await users.GetUserAsync(ctx.User);
        if (current is null || current.IsSuspended) await signIn.SignOutAsync();
        else user = new SessionUser(current.Id, current.Email ?? "", current.DisplayName, (await users.GetRolesAsync(current)).FirstOrDefault() ?? "");
    }
    return Results.Ok(new { user, csrfToken = token, demoEnabled = cfg.GetValue<bool>("Demo:Enabled") && ctx.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment() });
});

var auth = api.MapGroup("/auth").RequireRateLimiting("auth");
auth.MapPost("/register", async (RegisterRequest req, UserManager<ApplicationUser> users, RoleManager<IdentityRole<Guid>> roles, SignInManager<ApplicationUser> signIn, AppDbContext db, CancellationToken ct) =>
{
    if (!Enum.TryParse<UserRole>(req.Role, true, out var role) || !Enum.IsDefined(role) || role == UserRole.Admin) return Results.BadRequest(new { title = "Invalid role", status = 400 });
    if (!await db.Localities.AnyAsync(x => x.Name == req.Locality.Trim(), ct)) return Results.BadRequest(new { title = "Choose a supported Malta or Gozo locality", status = 400 });
    var user = new ApplicationUser { UserName = req.Email.Trim(), Email = req.Email.Trim(), DisplayName = req.DisplayName.Trim(), PhoneNumber = req.Phone.Trim(), Locality = req.Locality.Trim() };
    var result = await users.CreateAsync(user, req.Password);
    if (!result.Succeeded) return Results.ValidationProblem(result.Errors.ToDictionary(x => x.Code, x => new[] { x.Description }));
    if (!await roles.RoleExistsAsync(role.ToString())) await roles.CreateAsync(new IdentityRole<Guid>(role.ToString()));
    await users.AddToRoleAsync(user, role.ToString());
    if (role == UserRole.Worker) db.Workers.Add(new WorkerProfile { UserId = user.Id, DisplayName = user.DisplayName, Locality = user.Locality, VerificationStatus = VerificationStatus.Unverified });
    await db.SaveChangesAsync(ct); await signIn.SignInAsync(user, isPersistent: false);
    return Results.Ok(new SessionUser(user.Id, user.Email!, user.DisplayName, role.ToString()));
});
auth.MapPost("/login", async (LoginRequest req, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn) =>
{
    var user = await users.FindByEmailAsync(req.Email.Trim());
    if (user is null || user.IsSuspended) return Results.Unauthorized();
    var result = await signIn.PasswordSignInAsync(user, req.Password, false, true);
    if (!result.Succeeded) return Results.Unauthorized();
    var roles = await users.GetRolesAsync(user); return Results.Ok(new SessionUser(user.Id, user.Email!, user.DisplayName, roles.FirstOrDefault() ?? "Customer"));
});
auth.MapPost("/logout", async (SignInManager<ApplicationUser> signIn) => { await signIn.SignOutAsync(); return Results.NoContent(); });
auth.MapPost("/demo", async (DemoRequest req, IConfiguration cfg, IWebHostEnvironment env, UserManager<ApplicationUser> users, RoleManager<IdentityRole<Guid>> roles, SignInManager<ApplicationUser> signIn, AppDbContext db, CancellationToken ct) =>
{
    if (!cfg.GetValue<bool>("Demo:Enabled") || !env.IsDevelopment()) return Results.NotFound();
    var persona = req.Persona.Trim().ToLowerInvariant();
    var role = persona switch { "customer" => RoleNames.Customer, "worker" => RoleNames.Worker, "admin" => RoleNames.Admin, _ => "" };
    if (role.Length == 0) return Results.BadRequest(new { title = "Unknown demo persona", status = 400 });
    var email = $"demo.{persona}@daqqatid.local";
    var user = await users.FindByEmailAsync(email);
    if (user is null)
    {
        user = new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true, DisplayName = persona switch { "customer" => "Mara Vella", "worker" => "Noah Borg", _ => "Alex Mifsud" }, PhoneNumber = "+356 7900 0000", Locality = "Valletta" };
        var created = await users.CreateAsync(user, Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(36)) + "aA1!");
        if (!created.Succeeded) return Results.Problem("Could not create development persona.", statusCode: 500);
    }
    if (!await roles.RoleExistsAsync(role)) await roles.CreateAsync(new IdentityRole<Guid>(role));
    if (!await users.IsInRoleAsync(user, role)) await users.AddToRoleAsync(user, role);
    if (persona == "worker" && !await db.Workers.AnyAsync(x => x.UserId == user.Id, ct)) db.Workers.Add(new WorkerProfile { UserId = user.Id, DisplayName = user.DisplayName, Locality = user.Locality, Bio = "Development persona", VerificationStatus = VerificationStatus.Unverified, IsDemo = true });
    if (persona == "admin") db.AuditEntries.Add(new AuditEntry { ActorId = user.Id, Action = "demo.admin.signin", Details = "Development demo", CreatedAt = DateTimeOffset.UtcNow });
    await db.SaveChangesAsync(ct); await signIn.SignInAsync(user, false); return Results.Ok(new SessionUser(user.Id, email, user.DisplayName, role));
});

api.MapGet("/catalog", async (AppDbContext db, CancellationToken ct) => await db.Categories.Where(x => x.IsActive).Include(x => x.Modes).OrderBy(x => x.Name).Select(x => new { x.Id, x.Slug, x.Name, x.Description, x.Icon, modes = x.Modes.Select(m => m.Mode), x.RequiresVerification, x.IsActive }).ToListAsync(ct));
api.MapGet("/localities", async (AppDbContext db, CancellationToken ct) => await db.Localities.AsNoTracking().OrderBy(x => x.Name).Select(x => new { name = x.Name, latitude = x.Location.Y, longitude = x.Location.X }).ToListAsync(ct));
api.MapGet("/workers", async (AppDbContext db, string? categoryId, string? mode, string? locality, bool? availableNow, decimal? maxPrice, string? startAt, int? durationMinutes, CancellationToken ct) =>
{
    var q = db.Workers.AsNoTracking().Include(x => x.Offerings).ThenInclude(x => x.Modes).Include(x => x.Offerings).ThenInclude(x => x.Category).Include(x => x.Reviews).Where(x => x.VerificationStatus != VerificationStatus.Suspended);
    var hasCategory = Guid.TryParse(categoryId, out var cid);
    var hasMode = Enum.TryParse<BookingMode>(mode, true, out var bm);
    if (hasCategory && hasMode) q = q.Where(x => x.Offerings.Any(o => o.CategoryId == cid && o.Modes.Any(m => m.Mode == bm)));
    else if (hasCategory) q = q.Where(x => x.Offerings.Any(o => o.CategoryId == cid));
    else if (hasMode) q = q.Where(x => x.Offerings.Any(o => o.Modes.Any(m => m.Mode == bm)));
    q = q.Where(x => db.Users.Any(u => u.Id == x.UserId && !u.IsSuspended)).Include(x => x.Availability).Include(x => x.Exceptions);
    if (availableNow == true) q = q.Where(x => x.AvailableNow);
    if (maxPrice.HasValue) q = q.Where(x => x.HourlyRate <= maxPrice);
    var rows = await q.OrderBy(x => x.DisplayName).ToListAsync(ct);
    rows = rows.Where(w => w.Offerings.Any(o => o.Category is { IsActive: true } c && (!c.RequiresVerification || w.VerificationStatus == VerificationStatus.Verified))).ToList();
    if (hasCategory)
    {
        var category = await db.Categories.AsNoTracking().SingleOrDefaultAsync(x => x.Id == cid, ct);
        if (category is null || !category.IsActive) return Array.Empty<object>();
        if (category.RequiresVerification) rows = rows.Where(x => x.VerificationStatus == VerificationStatus.Verified).ToList();
    }
    if (DateTimeOffset.TryParse(startAt, out var start) && durationMinutes is > 0 and <= 720)
    {
        var startUtc = start.ToUniversalTime(); var endUtc = startUtc.AddMinutes(durationMinutes.Value);
        rows = rows.Where(x => WorkerMatching.IsAvailableAt(x, startUtc, endUtc)).ToList();
        var busy = await db.Bookings.Where(b => (b.Status == BookingStatus.WorkerAccepted || b.Status == BookingStatus.Confirmed || b.Status == BookingStatus.InProgress) && b.StartAt < endUtc && startUtc < b.EndAt).Select(b => b.WorkerId).Distinct().ToListAsync(ct);
        rows = rows.Where(x => !busy.Contains(x.Id)).ToList();
    }
    if (!string.IsNullOrWhiteSpace(locality))
    {
        var places = await db.Localities.AsNoTracking().ToDictionaryAsync(x => x.Name, x => (Latitude: x.Location.Y, Longitude: x.Location.X), ct);
        if (!places.TryGetValue(locality, out var origin)) return Array.Empty<object>();
        rows = rows.Where(x => places.TryGetValue(x.Locality, out var point) && WorkerMatching.DistanceKm(origin.Latitude, origin.Longitude, point.Latitude, point.Longitude) <= x.RadiusKm).ToList();
    }
    return rows.Select(x => WorkerView(x, false));
});
api.MapGet("/workers/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
{
    var w = await db.Workers.AsNoTracking().Include(x => x.Offerings).ThenInclude(x => x.Modes).Include(x => x.Offerings).ThenInclude(x => x.Category).Include(x => x.Availability).Include(x => x.Exceptions).Include(x => x.Reviews).SingleOrDefaultAsync(x => x.Id == id && x.VerificationStatus != VerificationStatus.Suspended && db.Users.Any(u => u.Id == x.UserId && !u.IsSuspended), ct);
    if (w is null) return Results.NotFound();
    var reviews = await (from r in db.Reviews join u in db.Users on r.CustomerId equals u.Id where r.WorkerId == w.Id orderby r.CreatedAt descending select new { r.Id, r.Rating, r.Comment, customerName = u.DisplayName, r.CreatedAt }).ToListAsync(ct);
    return Results.Ok(new { id = w.Id, userId = w.UserId, displayName = w.DisplayName, bio = w.Bio, locality = w.Locality, yearsExperience = w.YearsExperience, verificationStatus = w.VerificationStatus, availableNow = w.AvailableNow, availabilityUpdatedAt = w.AvailabilityUpdatedAt, isDemo = w.IsDemo, hourlyRate = w.HourlyRate, pricingType = w.PricingType, categoryIds = w.Offerings.Select(x => x.CategoryId.ToString()), modes = w.Offerings.SelectMany(x => x.Modes).Select(x => x.Mode).Distinct(), radiusKm = w.RadiusKm, reviewCount = w.Reviews.Count, averageRating = w.Reviews.Count == 0 ? (double?)null : w.Reviews.Average(x => (double)x.Rating), offerings = w.Offerings.Select(o => new { o.CategoryId, modes = o.Modes.Select(m => m.Mode), pricingType = o.PricingType, price = o.Price }), availability = w.Availability, reviews });
});

api.MapGet("/me", async (ClaimsPrincipal p, UserManager<ApplicationUser> users) => { if (!p.Identity!.IsAuthenticated) return Results.Unauthorized(); var u = await users.GetUserAsync(p); if (u is null || u.IsSuspended) return Results.Forbid(); return Results.Ok(UserView(u, Role(p))); }).RequireAuthorization();
api.MapPut("/me", async (UpdateMeRequest r, ClaimsPrincipal p, UserManager<ApplicationUser> users, AppDbContext db, CancellationToken ct) => { if (!await db.Localities.AnyAsync(x => x.Name == r.Locality.Trim(), ct)) return Results.BadRequest(new { title = "Choose a supported Malta or Gozo locality", status = 400 }); var u = await users.GetUserAsync(p); if (u is null || u.IsSuspended) return Results.Forbid(); u.DisplayName = r.DisplayName.Trim(); u.PhoneNumber = r.Phone.Trim(); u.Locality = r.Locality.Trim(); var result = await users.UpdateAsync(u); if (!result.Succeeded) return Results.ValidationProblem(result.Errors.ToDictionary(e => e.Code, e => new[] { e.Description })); return Results.Ok(UserView(u, Role(p))); }).RequireAuthorization();
api.MapGet("/me/addresses", async (ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Customer) return Results.Forbid(); var uid = UserId(p); return Results.Ok(await db.Addresses.AsNoTracking().Where(x => x.UserId == uid).ToListAsync(ct)); }).RequireAuthorization();
api.MapPost("/me/addresses", async (AddressRequest r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Customer) return Results.Forbid(); if (!await db.Localities.AnyAsync(x => x.Name == r.Locality.Trim(), ct)) return Results.BadRequest(new { title = "Choose a supported Malta or Gozo locality", status = 400 }); var a = new CustomerAddress { UserId = UserId(p), Label = r.Label.Trim(), Address = r.Address.Trim(), Locality = r.Locality.Trim() }; db.Addresses.Add(a); await db.SaveChangesAsync(ct); return Results.Created($"/api/me/addresses/{a.Id}", a); }).RequireAuthorization();
api.MapDelete("/me/addresses/{id:guid}", async (Guid id, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Customer) return Results.Forbid(); var uid = UserId(p); var a = await db.Addresses.SingleOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct); if (a is null) return Results.NotFound(); db.Remove(a); await db.SaveChangesAsync(ct); return Results.NoContent(); }).RequireAuthorization();
api.MapPost("/me/privacy-request", async (PrivacyRequestInput r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) is not (RoleNames.Customer or RoleNames.Worker)) return Results.Forbid(); if (r.Kind is not ("Export" or "Delete")) return Results.BadRequest(); var x = new PrivacyRequest { UserId = UserId(p), Kind = r.Kind, CreatedAt = DateTimeOffset.UtcNow }; db.PrivacyRequests.Add(x); await db.SaveChangesAsync(ct); return Results.Ok(new { message = "Your privacy request has been recorded." }); }).RequireAuthorization();

api.MapGet("/bookings", async (ClaimsPrincipal p, IMarketplaceService svc, UserManager<ApplicationUser> users, AppDbContext db, CancellationToken ct) =>
{
    if (!await ActiveUser(p, users)) return Results.Forbid();
    var bookings = await svc.GetBookingsAsync(UserId(p), Role(p), ct); var views = new List<object>(bookings.Count);
    foreach (var booking in bookings) views.Add(await BookingView(booking, Role(p), db, ct));
    return Results.Ok(views);
}).RequireAuthorization();
api.MapGet("/bookings/{id:guid}", async (Guid id, ClaimsPrincipal p, IMarketplaceService svc, UserManager<ApplicationUser> users, AppDbContext db, CancellationToken ct) => await ActiveUser(p, users) ? Results.Ok(await BookingView(await svc.GetBookingAsync(UserId(p), Role(p), id, ct), Role(p), db, ct)) : Results.Forbid()).RequireAuthorization();
api.MapPost("/bookings", async (CreateBookingRequest r, ClaimsPrincipal p, UserManager<ApplicationUser> users, IMarketplaceService svc, AppDbContext db, CancellationToken ct) => await ActiveUser(p, users) && Role(p) == RoleNames.Customer ? Results.Ok(await BookingView(await svc.CreateBookingAsync(UserId(p), r, ct), Role(p), db, ct)) : Results.Forbid()).RequireAuthorization();
api.MapPost("/bookings/{id:guid}/action", async (Guid id, BookingActionRequest r, ClaimsPrincipal p, UserManager<ApplicationUser> users, IMarketplaceService svc, AppDbContext db, CancellationToken ct) => !new[] { "accept", "decline", "quote", "confirm", "start", "complete", "cancel" }.Contains(r.Action?.ToLowerInvariant()) ? Results.BadRequest(new { title = "Unknown booking action", status = 400 }) : await ActiveUser(p, users) ? Results.Ok(await BookingView(await svc.ActAsync(UserId(p), Role(p), id, r, ct), Role(p), db, ct)) : Results.Forbid()).RequireAuthorization();
api.MapPost("/bookings/{id:guid}/review", async (Guid id, ReviewInput r, ClaimsPrincipal p, UserManager<ApplicationUser> users, IMarketplaceService svc, CancellationToken ct) => await ActiveUser(p, users) && Role(p) == RoleNames.Customer ? Results.Ok(await svc.ReviewAsync(UserId(p), id, r.Rating, r.Comment, ct)) : Results.Forbid()).RequireAuthorization();

api.MapGet("/worker/profile", async (ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Worker) return Results.Forbid(); var uid = UserId(p); var x = await db.Workers.Include(x => x.Offerings).ThenInclude(x => x.Modes).Include(x => x.Availability).Include(x => x.Exceptions).Include(x => x.Reviews).SingleOrDefaultAsync(x => x.UserId == uid, ct); return x is null ? Results.NotFound() : Results.Ok(WorkerView(x, true)); }).RequireAuthorization();
api.MapPut("/worker/profile", async (WorkerProfileInput r, ClaimsPrincipal p, UserManager<ApplicationUser> users, AppDbContext db, CancellationToken ct) =>
{
    if (Role(p) != RoleNames.Worker || !await ActiveUser(p, users)) return Results.Forbid();
    if (r.YearsExperience is < 0 or > 100 || r.RadiusKm is < 1 or > 200 || r.HourlyRate is < 0 or > 100000 || r.CategoryIds.Length is < 1 or > 30 || r.Modes.Length is < 1 or > 3) return Results.BadRequest(new { title = "Profile values are out of range", status = 400 });
    var categories = await db.Categories.Include(x => x.Modes).Where(x => r.CategoryIds.Contains(x.Id) && x.IsActive).ToListAsync(ct);
    if (categories.Count != r.CategoryIds.Distinct().Count() || categories.Any(c => !r.Modes.Any(m => c.Modes.Any(cm => cm.Mode == m)))) return Results.BadRequest(new { title = "Selected category or mode is unavailable", status = 400 });
    if (!await db.Localities.AnyAsync(x => x.Name == r.Locality.Trim(), ct)) return Results.BadRequest(new { title = "Choose a supported Malta or Gozo locality", status = 400 });
    var uid = UserId(p); var w = await db.Workers.Include(x => x.Offerings).ThenInclude(x => x.Modes).SingleOrDefaultAsync(x => x.UserId == uid, ct); if (w is null) return Results.NotFound();
    await using var transaction = await db.Database.BeginTransactionAsync(ct);
    w.DisplayName = r.DisplayName.Trim(); w.Bio = r.Bio.Trim(); w.Locality = r.Locality.Trim(); w.YearsExperience = r.YearsExperience; w.RadiusKm = r.RadiusKm; w.HourlyRate = r.HourlyRate; w.PricingType = r.PricingType;
    var oldOfferings = w.Offerings.ToList();
    db.Offerings.RemoveRange(oldOfferings);
    var u = await users.FindByIdAsync(uid.ToString());
    if (u is not null) { u.DisplayName = r.DisplayName.Trim(); u.Locality = r.Locality.Trim(); }
    // Delete the existing unique (WorkerId, CategoryId) rows before inserting replacements.
    // AddRange marks the new principals and their modes Added; UserManager.UpdateAsync here
    // would attach the tracked user graph and could incorrectly mark those rows Unchanged.
    await db.SaveChangesAsync(ct);
    var newOfferings = categories.Select(c => new Offering { WorkerId = w.Id, CategoryId = c.Id, PricingType = r.PricingType, Price = r.HourlyRate, Modes = r.Modes.Where(m => c.Modes.Any(cm => cm.Mode == m)).Distinct().Select(m => new OfferingMode { Mode = m }).ToList() }).ToList();
    w.Offerings = newOfferings;
    db.Offerings.AddRange(newOfferings);
    await db.SaveChangesAsync(ct);
    await transaction.CommitAsync(ct);
    return Results.Ok(WorkerView(w, true));
}).RequireAuthorization();
api.MapPut("/worker/availability", async (AvailabilityInput r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) =>
{
    if (Role(p) != RoleNames.Worker) return Results.Forbid(); var uid = UserId(p); var w = await db.Workers.SingleOrDefaultAsync(x => x.UserId == uid, ct); if (w is null) return Results.NotFound();
    if (r.Windows.Any(x => x.DayOfWeek is < 0 or > 6 || !TimeOnly.TryParse(x.StartTime, out var from) || !TimeOnly.TryParse(x.EndTime, out var to) || from >= to) || r.Exceptions.Any(x => !DateOnly.TryParse(x.Date, out _)) || r.Exceptions.GroupBy(x => x.Date).Any(g => g.Count() > 1) || r.Windows.GroupBy(x => (x.DayOfWeek, x.StartTime, x.EndTime)).Any(g => g.Count() > 1)) return Results.BadRequest(new { title = "Invalid availability schedule", status = 400 });
    await using var transaction = await db.Database.BeginTransactionAsync(ct);
    w.AvailableNow = r.AvailableNow; w.AvailabilityUpdatedAt = DateTimeOffset.UtcNow;
    db.AvailabilityWindows.RemoveRange(db.AvailabilityWindows.Where(x => x.WorkerId == w.Id)); db.AvailabilityExceptions.RemoveRange(db.AvailabilityExceptions.Where(x => x.WorkerId == w.Id));
    await db.SaveChangesAsync(ct);
    db.AvailabilityWindows.AddRange(r.Windows.Select(x => new AvailabilityWindow { WorkerId = w.Id, DayOfWeek = (DayOfWeek)x.DayOfWeek, StartTime = TimeOnly.Parse(x.StartTime), EndTime = TimeOnly.Parse(x.EndTime) }));
    db.AvailabilityExceptions.AddRange(r.Exceptions.Select(x => new AvailabilityException { WorkerId = w.Id, Date = DateOnly.Parse(x.Date), IsAvailable = x.IsAvailable })); await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return Results.Ok(new { w.AvailableNow, w.AvailabilityUpdatedAt, windows = r.Windows, exceptions = r.Exceptions });
}).RequireAuthorization();
api.MapPost("/worker/verification", async (VerificationInput r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Worker) return Results.Forbid(); if (string.IsNullOrWhiteSpace(r.Reference) || r.Reference.Length > 200 || r.Notes.Length > 2000) return Results.BadRequest(new { title = "Invalid verification submission", status = 400 }); var uid = UserId(p); var w = await db.Workers.SingleOrDefaultAsync(x => x.UserId == uid, ct); if (w is null) return Results.NotFound(); w.VerificationReference = r.Reference.Trim(); w.VerificationNotes = r.Notes.Trim(); w.VerificationStatus = VerificationStatus.Pending; await db.SaveChangesAsync(ct); return Results.Ok(new { w.VerificationStatus }); }).RequireAuthorization();

var admin = api.MapGroup("/admin").RequireAuthorization(policy => policy.RequireRole(RoleNames.Admin));
admin.MapGet("/workers", async (AppDbContext db, CancellationToken ct) => (await db.Workers.AsNoTracking().Include(x => x.Offerings).ThenInclude(x => x.Modes).Include(x => x.Reviews).ToListAsync(ct)).Select(x => new { id = x.Id, userId = x.UserId, displayName = x.DisplayName, bio = x.Bio, locality = x.Locality, yearsExperience = x.YearsExperience, verificationStatus = x.VerificationStatus, availableNow = x.AvailableNow, availabilityUpdatedAt = x.AvailabilityUpdatedAt, isDemo = x.IsDemo, hourlyRate = x.HourlyRate, pricingType = x.PricingType, categoryIds = x.Offerings.Select(o => o.CategoryId.ToString()), modes = x.Offerings.SelectMany(o => o.Modes).Select(m => m.Mode).Distinct(), reviewCount = x.Reviews.Count, averageRating = x.Reviews.Count == 0 ? (double?)null : x.Reviews.Average(r => (double)r.Rating), verificationReference = x.VerificationReference, verificationNotes = x.VerificationNotes }));
admin.MapPost("/workers/{id:guid}/verification", async (Guid id, AdminVerification r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Admin) return Results.Forbid(); if (!Enum.TryParse<VerificationStatus>(r.Status, true, out var status) || status is not (VerificationStatus.Verified or VerificationStatus.Rejected or VerificationStatus.Suspended)) return Results.BadRequest(); var w = await db.Workers.FindAsync([id], ct); if (w is null) return Results.NotFound(); w.VerificationStatus = status; db.AuditEntries.Add(new AuditEntry { ActorId = UserId(p), Action = "worker.verification", Details = $"{id}:{status}", CreatedAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync(ct); return Results.Ok(new { w.Id, w.VerificationStatus }); });
admin.MapGet("/users", async (UserManager<ApplicationUser> users) => { var list = await users.Users.ToListAsync(); var output = new List<object>(); foreach (var u in list) output.Add(new { id = u.Id, email = u.Email, displayName = u.DisplayName, role = (await users.GetRolesAsync(u)).FirstOrDefault() ?? "", isSuspended = u.IsSuspended }); return output; });
admin.MapPost("/users/{id:guid}/status", async (Guid id, UserStatusInput r, ClaimsPrincipal p, UserManager<ApplicationUser> users, AppDbContext db) => { if (Role(p) != RoleNames.Admin) return Results.Forbid(); var u = await users.FindByIdAsync(id.ToString()); if (u is null) return Results.NotFound(); u.IsSuspended = r.IsSuspended; await users.UpdateAsync(u); db.AuditEntries.Add(new AuditEntry { ActorId = UserId(p), Action = "user.suspension", Details = $"{id}:{r.IsSuspended}", CreatedAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync(); return Results.Ok(new { id, u.IsSuspended }); });
admin.MapGet("/categories", async (AppDbContext db, CancellationToken ct) => await db.Categories.Include(x => x.Modes).OrderBy(x => x.Name).Select(x => new { x.Id, x.Slug, x.Name, x.Description, x.Icon, modes = x.Modes.Select(m => m.Mode), x.RequiresVerification, x.IsActive }).ToListAsync(ct));
admin.MapPost("/categories", async (CategoryInput r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Admin) return Results.Forbid(); if (r.Modes.Length == 0 || (r.RequiresVerification && r.Modes.Any(m => m != BookingMode.ForMe))) return Results.BadRequest(new { title = "Regulated categories can only allow ForMe", status = 400 }); var c = ToCategory(r); db.Categories.Add(c); db.AuditEntries.Add(new AuditEntry { ActorId = UserId(p), Action = "category.create", Details = c.Slug }); await db.SaveChangesAsync(ct); return Results.Created($"/api/catalog/{c.Id}", c); });
admin.MapPut("/categories/{id:guid}", async (Guid id, CategoryInput r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) =>
{
    if (Role(p) != RoleNames.Admin) return Results.Forbid();
    if (r.Modes.Length == 0 || (r.RequiresVerification && r.Modes.Any(m => m != BookingMode.ForMe))) return Results.BadRequest(new { title = "Regulated categories can only allow ForMe", status = 400 });
    var c = await db.Categories.Include(x => x.Modes).SingleOrDefaultAsync(x => x.Id == id, ct);
    if (c is null) return Results.NotFound();
    await using var transaction = await db.Database.BeginTransactionAsync(ct);
    c.Name = r.Name.Trim(); c.Slug = r.Slug.Trim(); c.Description = r.Description.Trim(); c.Icon = r.Icon.Trim(); c.RequiresVerification = r.RequiresVerification; c.IsActive = r.IsActive;
    db.CategoryModes.RemoveRange(c.Modes);
    // CategoryMode has a composite key, so delete the prior set before inserting its replacement.
    await db.SaveChangesAsync(ct);
    var newModes = r.Modes.Distinct().Select(m => new CategoryMode { CategoryId = c.Id, Mode = m }).ToList();
    c.Modes = newModes;
    db.CategoryModes.AddRange(newModes);
    db.AuditEntries.Add(new AuditEntry { ActorId = UserId(p), Action = "category.update", Details = c.Slug });
    await db.SaveChangesAsync(ct);
    await transaction.CommitAsync(ct);
    return Results.Ok(c);
});
admin.MapPut("/settings", async (SettingsInput r, ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => { if (Role(p) != RoleNames.Admin) return Results.Forbid(); if (r.CommissionPercent is < 0 or > 100) return Results.BadRequest(); var s = await db.Settings.SingleOrDefaultAsync(x => x.Id == 1, ct); if (s is null) { s = new AppSetting(); db.Settings.Add(s); } s.CommissionPercent = r.CommissionPercent; db.AuditEntries.Add(new AuditEntry { ActorId = UserId(p), Action = "settings.commission", Details = r.CommissionPercent.ToString("0.##") }); await db.SaveChangesAsync(ct); return Results.Ok(new { s.CommissionPercent }); });
admin.MapGet("/audit", async (ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => Role(p) == RoleNames.Admin ? Results.Ok(await db.AuditEntries.OrderByDescending(x => x.CreatedAt).ToListAsync(ct)) : Results.Forbid());
admin.MapGet("/payments", async (ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => Role(p) == RoleNames.Admin ? Results.Ok(await db.Payments.OrderByDescending(x => x.CreatedAt).ToListAsync(ct)) : Results.Forbid());
admin.MapGet("/privacy-requests", async (ClaimsPrincipal p, AppDbContext db, CancellationToken ct) => Role(p) == RoleNames.Admin ? Results.Ok(await db.PrivacyRequests.OrderBy(x => x.CreatedAt).ToListAsync(ct)) : Results.Forbid());
admin.MapGet("/overview", async (ClaimsPrincipal p, AppDbContext db, CancellationToken ct) =>
{
    if (Role(p) != RoleNames.Admin) return Results.Forbid();
    var counts = new Dictionary<BookingStatus, int>(); foreach (var s in Enum.GetValues<BookingStatus>()) counts[s] = await db.Bookings.CountAsync(x => x.Status == s, ct);
    var customerRole = await db.Roles.Where(x => x.Name == RoleNames.Customer).Select(x => (Guid?)x.Id).SingleOrDefaultAsync(ct);
    var customers = customerRole is null ? 0 : await db.UserRoles.CountAsync(x => x.RoleId == customerRole, ct);
    return Results.Ok(new { customers, workers = await db.Workers.CountAsync(ct), pendingVerifications = await db.Workers.CountAsync(x => x.VerificationStatus == VerificationStatus.Pending, ct), openRequests = counts[BookingStatus.Requested], confirmedBookings = counts[BookingStatus.Confirmed], completedBookings = counts[BookingStatus.Completed], cancelledBookings = counts[BookingStatus.Cancelled], simulatedGross = await db.Payments.SumAsync(x => (decimal?)x.Amount, ct) ?? 0, simulatedCommission = await db.Payments.SumAsync(x => (decimal?)x.CommissionAmount, ct) ?? 0, commissionPercent = await db.Settings.Select(x => (decimal?)x.CommissionPercent).FirstOrDefaultAsync(ct) ?? 12 });
});

// Serve the production React bundle from wwwroot and let the client router handle app routes.
app.MapMarketplaceSeo();
app.UseDefaultFiles(); app.UseStaticFiles();
app.MapFallback(async (HttpContext context, IWebHostEnvironment environment) =>
{
    var path = context.Request.Path.Value ?? "/";
    var appRoutes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    { "/find", "/login", "/register", "/forgot-password", "/reset-password", "/dashboard", "/worker", "/account", "/admin", "/privacy", "/terms", "/bookings/new" };
    var isBooking = path.StartsWith("/bookings/", StringComparison.OrdinalIgnoreCase) && Guid.TryParse(path[10..], out _);
    if (!appRoutes.Contains(path) && !isBooking) { context.Response.StatusCode = 404; return; }
    var index = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "index.html");
    if (!File.Exists(index)) { context.Response.StatusCode = 503; return; }
    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(index, context.RequestAborted);
});

// Helpers keep role and suspension checks consistent across all protected routes.
static Guid UserId(ClaimsPrincipal user) => Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
static string Role(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Role) ?? "";
static async Task<bool> ActiveUser(ClaimsPrincipal p, UserManager<ApplicationUser> users) { var u = await users.GetUserAsync(p); return u is not null && !u.IsSuspended; }
static object UserView(ApplicationUser u, string role) => new { id = u.Id, email = u.Email, displayName = u.DisplayName, phone = u.PhoneNumber, locality = u.Locality, role };
static object WorkerView(WorkerProfile w, bool detail) => new { id = w.Id, userId = w.UserId, displayName = w.DisplayName, bio = w.Bio, locality = w.Locality, yearsExperience = w.YearsExperience, verificationStatus = w.VerificationStatus, availableNow = w.AvailableNow, availabilityUpdatedAt = w.AvailabilityUpdatedAt, isDemo = w.IsDemo, hourlyRate = w.HourlyRate, pricingType = w.PricingType, categoryIds = w.Offerings.Select(x => x.CategoryId.ToString()), modes = w.Offerings.SelectMany(x => x.Modes).Select(x => x.Mode).Distinct(), reviewCount = w.Reviews.Count, averageRating = w.Reviews.Count == 0 ? (double?)null : w.Reviews.Average(x => (double)x.Rating), radiusKm = detail ? w.RadiusKm : (double?)null, offerings = detail ? w.Offerings.Select(o => new { o.CategoryId, modes = o.Modes.Select(m => m.Mode), pricingType = o.PricingType, price = o.Price }) : null, availability = detail ? w.Availability : null, exceptions = detail ? w.Exceptions.Select(e => new { date = e.Date.ToString("yyyy-MM-dd"), e.IsAvailable }) : null };
static async Task<object> BookingView(Booking b, string role, AppDbContext db, CancellationToken ct)
{
    var worker = await db.Workers.Where(x => x.Id == b.WorkerId).Select(x => x.DisplayName).SingleOrDefaultAsync(ct) ?? "";
    var customer = await db.Users.Where(x => x.Id == b.CustomerId).Select(x => x.DisplayName).SingleOrDefaultAsync(ct) ?? "";
    var category = await db.Categories.Where(x => x.Id == b.CategoryId).Select(x => x.Name).SingleOrDefaultAsync(ct) ?? "";
    var review = await db.Reviews.Where(x => x.BookingId == b.Id).Select(x => new { x.Id, x.Rating, x.Comment, x.CreatedAt }).SingleOrDefaultAsync(ct);
    return new { b.Id, b.CustomerId, b.WorkerId, workerName = worker, customerName = customer, b.CategoryId, categoryName = category, b.Mode, b.Summary, b.Description, b.Locality, address = role == RoleNames.Admin || role == RoleNames.Customer || b.Status is BookingStatus.Confirmed or BookingStatus.InProgress or BookingStatus.Completed ? b.PrivateAddress : null, b.StartAt, b.EndAt, b.Status, b.PricingType, b.Amount, b.CommissionAmount, isSimulated = true, b.QuoteAmount, history = b.History.Select(x => new { x.Status, x.At }), review };
}
static Category ToCategory(CategoryInput r) => new() { Name = r.Name.Trim(), Slug = r.Slug.Trim(), Description = r.Description.Trim(), Icon = r.Icon.Trim(), RequiresVerification = r.RequiresVerification, IsActive = r.IsActive, Modes = r.Modes.Distinct().Select(m => new CategoryMode { Mode = m }).ToList() };

app.Run();

public partial class Program { }
[ApiRequest] public sealed record RegisterRequest([property: Required, EmailAddress, StringLength(254)] string Email, [property: Required, MinLength(10), MaxLength(128)] string Password, [property: Required, StringLength(100, MinimumLength = 2)] string DisplayName, [property: Required, StringLength(40, MinimumLength = 6)] string Phone, [property: Required, StringLength(100)] string Locality, [property: Required, StringLength(20)] string Role);
[ApiRequest] public sealed record LoginRequest([property: Required, EmailAddress, StringLength(254)] string Email, [property: Required] string Password);
[ApiRequest] public sealed record DemoRequest([property: Required, StringLength(20)] string Persona);
public sealed record SessionUser(Guid Id, string Email, string DisplayName, string Role);
[ApiRequest] public sealed record UpdateMeRequest([property: Required, StringLength(100, MinimumLength = 2)] string DisplayName, [property: Required, StringLength(40, MinimumLength = 6)] string Phone, [property: Required, StringLength(100)] string Locality);
[ApiRequest] public sealed record AddressRequest([property: Required, StringLength(40)] string Label, [property: Required, StringLength(500)] string Address, [property: Required, StringLength(100)] string Locality);
[ApiRequest] public sealed record ReviewInput([property: Range(1, 5)] int Rating, [property: StringLength(2000)] string? Comment);
[ApiRequest] public sealed record WorkerProfileInput([property: Required, StringLength(100, MinimumLength = 2)] string DisplayName, [property: Required(AllowEmptyStrings = true), StringLength(4000)] string Bio, [property: Required, StringLength(100)] string Locality, [property: Range(0, 80)] int YearsExperience, [property: Range(1, 80)] double RadiusKm, [property: Range(0, 100000)] decimal HourlyRate, [property: Required] Guid[] CategoryIds, [property: Required] BookingMode[] Modes, PricingType PricingType);
[ApiRequest] public sealed record AvailabilityInput(bool AvailableNow, [property: Required] AvailabilityWindowInput[] Windows, [property: Required] AvailabilityExceptionInput[] Exceptions);
[ApiRequest] public sealed record AvailabilityWindowInput([property: Range(0, 6)] int DayOfWeek, [property: Required, StringLength(5)] string StartTime, [property: Required, StringLength(5)] string EndTime);
[ApiRequest] public sealed record AvailabilityExceptionInput([property: Required, StringLength(10)] string Date, bool IsAvailable);
[ApiRequest] public sealed record VerificationInput([property: Required, StringLength(200)] string Reference, [property: Required(AllowEmptyStrings = true), StringLength(2000)] string Notes);
[ApiRequest] public sealed record AdminVerification([property: Required, StringLength(20)] string Status);
[ApiRequest] public sealed record UserStatusInput(bool IsSuspended);
[ApiRequest] public sealed record CategoryInput([property: Required, StringLength(100, MinimumLength = 2)] string Name, [property: Required, RegularExpression("^[a-z0-9]+(?:-[a-z0-9]+)*$"), StringLength(100)] string Slug, [property: Required, StringLength(2000)] string Description, [property: Required, StringLength(100)] string Icon, bool RequiresVerification, bool IsActive, [property: Required] BookingMode[] Modes);
[ApiRequest] public sealed record SettingsInput([property: Range(0, 100)] decimal CommissionPercent);
[ApiRequest] public sealed record PrivacyRequestInput([property: Required, StringLength(10)] string Kind);
[AttributeUsage(AttributeTargets.Class)] public sealed class ApiRequestAttribute : Attribute;
public static class ApiRequestValidator
{
    public static void Validate(object request, Dictionary<string, string[]> errors)
    {
        var results = new List<ValidationResult>();
        if (!Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true))
            foreach (var result in results) foreach (var member in result.MemberNames.DefaultIfEmpty("request")) errors[member] = [result.ErrorMessage ?? "Invalid value."];
        foreach (var property in request.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var value = property.GetValue(request);
            if (property.PropertyType.IsEnum && value is not null && !Enum.IsDefined(property.PropertyType, value)) errors[property.Name] = ["Unknown enum value."];
            if (value is Array array)
                foreach (var item in array)
                {
                    if (item is Enum enumeration && !Enum.IsDefined(enumeration.GetType(), enumeration)) errors[property.Name] = ["Unknown enum value."];
                    if (item is not null && item.GetType().GetCustomAttribute<ApiRequestAttribute>() is not null) Validate(item, errors);
                }
        }
    }
}
public static class Localities { public static readonly object[] All = [new { name = "Valletta", latitude = 35.8992, longitude = 14.5141 }, new { name = "Sliema", latitude = 35.9122, longitude = 14.5042 }, new { name = "St Julian's", latitude = 35.9184, longitude = 14.4891 }, new { name = "Birkirkara", latitude = 35.8972, longitude = 14.4611 }, new { name = "Mosta", latitude = 35.9090, longitude = 14.4256 }, new { name = "Rabat", latitude = 35.8815, longitude = 14.3988 }, new { name = "Victoria", latitude = 36.0444, longitude = 14.2397 }, new { name = "Nadur", latitude = 36.0378, longitude = 14.2940 }]; }
