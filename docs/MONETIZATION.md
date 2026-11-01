# Optional platform support

Daqqa t’Id may offer one optional, one-off platform support payment through a Stripe-hosted Payment Link. Support remains optional. The app does not add a subscription, priority treatment, premium feature, paywall, or paid hosting requirement. The existing public service information, booking flow, and booking alerts remain the product offering; no additional benefits or financial returns are promised.

The checkout page hosted by Stripe displays the amount and terms chosen by the account owner. Stripe Dashboard is the authoritative record of any payment. Daqqa t’Id does not store payment details or treat a checkout click, redirect, or return visit as proof of payment. Existing demo booking payment simulation remains separate and cannot charge money.

To enable support in production:

1. The service owner creates and verifies their own Stripe account and reviews Stripe’s current country availability, fees, tax handling, refund obligations, and support contact requirements.
2. In Stripe Dashboard, create a Payment Link for a customer-chosen one-off amount. Use the honest product name **Support Daqqa t’Id** and clearly state the amount and any applicable terms in Stripe Checkout.
3. Configure the resulting HTTPS `buy.stripe.com` Payment Link in production as `SupportPayments:CheckoutUrl` for .NET or `SUPPORT_CHECKOUT_URL` for Cloudflare Workers.
4. Confirm the value is a live production link in Stripe Dashboard before enabling the production setting. The app fails closed for missing or malformed values. Staging, staging demo, development, and other nonproduction deployments always report support as disabled, even if given a valid live link.

The public `GET /api/support` response reports whether a valid configured link is available and, when enabled, returns the link for display. The app does not contact Stripe, issue charges, manage refunds, or change booking commission behavior.
