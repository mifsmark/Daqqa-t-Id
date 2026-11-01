# Google and Bing search setup

The public launch website is **https://daqqa-t-id.daqqatid-75d7e2e4.workers.dev/**. It introduces Daqqa t’Id, explains the three ways to get help, gathers pilot interest through the owner's existing email/WhatsApp, and provides contact/privacy information. It accurately describes early access; it contains no invented providers, bookings, reviews or earnings.

Verified on 1 November 2026: the public Worker is published and receives 100% traffic. The live discovery/proof checks passed, and IndexNow acknowledged five URLs with **HTTP 202 (key validation pending)**. Google/Bing account verification, actual indexation and rankings remain unverified; the owner’s public verification tags are still required. Source-specific CI and version evidence are in [PROGRESS.md](PROGRESS.md).

The separate marketplace demo at `daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev` remains **noindex**, blocks crawlers in robots.txt and has no public sitemap. Its fictional records must not become search landing pages.

## Published discovery documents

- Public sitemap: https://daqqa-t-id.daqqatid-75d7e2e4.workers.dev/sitemap.xml
- Public robots: https://daqqa-t-id.daqqatid-75d7e2e4.workers.dev/robots.txt
- Public pages: `/`, `/how-it-works`, `/join`, `/contact`, `/privacy`.

These pages render full content without JavaScript, have unique titles/descriptions, stable canonical URLs, sharing metadata and a favicon. Homepage Organization/WebSite structured data describes the actual brand/contact. Unknown/private document paths return 404 with noindex. No ratings, physical business address or current worker inventory are fabricated.

## Google Search Console — owner login required

1. Open [Google Search Console](https://search.google.com/search-console).
2. Add a **URL-prefix** property for `https://daqqa-t-id.daqqatid-75d7e2e4.workers.dev/`. A workers.dev subdomain uses URL-prefix verification; the owner does not control Cloudflare's parent-domain DNS.
3. Choose **HTML tag** and copy its public `google-site-verification` tag. Give the tag or content value to the app operator; no Google password, login code or private credential is needed.
4. The operator configures `GOOGLE_SITE_VERIFICATION` on the public launch Worker, republishes, and checks the tag on the live homepage. Then select **Verify** in Search Console.
5. In **Sitemaps**, submit the public `/sitemap.xml`. Use **URL inspection** to request indexing of the homepage and useful public pages.
6. Monitor indexing status, search impressions and clicks. Keep the verification token when updating the site.

The HTML tag is ownership verification, not an analytics script. No Google tracking is installed by this setup. Search Console account/property verification and sitemap submission are not complete until the owner login steps actually succeed.

## Microsoft Bing

[Bing Webmaster Tools](https://www.bing.com/webmasters/) can import a verified Search Console property, or verify the public URL directly using its HTML meta tag. For the latter, configure the supplied `msvalidate.01` content value as `BING_SITE_VERIFICATION`, republish, verify ownership, and submit the same public sitemap.

IndexNow can notify participating search engines, including Bing, without a Webmaster account. The public launch Worker serves its configured proof at `/<INDEXNOW_KEY>.txt`. This key is deliberately public and is not a Cloudflare token, password, VAPID private key or paid service credential.

```sh
# Read-only configuration check; sends no request to IndexNow.
python3 scripts/submit-indexnow.py

# After the verified public release is deployed:
python3 scripts/submit-indexnow.py --submit
```

The submit command checks the actual robots policy, exact five-page sitemap, hosted proof, page canonicals and noindex state before notifying `https://api.indexnow.org/indexnow`. It refuses redirects or unexpected/blocked pages. It sends only the public page URLs and public ownership proof. HTTP 200 means the URLs were received; HTTP 202 means receipt with key validation pending. Neither establishes that a page has been indexed or ranked. Google discovery uses Search Console and the sitemap; IndexNow is not a Google submission.

Rerun after meaningful public-page changes. Do not repeatedly submit unchanged URLs or use this script for demo profiles, accounts, bookings or other private data.

## Configuration and portability

The standalone launch Worker uses `src/cloudflare/wrangler.launch.jsonc` and `src/cloudflare/src/launch-site.ts`. It has no D1, KV, accounts, forms, checkout, analytics or client-side JavaScript. It uses the existing Cloudflare Free account. Its config keeps a clean HTTPS `PUBLIC_ORIGIN` without a trailing slash and the public `INDEXNOW_KEY`. Optional Google/Bing meta values must be 8–128 ASCII letters, digits, underscores or hyphens; malformed values are omitted. Public tags can be stored as Worker variables or bindings without exposing an account credential.

```sh
npx wrangler deploy --config src/cloudflare/wrangler.launch.jsonc
```

Use that explicit launch config for this Worker. Marketplace deployments continue to use their existing explicit staging/production configurations. A production marketplace/data store has not been activated by publishing the launch website. Do not switch off staging's indexing protection.

When the full marketplace is ready, preserve the verified host, canonical paths and proof file or use reviewed redirects and Search Console property migration. A custom domain can follow later; changing hosts can require new verification and indexing. Retained backend verification settings are:

| Backend | Google | Bing |
| --- | --- | --- |
| Cloudflare marketplace, production only | `GOOGLE_SITE_VERIFICATION` | `BING_SITE_VERIFICATION` |
| .NET marketplace, Production only | `Search__GoogleSiteVerification` | `Search__BingSiteVerification` |

These optional settings do not remove noindex barriers or make fictional workers eligible for a sitemap. Moving the marketplace to Azure still requires the existing reviewed data/media migration and deployment work.

## Build visibility with useful real information

Share the public launch URL in the owner’s profiles and permitted local posts, recruit actual helpers for the proposed Mosta cleaning/assembly pilot, and answer genuine questions in the public content. After the real marketplace launches, publish accurate service descriptions, real provider profiles and consented original photos. Keep prices, areas and availability current. Avoid duplicate locality pages and invented reviews.

Search engines decide when to crawl, index and rank. This setup makes the site eligible and submits discovery information; ranking positions and dates are not promised. Record receipts/verification/indexing separately in [PROGRESS.md](PROGRESS.md).
