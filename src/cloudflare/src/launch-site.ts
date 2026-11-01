export interface LaunchEnv {
  PUBLIC_ORIGIN: string;
  INDEXNOW_KEY?: string;
  GOOGLE_SITE_VERIFICATION?: string;
  BING_SITE_VERIFICATION?: string;
}

type Page = {
  path: string;
  title: string;
  description: string;
  content: string;
};

const siteIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="32" fill="#176b61" />
  <path d="M19 37c6-8 10-13 16-13 5 0 8 4 7 8l-3 11c-.5 2-3.5 2-3 0l2-8c.4-1.5-1.8-2.3-2.5-.7l-3.5 8c-.8 1.8-3.4.7-2.6-1.1l3-7.2c.6-1.5-1.6-2.6-2.5-1.2l-4.6 7c-1 1.6-3.3.2-2.3-1.4l3.5-5.5c.8-1.3-.9-2.8-2.1-1.7l-3.1 2.8c-1.4 1.3-3.5.2-2.3-1.3Z" fill="none" stroke="#fffdf7" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
</svg>`;

const verificationPattern = /^[A-Za-z0-9_-]{8,128}$/;

function isVerificationValue(value: string | undefined): value is string {
  return value !== undefined && value.match(verificationPattern)?.[0] === value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function cleanPublicOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== value ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

const pages: Page[] = [
  {
    path: "/",
    title: "Local help in Malta & Gozo | Daqqa t’Id",
    description:
      "Discover Daqqa t’Id for local help, working together and practical skills in Malta and Gozo. Share interest in the first Mosta pilot.",
    content: `<header class="hero">
      <p class="eyebrow">LOCAL HANDS. REAL CONNECTIONS.</p>
      <h1>A hand when you need one.</h1>
      <p class="hero-copy">A simpler way to arrange local help, work side by side, or learn a practical skill. Built for Malta and Gozo, starting with a small Mosta pilot.</p>
      <div class="actions"><a class="button" href="/join">Help shape the pilot</a><a class="text-link" href="/how-it-works">Discover the three ways to get help <span aria-hidden="true">→</span></a></div>
      <p class="pilot-note"><span class="status-dot" aria-hidden="true"></span> Early access · Welcoming expressions of interest</p>
    </header>
    <section class="section intro" aria-labelledby="simple-title">
      <div><p class="eyebrow">Practical help, made clearer</p><h2 id="simple-title">Small jobs can make a big difference.</h2></div>
      <div class="copy"><p>A shelf to put up, a room to freshen, a piece of furniture to assemble. These jobs take time and a bit of know-how. Daqqa t’Id aims to make it easier to find a local person who can lend a hand.</p><p>Choose the services, prices and way of working that suit you. The first pilot will focus on clear requests and practical help close to home.</p></div>
    </section>
    <section class="feature-band" aria-labelledby="pilot-title">
      <div class="feature-number" aria-hidden="true">01</div><div><p class="eyebrow">First area under consideration</p><h2 id="pilot-title">Mosta, Malta</h2><p>Our proposed first pilot brings together people interested in home cleaning and furniture assembly in Mosta. Tell us what you need or the skills you can offer.</p></div>
    </section>
    <section class="section cards-section" aria-labelledby="next-title"><div class="section-heading"><p class="eyebrow">What happens next</p><h2 id="next-title">Built with the people who’ll use it.</h2></div><div class="cards"><article class="card"><span class="card-mark">A</span><h3>Tell us what would help</h3><p>Share the kinds of everyday jobs you’d like help with, or the skills you could offer.</p><a href="/join">Share an expression of interest <span aria-hidden="true">→</span></a></article><article class="card"><span class="card-mark">B</span><h3>Understand the approach</h3><p>Get a task done for you, work alongside someone, or learn to do it yourself.</p><a href="/how-it-works">How Daqqa t’Id works <span aria-hidden="true">→</span></a></article><article class="card"><span class="card-mark">C</span><h3>Ask us directly</h3><p>Get help with joining, share an idea, or ask about the first pilot.</p><a href="/contact">Contact the project <span aria-hidden="true">→</span></a></article></div></section>`,
  },
  {
    path: "/how-it-works",
    title: "How it works: local help in Malta & Gozo | Daqqa t’Id",
    description:
      "Explore three ways to get local help with Daqqa t’Id: get a task done, work side by side, or learn a practical skill.",
    content: `<header class="page-hero"><p class="eyebrow">The idea</p><h1>Help that fits the way you want to do it.</h1><p>Every task is different. Daqqa t’Id brings together three ways of working so you can choose the kind of help that suits you.</p></header>
    <section class="service-list" aria-label="Planned ways to get help"><article class="service-card"><div class="service-index">01</div><div><p class="eyebrow">For Me</p><h2>Get a job done for you.</h2><p>For a practical task you’d like someone else to handle, such as home cleaning or assembling flat-pack furniture. These are the services proposed for our first Mosta pilot.</p></div></article><article class="service-card"><div class="service-index">02</div><div><p class="eyebrow">With Me</p><h2>Get a hand while you do it.</h2><p>Work alongside a helper when an extra pair of hands or some practical guidance would make the task easier. Agree the task and each person’s part before starting.</p></div></article><article class="service-card"><div class="service-index">03</div><div><p class="eyebrow">Teach Me</p><h2>Learn how to do it yourself.</h2><p>For someone who wants to build confidence with a practical skill, with guidance from a person who knows how to do it.</p></div></article></section>
    <section class="plain-callout"><p class="eyebrow">Starting small</p><h2>Begin with clear, everyday jobs.</h2><p>We’re starting with interest in cleaning and furniture assembly in Mosta. Clear tasks, prices and availability help people choose with confidence.</p><p class="small-note">Working together and lessons apply to eligible tasks. Regulated work requires appropriate approval. The first pilot is preparing to open; real bookings are not available yet.</p><a class="text-link" href="/join">Help us shape what comes first <span aria-hidden="true">→</span></a></section>`,
  },
  {
    path: "/join",
    title: "Offer your skills in Malta & Gozo | Daqqa t’Id",
    description:
      "Tell the Daqqa t’Id team if you may want practical help or would like to offer a skill in the planned Mosta pilot.",
    content: `<header class="page-hero"><p class="eyebrow">Help shape what comes next</p><h1>Your skills can help your neighbours.</h1><p>Offer your skills, choose the area and hours that suit you, and help people nearby. We’re welcoming interest from helpers and customers for our first Mosta pilot.</p></header>
    <section class="join-grid"><article class="join-card"><p class="eyebrow">Looking for a hand?</p><h2>What jobs would you want help with?</h2><p>We’re currently considering home cleaning and furniture assembly. Tell us what kind of practical help would matter to you and where you’re based.</p><a class="button" href="https://wa.me/35699894619?text=Hello%2C%20I%E2%80%99m%20interested%20in%20Daqqa%20t%E2%80%99Id" target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a><a class="secondary-link" href="mailto:markanthonymifsud@yahoo.com?subject=Daqqa%20t%E2%80%99Id%20interest">Or email the project</a></article><article class="join-card join-card-dark"><p class="eyebrow">Have a useful skill?</p><h2>Let us know what you could offer.</h2><p>Tell us which services you offer, where you work and what would make Daqqa t’Id useful to you. You will choose your own prices and hours.</p><a class="button button-light" href="https://wa.me/35699894619?text=Hello%2C%20I%E2%80%99d%20like%20to%20share%20a%20skill%20with%20Daqqa%20t%E2%80%99Id" target="_blank" rel="noopener noreferrer">Share an interest on WhatsApp</a><a class="secondary-link secondary-link-light" href="mailto:markanthonymifsud@yahoo.com?subject=Offering%20a%20skill%20with%20Daqqa%20t%E2%80%99Id">Or email the project</a></article></section>
    <section class="plain-callout"><p class="eyebrow">Getting started</p><h2>Start with a short message.</h2><p>Share your service and area by WhatsApp or email. We’ll use your message to discuss the pilot with you.</p><p class="small-note">Expressions of interest only; real bookings are not open yet. Do not send passwords, payment details or identity documents. Participation does not guarantee jobs or earnings.</p></section>`,
  },
  {
    path: "/contact",
    title: "Contact Daqqa t’Id | Daqqa t’Id",
    description:
      "Contact the Daqqa t’Id project owner by email or WhatsApp with a question, suggestion or expression of interest.",
    content: `<header class="page-hero"><p class="eyebrow">Get in touch</p><h1>We’d like to hear from you.</h1><p>Questions, suggestions and practical feedback help us understand what a useful local service could look like.</p></header>
    <section class="contact-panel"><div><p class="eyebrow">Email</p><h2>Send a note</h2><p>Write to the project owner with a question or idea.</p><a class="contact-value" href="mailto:markanthonymifsud@yahoo.com">markanthonymifsud@yahoo.com</a></div><div><p class="eyebrow">WhatsApp</p><h2>Start a conversation</h2><p>Use WhatsApp if that’s easier for you.</p><a class="contact-value" href="https://wa.me/35699894619" target="_blank" rel="noopener noreferrer">Message +356 9989 4619 <span aria-hidden="true">↗</span></a></div></section>
    <p class="contact-footnote">Please keep passwords, payment details and identity documents out of messages.</p>`,
  },
  {
    path: "/privacy",
    title: "Privacy | Daqqa t’Id",
    description:
      "Privacy information for the Daqqa t’Id public prelaunch website and its external contact options.",
    content: `<header class="page-hero"><p class="eyebrow">A clear note</p><h1>Privacy on this website.</h1><p>This page describes the current public Daqqa t’Id prelaunch website.</p></header>
    <article class="privacy-copy"><h2>Information you share</h2><p>This website has no forms, account sign-up, analytics, or advertising cookies. If you choose to contact the project through WhatsApp or email, the information you send is handled through that service and reaches the project owner. Those services have their own privacy terms.</p><h2>Website requests</h2><p>Like other websites, requests to view these pages are processed by the hosting provider. This site does not add analytics or advertising tracking to those requests.</p><h2>Changes</h2><p>The site may change as the project develops. This notice will be updated if the way this public site handles information changes.</p><p class="small-note">The public site is separate from any future booking service. No bookings or user accounts are offered here.</p></article>`,
  },
];

const styles = `.brand-mark svg{width:36px;height:36px;display:block}:root{color-scheme:light;--ink:#17352c;--muted:#52665c;--paper:#f8f7f1;--green:#2b5b45;--lime:#d9e5a1;--line:#dce1d6;--white:#fff}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.65}a{color:inherit}a:focus-visible{outline:3px solid #a54820;outline-offset:4px;border-radius:2px}.skip-link{position:absolute;top:-80px;left:1rem;z-index:5;background:var(--white);padding:.7rem 1rem}.skip-link:focus{top:1rem}.shell{width:min(1120px,calc(100% - 48px));margin:auto}.topbar{height:86px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{display:inline-flex;align-items:center;gap:11px;text-decoration:none;font-weight:750;letter-spacing:-.03em;font-size:1.15rem}.brand-mark{width:34px;height:34px;display:grid;place-items:center;background:var(--green);color:white;border-radius:50%;font-size:1rem;letter-spacing:0}.nav{display:flex;gap:clamp(14px,2.6vw,34px);align-items:center}.nav a{text-decoration:none;font-size:.92rem;color:var(--muted)}.nav a:hover,.footer a:hover,.text-link:hover,.secondary-link:hover{color:var(--green);text-decoration:underline;text-underline-offset:4px}.nav .nav-cta{background:var(--green);color:white;padding:.64rem 1rem;border-radius:4px}.nav .nav-cta:hover{background:#1b4433;color:white;text-decoration:none}.hero{padding:clamp(72px,11vw,132px) 0 74px;max-width:850px}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:.72rem;font-weight:750;color:#687d60;margin:0 0 15px}.hero h1,.page-hero h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(3.2rem,7.5vw,6.5rem);line-height:.99;letter-spacing:-.055em;font-weight:500;max-width:850px;margin:0}.hero-copy{font-family:Georgia,"Times New Roman",serif;font-size:clamp(1.2rem,2vw,1.5rem);line-height:1.5;color:var(--muted);max-width:670px;margin:26px 0 30px}.actions{display:flex;align-items:center;gap:24px;flex-wrap:wrap}.button{display:inline-flex;justify-content:center;align-items:center;min-height:48px;background:var(--green);color:#fff;border:1px solid var(--green);padding:11px 18px;text-decoration:none;border-radius:3px;font-weight:650}.button:hover{background:#1b4433}.text-link{font-weight:650;text-decoration:none}.pilot-note{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:.87rem;margin:31px 0 0}.status-dot{width:8px;height:8px;background:#a77f3e;border-radius:50%}.section{padding:72px 0}.intro{border-top:1px solid var(--line);display:grid;grid-template-columns:.85fr 1.15fr;gap:8vw}.section h2,.feature-band h2,.section-heading h2,.plain-callout h2{font-family:Georgia,"Times New Roman",serif;font-size:clamp(2rem,4vw,3.2rem);letter-spacing:-.035em;line-height:1.1;font-weight:500;margin:0}.copy{max-width:610px;color:var(--muted);font-size:1.03rem}.copy p:first-child{margin-top:0}.feature-band{background:#e9eddd;padding:48px clamp(24px,7vw,86px);display:grid;grid-template-columns:100px 1fr;gap:12px;align-items:start}.feature-number{font-family:Georgia,serif;font-size:2.5rem;color:#8d9d75}.feature-band h2{font-size:2.7rem}.feature-band p:not(.eyebrow){max-width:650px;color:var(--muted);margin-bottom:0}.cards-section{padding:82px 0 96px}.section-heading{max-width:600px;margin-bottom:36px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{padding:25px 24px 27px;border:1px solid var(--line);background:rgba(255,255,255,.52);min-height:250px;display:flex;flex-direction:column;align-items:flex-start}.card-mark{display:grid;place-items:center;width:29px;height:29px;border-radius:50%;background:var(--lime);font-size:.75rem;font-weight:750;margin-bottom:18px}.card h3{font-size:1.13rem;margin:0 0 8px}.card p{color:var(--muted);margin:0 0 20px;font-size:.94rem}.card a{font-weight:650;font-size:.9rem;text-decoration:none;margin-top:auto}.page-hero{padding:90px 0 54px;max-width:770px}.page-hero h1{font-size:clamp(2.8rem,6.3vw,5.3rem)}.page-hero>p:last-child{font-size:1.12rem;color:var(--muted);max-width:650px;margin:22px 0 0}.service-list{border-top:1px solid var(--line)}.service-card{display:grid;grid-template-columns:100px 1fr;gap:12px;padding:42px 0;border-bottom:1px solid var(--line);max-width:920px}.service-index{font-family:Georgia,serif;font-size:2rem;color:#8d9d75}.service-card h2,.join-card h2,.contact-panel h2,.privacy-copy h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:clamp(1.7rem,3vw,2.45rem);letter-spacing:-.025em;line-height:1.15;margin:0 0 12px}.service-card p:not(.eyebrow){color:var(--muted);max-width:720px;margin:0 0 12px}.small-note{font-size:.87rem;color:#69786e!important}.plain-callout{background:#e9eddd;margin:65px 0 85px;padding:38px clamp(22px,5vw,58px);max-width:820px}.plain-callout h2{font-size:2.25rem}.plain-callout>p:not(.eyebrow){color:var(--muted);max-width:680px}.plain-callout .text-link{display:inline-block;margin-top:8px}.join-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.join-card{padding:34px;background:#e9eddd;min-height:345px;display:flex;flex-direction:column;align-items:flex-start}.join-card h2{font-size:2.1rem;max-width:420px}.join-card>p:not(.eyebrow){color:var(--muted);max-width:430px}.join-card .button{margin-top:auto}.join-card-dark{background:var(--green);color:white}.join-card-dark .eyebrow{color:var(--lime)}.join-card-dark>p:not(.eyebrow){color:#e0e8df}.button-light{background:var(--lime);border-color:var(--lime);color:var(--ink)}.button-light:hover{background:#e6efbd;color:var(--ink)}.secondary-link{margin-top:14px;font-size:.9rem;font-weight:600;text-decoration:none}.secondary-link-light:hover{color:var(--lime)}.contact-panel{display:grid;grid-template-columns:1fr 1fr;gap:20px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:35px 0}.contact-panel>div{padding:8px 0}.contact-panel h2{font-size:2rem}.contact-panel p:not(.eyebrow){color:var(--muted)}.contact-value{display:inline-block;margin-top:9px;font-weight:700;font-size:1.05rem;overflow-wrap:anywhere}.contact-footnote{color:var(--muted);font-size:.9rem;margin:22px 0 85px}.privacy-copy{border-top:1px solid var(--line);max-width:790px;padding-top:34px;margin-bottom:85px}.privacy-copy h2{font-size:1.6rem;margin-top:30px}.privacy-copy h2:first-child{margin-top:0}.privacy-copy p{color:var(--muted)}.footer{background:#e9eddd;padding:33px 0}.footer-inner{display:flex;justify-content:space-between;align-items:flex-start;gap:35px}.footer-brand{font-weight:750}.footer p{margin:6px 0 0;color:var(--muted);font-size:.88rem}.footer-links{display:flex;gap:22px;flex-wrap:wrap;justify-content:flex-end}.footer-links a{font-size:.88rem;text-decoration:none}.demo-link{color:#687d60}.footer-bottom{border-top:1px solid #d1d9c7;margin-top:24px;padding-top:16px;color:#657569;font-size:.79rem}@media(max-width:700px){.shell{width:min(100% - 36px,540px)}.topbar{height:auto;min-height:76px;align-items:flex-start;padding:19px 0;gap:18px;flex-direction:column}.nav{width:100%;gap:8px 18px;flex-wrap:wrap;padding:1px 0 5px}.nav a{font-size:.87rem}.nav .nav-cta{padding:7px 11px}.hero{padding:74px 0 58px}.hero h1{font-size:clamp(3rem,14vw,4.6rem)}.intro{grid-template-columns:1fr;gap:20px;padding:54px 0}.feature-band{grid-template-columns:45px 1fr;padding:34px 22px;gap:4px}.feature-band h2{font-size:2.2rem}.cards-section{padding:62px 0}.cards{grid-template-columns:1fr}.card{min-height:0}.page-hero{padding:67px 0 38px}.page-hero h1{font-size:clamp(2.8rem,12vw,4rem)}.service-card{grid-template-columns:42px 1fr;padding:31px 0;gap:4px}.service-index{font-size:1.5rem}.join-grid,.contact-panel{grid-template-columns:1fr}.join-card{min-height:320px;padding:27px}.join-card h2{font-size:1.9rem}.plain-callout{margin:48px 0 65px;padding:30px 23px}.footer-inner{flex-direction:column}.footer-links{justify-content:flex-start;gap:12px 20px}.footer-bottom{margin-top:18px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;

function renderVerificationTags(env: LaunchEnv): string {
  const tags: string[] = [];
  if (isVerificationValue(env.GOOGLE_SITE_VERIFICATION)) {
    tags.push(`<meta name="google-site-verification" content="${escapeHtml(env.GOOGLE_SITE_VERIFICATION)}">`);
  }
  if (isVerificationValue(env.BING_SITE_VERIFICATION)) {
    tags.push(`<meta name="msvalidate.01" content="${escapeHtml(env.BING_SITE_VERIFICATION)}">`);
  }
  return tags.join("\n    ");
}

function renderPage(page: Page, origin: string, env: LaunchEnv): string {
  const canonical = `${origin}${page.path}`;
  const jsonLd = page.path === "/"
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            name: "Daqqa t’Id",
            alternateName: "Daqqa t Id",
            url: origin,
            email: "markanthonymifsud@yahoo.com",
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "Project enquiries",
              telephone: "+35699894619",
              url: `${origin}/contact`,
            },
          },
          { "@type": "WebSite", name: "Daqqa t’Id", url: origin, inLanguage: "en-MT" },
        ],
      })}</script>`
    : "";
  return `<!doctype html>
