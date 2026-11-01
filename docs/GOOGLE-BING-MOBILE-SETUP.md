# Add Daqqa t’Id to Google and Microsoft Bing from a phone

The public website and sitemap are already online. IndexNow acknowledged the five public URLs with HTTP 202; key validation is pending. Google/Bing account verification and search rankings are not yet confirmed.

Use this public website for the setup:

```text
https://daqqa-t-id.daqqatid-75d7e2e4.workers.dev/
```

## First: Google

1. Open [Google Search Console](https://search.google.com/search-console) and sign in to a Google account you control. If you need an account, use [Google account signup](https://accounts.google.com/signup); Google offers account creation with an existing email address, including Yahoo. Complete sign-in and any security checks yourself.
2. Choose **Add property**. Select **URL prefix**, paste the full website URL above and press **Continue**.
3. Open **HTML tag**, usually under **Other verification methods**. Tap **Copy**. It looks like `<meta name="google-site-verification" content="…">`.
4. Paste that public tag into this Codex chat. The operator will install it on the website and check the live page. Keep the verification page open or return to it later.
5. After installation is confirmed, press **Verify** in Search Console.
6. Open **Sitemaps**, enter `sitemap.xml` and choose **Submit**. The complete sitemap URL is `https://daqqa-t-id.daqqatid-75d7e2e4.workers.dev/sitemap.xml`.
7. Use **URL inspection** for the homepage and select **Request indexing** if offered.

The public HTML verification tag can be shared with the site operator. Passwords, sign-in codes, recovery codes and account cookies stay private. The operator does not need access to the Google account.

## Then: Microsoft Bing

1. Open [Bing Webmaster Tools](https://www.bing.com/webmasters/) and sign in using an account you control.
2. Choose **Import from Google Search Console** after Google verification succeeds. Review the Google access request in your own browser, choose the Daqqa t’Id property above and complete the import.
3. Check the site's **Sitemaps** section. If the sitemap has not been imported, submit the complete sitemap URL given above.

If you use Bing's manual **Add site** route, enter the same public website URL and choose **HTML meta tag** verification. Paste the public `<meta name="msvalidate.01" content="…">` tag into this chat for installation, then return to Bing and verify. An IndexNow receipt and a verified Bing Webmaster property are separate results.

## After setup

Check indexing reports, impressions and clicks in the owner dashboards. Search engines decide when to crawl and rank; verification or submission does not guarantee a position or a date. Share the public website in genuine owner profiles and relevant, permitted community posts to help real people discover it. Keep the fictional staging demo excluded from search.

Full operator configuration and verified source/deployment evidence: [SEARCH-ENGINES.md](SEARCH-ENGINES.md) and [PROGRESS.md](PROGRESS.md).
