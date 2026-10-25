namespace DaqqaTid.Application;

public sealed record SupportPaymentAvailability(bool Enabled, string? CheckoutUrl);

public static class SupportPaymentPolicy
{
    public static SupportPaymentAvailability Get(string? environmentName, string? checkoutUrl)
    {
        if (!string.Equals(environmentName, "Production", StringComparison.OrdinalIgnoreCase)
            || !IsAllowedCheckoutUrl(checkoutUrl))
            return new(false, null);

        return new(true, checkoutUrl);
    }

    public static bool IsAllowedCheckoutUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == Uri.UriSchemeHttps
            && string.Equals(uri.Host, "buy.stripe.com", StringComparison.OrdinalIgnoreCase)
            && uri.IsDefaultPort
            && string.IsNullOrEmpty(uri.UserInfo)
            && string.IsNullOrEmpty(uri.Query)
            && string.IsNullOrEmpty(uri.Fragment)
            && uri.AbsolutePath.Length > 1
            && uri.AbsolutePath.AsSpan(1).IndexOfAnyExcept("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") < 0;
    }
}