<html lang="en-MT">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f8f7f1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Daqqa t’Id">
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:locale" content="en_MT">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(page.title)}">
  <meta name="twitter:description" content="${escapeHtml(page.description)}">
  ${renderVerificationTags(env)}
  ${jsonLd}
  <style>${styles}</style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Daqqa t’Id home"><span class="brand-mark" aria-hidden="true">${siteIcon}</span><span>Daqqa t’Id</span></a>
      <nav class="nav" aria-label="Main navigation"><a href="/how-it-works">How it works</a><a href="/join">Join the pilot</a><a href="/contact">Contact</a><a class="nav-cta" href="/join">Share interest</a></nav>
    </header>
    <main id="main">${page.content}</main>
  </div>
  <footer class="footer"><div class="shell"><div class="footer-inner"><div><a class="brand footer-brand" href="/">Daqqa t’Id</a><p>A hand when you need one. Made for Malta & Gozo.</p></div><nav class="footer-links" aria-label="Footer navigation"><a href="/how-it-works">How it works</a><a href="/join">Share interest</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a class="demo-link" href="https://daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev" rel="nofollow noopener noreferrer">Fictional app demo</a></nav></div><div class="footer-bottom">Early access: gathering interest for the first pilot. Real bookings are not open yet.</div></div></footer>
