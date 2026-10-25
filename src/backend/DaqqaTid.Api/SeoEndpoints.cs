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
            var paths = new[] { "/", "/services", "/join", "/contact" }.Concat(slugs.Select(s => "/services/" + Uri.EscapeDataString(s))).Concat(workerIds.Select(id => "/workers/" + id));
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
            var participationNote = category.RequiresVerification
                ? "<small>This service is limited to appropriately approved professionals. Customer participation and lessons are available only where permitted.</small>"
                : "<small>Some services have legal or safety limits on customer participation and lessons.</small>";
            var body = $"<main><h1>{E(category.Name)} in Malta and Gozo</h1><p>{E(description)}</p><p>Get local help, work together where it suits the task, or learn practical skills.</p>" +
                $"<a href=\"/find?categoryId={category.Id}\">Find {E(category.Name.ToLowerInvariant())} help</a><a href=\"/join\">Offer your skills</a>{participationNote}<small>Requests need the provider’s acceptance and your confirmation. Prices and availability are set by each provider. Demo profiles and simulated payments are labelled.</small></main>";
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
                $"<a href=\"/bookings/new?workerId={worker.Id}\">Request this helper</a><small>Verification status: {E(worker.VerificationStatus.ToString())}. Availability is provided by the worker and is not live tracking.</small></main>";
            return await Html(env, cfg, worker.DisplayName + " in " + worker.Locality + " | Daqqa t’Id", description, "/workers/" + worker.Id, body, null, ct);
        });
        app.MapGet("/join", (IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) => Html(env, cfg,
            "Find local customers for your skills | Daqqa t’Id", "Share your skills, find local customers, and build experience on your terms in Malta and Gozo.", "/join",
            "<main><h1>Your skills can help your neighbours.</h1><p>Share what you know, find local customers, and build experience on your terms.</p><ol><li>Create your account and profile.</li><li>Choose the services you offer and where you work.</li><li>Set your availability, then review requests and agree the details.</li></ol><a href=\"/register?role=Worker\">Offer your skills</a><small>Some regulated services require professional approval before they can be offered. Demo payments do not collect or transfer money.</small></main>", null, ct));
        app.MapGet("/contact", (HttpContext context, IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) => Html(env, cfg,
            "Contact Daqqa t’Id", "Get in touch with Daqqa t’Id for help with the platform.", "/contact",
            "<main><h1>Contact Daqqa t’Id</h1><p>Need help or have a question? Email <a href=\"mailto:markanthonymifsud@yahoo.com\">markanthonymifsud@yahoo.com</a> or message us on <a href=\"https://wa.me/35699894619\">WhatsApp</a>.</p></main>", null, ct,
            cfg.GetValue<bool>("StagingDemo:Enabled"), context));
        app.MapGet("/support", (HttpContext context, IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) => Html(env, cfg,
            "Support Daqqa t’Id", "Optional one-off support for the Daqqa t’Id platform.", "/support",
            "<main><h1>Support a useful local service.</h1><p>When available, you can make an optional one-off payment to support the platform. You can keep using the service without paying.</p><a href=\"/contact\">Contact us about platform support</a></main>", null, ct,
            cfg.GetValue<bool>("StagingDemo:Enabled"), context));
        app.MapGet("/", (IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) => Html(env, cfg,
            "Daqqa t’Id | Find local help in Malta & Gozo", "Find local help, work together on everyday tasks, or learn practical skills with people in Malta and Gozo.", "",
            "<main><h1>Find local help. Get things done.</h1><p>Connect with people in Malta and Gozo for the help you need around home and everyday life.</p><p>Book a service, work together on a task, or learn a practical skill from someone nearby.</p><a href=\"/services\">Explore services</a> <a href=\"/join\">Offer your skills</a></main>",
            new Dictionary<string, object?> { ["@context"] = "https://schema.org", ["@type"] = "WebSite", ["name"] = "Daqqa t’Id", ["url"] = Origin(cfg), ["inLanguage"] = "en-MT" }, ct));
        app.MapGet("/services", async (AppDbContext db, IWebHostEnvironment env, IConfiguration cfg, CancellationToken ct) =>
        {
            var categories = await db.Categories.AsNoTracking().Where(c => c.IsActive).OrderBy(c => c.Name).ToListAsync(ct);
            var body = "<main><h1>Local services in Malta and Gozo</h1><p>Get help with everyday tasks, work together, or learn practical skills from people nearby.</p><ul>" +
                string.Concat(categories.Select(c => $"<li><a href=\"/services/{Uri.EscapeDataString(c.Slug)}\">{E(c.Name)}</a><p>{E(c.Description)}</p></li>")) + "</ul></main>";
            return await Html(env, cfg, "Local services in Malta & Gozo | Daqqa t’Id", "Browse local services in Malta and Gozo, get help with everyday tasks, work together, or learn practical skills.", "/services", body, null, ct);
        });
    }
    private static string? Origin(IConfiguration cfg) => Uri.TryCreate(cfg["PublicOrigin"], UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" ? uri.GetLeftPart(UriPartial.Authority).TrimEnd('/') : null;
    private static string E(string value) => WebUtility.HtmlEncode(value);
    private static async Task<IResult> Html(IWebHostEnvironment env, IConfiguration cfg, string title, string description, string path, string body, object? schema, CancellationToken ct, bool noindex = false, HttpContext? context = null)
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
        if (noindex) meta += "<meta name=\"robots\" content=\"noindex, nofollow\">";
        if (schema is not null) meta += "<script type=\"application/ld+json\">" + JsonSerializer.Serialize(schema) + "</script>";
        html = html.Replace("</head>", meta + "</head>").Replace("<div id=\"root\"></div>", "<div id=\"root\">" + body + "</div>");
        if (noindex && context is not null) context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        return Results.Content(html, "text/html; charset=utf-8");
    }
    [GeneratedRegex("<title>.*?</title>", RegexOptions.Singleline | RegexOptions.IgnoreCase)] private static partial Regex TitleTag();
    [GeneratedRegex("<meta\\s+name=[\"']description[\"'][^>]*>", RegexOptions.IgnoreCase)] private static partial Regex DescriptionTag();
}
