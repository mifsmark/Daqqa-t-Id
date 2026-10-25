using System.Net;
using System.Net.Mail;
using DaqqaTid.Infrastructure;
using Microsoft.AspNetCore.Identity;

public static class PasswordRecoveryEndpoints
{
    private const string GenericMessage = "If an account exists for that email, password reset instructions have been sent.";

    public static RouteGroupBuilder MapPasswordRecovery(this RouteGroupBuilder api)
    {
        var auth = api.MapGroup("/auth").RequireRateLimiting("auth");
        auth.MapPost("/forgot-password", ForgotAsync);
        auth.MapPost("/reset-password", ResetAsync);
        return api;
    }

    private static async Task<IResult> ForgotAsync(ForgotPasswordRequest request, HttpContext context,
        UserManager<ApplicationUser> users, IConfiguration configuration, CancellationToken ct)
    {
        var mail = SmtpSettings.TryRead(configuration);
        var publicOrigin = configuration["PublicOrigin"] ?? configuration["PUBLIC_ORIGIN"];
        if (mail is null || !Uri.TryCreate(publicOrigin, UriKind.Absolute, out var origin)
            || origin.Scheme is not ("https" or "http") || origin.PathAndQuery != "/" || !string.IsNullOrEmpty(origin.Fragment))
            return Results.Problem("Password reset mail is not configured.", statusCode: 503);

        var email = request.Email?.Trim();
        if (string.IsNullOrWhiteSpace(email)) return Results.Ok(new { message = GenericMessage });
        var user = await users.FindByEmailAsync(email);
        if (user is not null && !user.IsSuspended)
        {
            var token = await users.GeneratePasswordResetTokenAsync(user);
            var link = new Uri(origin, $"/reset-password?email={Uri.EscapeDataString(user.Email ?? email)}&token={Uri.EscapeDataString(token)}");
            try
            {
                await mail.SendAsync(email, "Reset your Daqqa t’Id password", $"Use this link to choose a new password:\n\n{link}\n\nIf you did not request this change, you can ignore this email.", ct);
            }
            catch
            {
                // Do not include addresses, tokens, provider responses, or exception text in logs/results.
                return Results.Problem("Password reset mail is temporarily unavailable.", statusCode: 503);
            }
        }

        return Results.Ok(new { message = GenericMessage });
    }

    private static async Task<IResult> ResetAsync(ResetPasswordRequest request, UserManager<ApplicationUser> users)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Token) || string.IsNullOrWhiteSpace(request.Password))
            return Results.BadRequest(new { title = "Email, token, and password are required", status = 400 });
        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is null || user.IsSuspended) return Results.BadRequest(new { title = "The reset link is invalid or expired", status = 400 });
        var result = await users.ResetPasswordAsync(user, request.Token, request.Password);
        if (!result.Succeeded) return Results.BadRequest(new { title = "The reset link is invalid or expired, or the password does not meet account requirements", status = 400 });
        return Results.Ok(new { message = "Your password has been changed. You can now sign in." });
    }

    private sealed record ForgotPasswordRequest(string? Email);
    private sealed record ResetPasswordRequest(string? Email, string? Token, string? Password);

    private sealed class SmtpSettings
    {
        private readonly string _host;
        private readonly int _port;
        private readonly string _from;
        private readonly string? _username;
        private readonly string? _password;

        private SmtpSettings(string host, int port, string from, string? username, string? password)
        { _host = host; _port = port; _from = from; _username = username; _password = password; }

        public static SmtpSettings? TryRead(IConfiguration configuration)
        {
            var host = configuration["MAIL_HOST"]?.Trim();
            var from = configuration["MAIL_FROM"]?.Trim();
            var portText = configuration["MAIL_PORT"]?.Trim();
            var username = configuration["MAIL_USERNAME"];
            var password = configuration["MAIL_PASSWORD"];
            if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(from)
                || !int.TryParse(portText, out var port) || port is < 1 or > 65535
                || (string.IsNullOrWhiteSpace(username) != string.IsNullOrWhiteSpace(password))) return null;
            try { _ = new MailAddress(from); }
            catch (FormatException) { return null; }
            return new SmtpSettings(host, port, from, username, password);
        }

        public async Task SendAsync(string to, string subject, string body, CancellationToken ct)
        {
            using var message = new MailMessage(new MailAddress(_from), new MailAddress(to)) { Subject = subject, Body = body, IsBodyHtml = false };
            using var smtp = new SmtpClient(_host, _port)
            {
                EnableSsl = true,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
                Timeout = 20_000
            };
            if (!string.IsNullOrWhiteSpace(_username)) smtp.Credentials = new NetworkCredential(_username, _password);
            await smtp.SendMailAsync(message, ct);
        }
    }
}