</body>
</html>`;
}

function responseHeaders(contentType: string, cache: string, secureRequest: boolean): Headers {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
  });
  if (secureRequest) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return headers;
}

function makeResponse(
  request: Request,
  body: string,
  status: number,
  contentType: string,
  cache = "public, max-age=300",
  noindex = false,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = responseHeaders(contentType, cache, new URL(request.url).protocol === "https:");
  if (noindex) headers.set("X-Robots-Tag", "noindex, nofollow");
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  }
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}

function notFoundPage(origin: string): string {
  const home = `${origin}/`;
  return `<!doctype html><html lang="en-MT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | Daqqa t’Id</title><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${home}"><style>${styles}</style></head><body><a class="skip-link" href="#main">Skip to content</a><div class="shell"><header class="topbar"><a class="brand" href="/">Daqqa t’Id</a></header><main id="main" class="page-hero"><p class="eyebrow">404 · Page not found</p><h1>We can’t find that page.</h1><p><a class="text-link" href="/">Return to Daqqa t’Id home →</a></p></main></div></body></html>`;
}

function renderSitemap(origin: string): string {
  const entries = pages.map((page) => `  <url><loc>${escapeHtml(`${origin}${page.path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
}

function validateIndexNowKey(value: string | undefined): value is string {
  return value !== undefined && value.match(/^[A-Za-z0-9-]{8,128}$/)?.[0] === value;
}

export default {
  async fetch(request: Request, env: LaunchEnv): Promise<Response> {
    const origin = cleanPublicOrigin(env.PUBLIC_ORIGIN);
    if (origin === null) {
      return makeResponse(request, "Service unavailable", 503, "text/plain; charset=utf-8", "no-store", true);
    }

    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return makeResponse(request, "Method not allowed", 405, "text/plain; charset=utf-8", "no-store", true, { Allow: "GET, HEAD" });
    }

    if (url.pathname === "/favicon.svg") {
      return makeResponse(request, siteIcon, 200, "image/svg+xml; charset=utf-8", "public, max-age=86400");
    }
    if (url.pathname === "/robots.txt") {
      const body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
      return makeResponse(request, body, 200, "text/plain; charset=utf-8");
    }
    if (url.pathname === "/sitemap.xml") {
      return makeResponse(request, renderSitemap(origin), 200, "application/xml; charset=utf-8");
    }
    if (validateIndexNowKey(env.INDEXNOW_KEY) && url.pathname === `/${env.INDEXNOW_KEY}.txt`) {
      return makeResponse(request, env.INDEXNOW_KEY, 200, "text/plain; charset=utf-8", "public, max-age=300", true);
    }

    const page = pages.find((candidate) => candidate.path === url.pathname);
    if (page) {
      return makeResponse(request, renderPage(page, origin, env), 200, "text/html; charset=utf-8");
    }
    return makeResponse(request, notFoundPage(origin), 404, "text/html; charset=utf-8", "public, max-age=300", true);
  },
};
