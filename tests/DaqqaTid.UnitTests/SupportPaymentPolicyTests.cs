using DaqqaTid.Application;
using Xunit;

namespace DaqqaTid.UnitTests;

public sealed class SupportPaymentPolicyTests
{
    private const string Link = "https://buy.stripe.com/abc123";

    [Theory]
    [InlineData("Staging")]
    [InlineData("Development")]
    [InlineData("staging_demo")]
    public void Nonproduction_never_enables_support_checkout(string environment)
    {
        var result = SupportPaymentPolicy.Get(environment, Link);
        Assert.False(result.Enabled);
        Assert.Null(result.CheckoutUrl);
    }

    [Fact]
    public void Production_enables_only_a_valid_configured_link()
    {
        Assert.Equal(new SupportPaymentAvailability(true, Link), SupportPaymentPolicy.Get("Production", Link));
        Assert.Equal(new SupportPaymentAvailability(false, null), SupportPaymentPolicy.Get("Production", null));
    }

    [Theory]
    [InlineData("http://buy.stripe.com/abc")]
    [InlineData("https://buy.stripe.com/test_abc")]
    [InlineData("https://user@buy.stripe.com/abc")]
    [InlineData("https://buy.stripe.com.evil.example/abc")]
    [InlineData("https://buy.stripe.com:444/abc")]
    [InlineData("https://buy.stripe.com/abc?amount=1")]
    [InlineData("https://buy.stripe.com/abc#return")]
    [InlineData("https://buy.stripe.com/")]
    public void Invalid_links_fail_closed(string link)
    {
        var result = SupportPaymentPolicy.Get("Production", link);
        Assert.False(result.Enabled);
        Assert.Null(result.CheckoutUrl);
    }
}
