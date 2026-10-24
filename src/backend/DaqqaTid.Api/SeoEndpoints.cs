using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.EntityFrameworkCore;

public static partial class SeoEndpoints
{
    public static void MapMarketplaceSeo(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? "/";
            if (new[] { "/api", "/admin", "/account", "/dashboard", "/worker", "/bookings", "/login", "/register", "/reset-password", "/forgot-password", "/find" }
                .Any(prefix => path.Equals(prefix, StringComparison.OrdinalIgnoreCase) || path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase)))
                context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            await next();
        });
        app.MapGet("/robots.txt", (IConfiguration config) => Results.Text(config.GetValue<bool>("StagingDemo:Enabled") ? "User-agent: *\nDisallow: /\n" :
            "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /account\nDisallow: /dashboard\nDisallow: /worker$\nDisallow: /bookings/\nDisallow: /find\n" +
            (Origin(config) is { } origin ? $"Sitemap: {origin}/sitemap.xml\n" : ""), "text/plain"));
        app.MapGet("/sitemap.xml", async (AppDbContext db, IConfiguration config, CancellationToken ct) =>
        {
            if (config.GetValue<bool>("StagingDemo:Enabled")) return Results.NotFound();
            var origin = Origin(config);
            if (origin is null) return Results.Problem("PublicOrigin must be configured before publishing the sitemap.", statusCode: 503);
            var workers = db.Workers.Where(w => !w.IsDemo && w.VerificationStatus != VerificationStatus.Suspended && db.Users.Any(u => u.Id == w.UserId && !u.IsSuspended));
            var slugs = await db.Categories.AsNoTracking().Where(c => c.IsActive && db.Offerings.Any(o => o.CategoryId == c.Id && workers.Any(w => w.Id == o.WorkerId && (!c.RequiresVerification || w.VerificationStatus == VerificationStatus.Verified)))).Select(c => c.Slug).ToListAsync(ct);
            var workerIds = await workers.Where(w => db.Offerings.Any(o => o.WorkerId == w.Id && db.Categories.Any(c => c.Id == o.CategoryId && c.IsActive && (!c.RequiresVerification || w.VerificationStatus == VerificationStatus.Verified)))).Select(w => w.Id).ToListAsync(ct);
            var paths = new[] { "/", "/services", "/join" }.Concat(slugs.Select(s => "/services/" + Uri.EscapeDataString(s))).Concat(workerIds.Select(id => "/workers/" + id));
            var xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" +
                string.Concat(paths.Select(p => "<url><loc>" + WebUtility.HtmlEncode(origin + p) + "</loc></url>")) + "</urlset>";
            return Results.Content(xml, "application/xml");
        });
        app.MapGet("/services/{slug}", async (string slug, HttpContext context, AppDbContext db, IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) =>
        {
            var category = await db.Categories.AsNoTracking().Include(c => c.Modes).SingleOrDefaultAsync(c => c.Slug == slug && c.IsActive, ct);
            if (category is null) return Results.NotFound();
            var hasProvider = await db.Offerings.AnyAsync(o => o.CategoryId == category.Id && db.Workers.Any(w => w.Id == o.WorkerId && !w.IsDemo && w.VerificationStatus != VerificationStatus.Suspended && (!category.RequiresVerification || w.VerificationStatus == VerificationStatus.Verified) && db.Users.Any(u => u.Id == w.UserId && !u.IsSuspended)), ct);
            if (!hasProvider && !cfg.GetValue<bool>("StagingDemo:Enabled")) context.Response.Headers["X-Robots-Tag"] = "noindex, follow";
            var description = category.Description + " Find local help in Malta and Gozo. Compare service options and request a clear price before confirming.";
            var body = $"<main><h1>{E(category.Name)} in Malta and Gozo</h1><p>{E(description)}</p>" +
                (category.RequiresVerification ? "<p>This service requires an approved professional. Customer participation and lessons are restricted to eligible activities.</p>" : "<p>Choose professional help, work together, or learn a practical skill where this service supports it.</p>") +
                $"<a href=\"/find?categoryId={category.Id}\">Find {E(category.Name.ToLowerInvariant())} help</a><p>Requests are subject to the worker’s acceptance and your confirmation. Prices and availability are shown by each provider. Demo profiles and simulated payments are clearly labelled.</p><a href=\"/join\">Offer your skills</a></main>";
            return await Html(env, cfg, category.Name + " in Malta & Gozo | Daqqa t’Id", description, "/services/" + Uri.EscapeDataString(category.Slug), body,
                new Dictionary<string, object?> { ["@context"] = "https://schema.org", ["@type"] = "Service", ["name"] = category.Name, ["description"] = category.Description, ["areaServed"] = new[] { "Malta", "Gozo" }, ["provider"] = new { name = "Daqqa t’Id", url = Origin(cfg) } }, ct);
        });
        app.MapGet("/workers/{id:guid}", async (Guid id, HttpContext context, AppDbContext db, IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) =>
        {
            var worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id && w.VerificationStatus != DaqqaTid.Domain.VerificationStatus.Suspended &&
                db.Users.Any(u => u.Id == w.UserId && !u.IsSuspended), ct);
            if (worker is null) return Results.NotFound();
            if (worker.IsDemo) context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            var description = $"{worker.DisplayName}, local service worker in {worker.Locality}. " + worker.Bio;
            if (description.Length > 280) description = description[..277] + "…";
            var body = $"<main><h1>{E(worker.DisplayName)}</h1><p>Based in {E(worker.Locality)}, Malta and Gozo.</p><p>{E(worker.Bio)}</p>" +
                (worker.IsDemo ? "<p>Fictional demo provider. This profile is for testing and does not represent a real available worker.</p>" : "") +
                $"<p>Verification status: {E(worker.VerificationStatus.ToString())}. Worker-declared availability is not live tracking.</p><a href=\"/bookings/new?workerId={worker.Id}\">Request this helper</a></main>";
            return await Html(env, cfg, worker.DisplayName + " in " + worker.Locality + " | Daqqa t’Id", description, "/workers/" + worker.Id, body, null, ct);
        });
        app.MapGet("/join", (IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) => Html(env, cfg,
            "Find local customers for your skills | Daqqa t’Id", "Join as a service worker in Malta and Gozo. Set your services, area and availability, review requests, and agree a price before starting.", "/join",
            "<main><h1>Your skills can help your neighbours.</h1><p>Create a worker account, choose your services and area, and let people know when you are available.</p><ol><li>Add your name and contact details.</li><li>Choose your skills, service area and pricing.</li><li>Review requests and agree a job before you start.</li></ol><p>Regulated services require professional verification. Demo payments do not collect or transfer money.</p><a href=\"/register?role=Worker\">Join as a worker</a></main>", null, ct));
        app.MapGet("/", (IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) => Html(env, cfg,
            "Daqqa t’Id | Find local help in Malta & Gozo", "Find local help. Get things done. Browse local services, request a clear price, or join as a worker in Malta and Gozo.", "",
            "<main><h1>Find local help. Get things done.</h1><p>Daqqa t’Id connects people with local service workers in Malta and Gozo.</p><p>Book help, work alongside a professional on eligible tasks, or learn a practical skill.</p><a href=\"/services\">Explore services</a> <a href=\"/join\">Join as a worker</a></main>",
            new Dictionary<string, object?> { ["@context"] = "https://schema.org", ["@type"] = "WebSite", ["name"] = "Daqqa t’Id", ["url"] = Origin(cfg), ["inLanguage"] = "en-MT" }, ct));
        app.MapGet("/services", async (AppDbContext db, IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) =>
        {
            var categories = await db.Categories.AsNoTracking().Where(c => c.IsActive).OrderBy(c => c.Name).ToListAsync(ct);
            var body = "<main><h1>Local services in Malta and Gozo</h1><p>Find a helping hand around your home.</p><ul>" +
                string.Concat(categories.Select(c => $"<li><a href=\"/services/{Uri.EscapeDataString(c.Slug)}\">{E(c.Name)}</a><p>{E(c.Description)}</p></li>")) + "</ul></main>";
            return await Html(env, cfg, "Local services in Malta & Gozo | Daqqa t’Id", "Browse home services in Malta and Gozo, from cleaning and furniture assembly to verified professional work.", "/services", body, null, ct);
        });
    }
    private static string? Origin(IConfiguration cfg) => Uri.TryCreate(cfg["PublicOrigin"], UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" ? uri.GetLeftPart(UriPartial.Authority).TrimEnd('/') : null;
    private static string E(string value) => WebUtility.HtmlEncode(value);
    private static async Task<IResult> Html(IWebHostEnvironment env, IConfiguration cfg, string title, string description, string path, string body, object? schema, CancellationToken ct)
    {
        var index = Path.Combine(env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot"), "index.html");
        if (!File.Exists(index)) return Results.Problem("Build the frontend and copy dist into the API wwwroot directory.", statusCode: 503);
        var html = await File.ReadAllTextAsync(index, ct);
        html = TitleTag().Replace(html, "<title>" + E(title) + "</title>");
        html = DescriptionTag().Replace(html, "");
        var origin = Origin(cfg);
        var meta = $"<meta name=\"description\" content=\"{E(description)}\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:title\" content=\"{E(title)}\"><meta property=\"og:description\" content=\"{E(description)}\"><meta name=\"twitter:card\" content=\"summary\">";
        var canonicalPath = string.IsNullOrEmpty(path) ? "/" : path;
        if (origin is not null) meta += $"<link rel=\"canonical\" href=\"{E(origin + canonicalPath)}\"><meta property=\"og:url\" content=\"{E(origin + canonicalPath)}\">";
        if (schema is not null) meta += "<script type=\"application/ld+json\">" + JsonSerializer.Serialize(schema) + "</script>";
        html = html.Replace("</head>", meta + "</head>").Replace("<div id=\"root\"></div>", "<div id=\"root\">" + body + "</div>");
        return Results.Content(html, "text/html; charset=utf-8");
    }
    [GeneratedRegex("<title>.*?</title>", RegexOptions.Singleline | RegexOptions.IgnoreCase)] private static partial Regex TitleTag();
    [GeneratedRegex("<meta\\s+name=[\"']description[\"'][^>]*>", RegexOptions.IgnoreCase)] private static partial Regex DescriptionTag();
}
