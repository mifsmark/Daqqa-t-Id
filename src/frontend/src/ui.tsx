import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  MapPin,
  Search,
  HandHelping,
  Menu,
  X,
  ShieldCheck,
  Heart,
  Share2,
  ChevronRight,
  CheckCircle2,
  Plus,
  CalendarDays,
} from "lucide-react";
import { api, Category, Session, setCsrf, Worker, json, User } from "./api";
import { MediaPanel } from "./MediaPanel";
const modes = [
  ["ForMe", "Get it done"],
  ["WithMe", "Work side by side"],
  ["TeachMe", "Learn from someone"],
];
const MALTA_TIME_ZONE = "Europe/Malta";
function maltaDateTimeParts(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MALTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((parts, part) => {
      parts[part.type] = part.value;
      return parts;
    }, {});
}
function maltaLocalDateTimeValue(date: Date) {
  const p = maltaDateTimeParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function maltaLocalDateTimeToUtc(value: string) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = maltaDateTimeParts(new Date(guess));
    const displayedAsUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
    guess += target - displayedAsUtc;
  }
  if (maltaLocalDateTimeValue(new Date(guess)) !== value) {
    throw new Error(
      "That time does not exist in Malta because the clocks change. Please choose another time.",
    );
  }
  return new Date(guess).toISOString();
}
function formatMaltaDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MT", {
    timeZone: MALTA_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function IconMark() {
  return (
    <span className="mark">
      <HandHelping size={19} />
    </span>
  );
}
function Header({ user }: { user: User | null }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="header">
      <Link to="/" className="brand">
        <IconMark />
        <span>daqqa t’Id</span>
      </Link>
      <button
        className="mobile-menu"
        aria-label="Open menu"
        onClick={() => setOpen(!open)}
      >
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? "nav nav-open" : "nav"}>
        <NavLink to="/services">Explore services</NavLink>
        <NavLink to="/join">Become a helper</NavLink>
        {user ? (
          <>
            <NavLink to="/dashboard">My space</NavLink>
            <button
              className="link-button"
              onClick={async () => {
                await api("/api/auth/logout", json({}));
                setCsrf("");
                const refreshed = await api<Session>("/api/session");
                setCsrf(refreshed.csrfToken);
                location.href = "/";
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login">Log in</NavLink>
            <Link className="button button-small" to="/register">
              Join Daqqa t’Id
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
function Footer() {
  return (
    <footer className="footer">
      <div className="brand">
        <IconMark />
        <span>daqqa t’Id</span>
      </div>
      <p>A hand when you need one. Made for Malta & Gozo.</p>
      <div>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
      </div>
      <small>© Daqqa t’Id</small>
    </footer>
  );
}
function Shell({
  children,
  user,
  demoEnabled,
  stagingDemoEnabled,
}: {
  children: React.ReactNode;
  user: User | null;
  demoEnabled: boolean;
  stagingDemoEnabled: boolean;
}) {
  return (
    <>
      <Header user={user} />
      {(demoEnabled || stagingDemoEnabled) && (
        <aside className="demo-banner" role="status">
          <strong>{stagingDemoEnabled ? "Fictional staging demo" : "Development demo mode"}</strong>
          <span>
            Profiles and bookings are test records. Payments are simulated.
          </span>
        </aside>
      )}
      <LocalityOptions />
      <main>{children}</main>
      <Footer />
    </>
  );
}
function LocalityOptions() {
  const { data: localities = [] } = useQuery({
    queryKey: ["localities"],
    queryFn: () =>
      api<{ name: string; latitude: number; longitude: number }[]>(
        "/api/localities",
      ),
  });
  return (
    <datalist id="malta-localities">
      {localities.map((place) => (
        <option value={place.name} key={place.name} />
      ))}
    </datalist>
  );
}
function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<Category[]>("/api/catalog"),
  });
}
function Hero() {
  const [q, setQ] = useState("");
  return (
    <section className="hero wrap">
      <div className="hero-copy">
        <span className="eyebrow">LOCAL HANDS. REAL CONNECTIONS.</span>
        <h1>
          A hand when
          <br />
          <em>you need one.</em>
        </h1>
        <p>
          Find a local helper, learn something new, or lend your skills. Good
          things happen when we help each other.
        </p>
        <form
          className="searchbox"
          onSubmit={(e) => {
            e.preventDefault();
            location.href = "/services?search=" + encodeURIComponent(q);
          }}
        >
          <Search />
          <input
            aria-label="What do you need help with?"
            placeholder="What do you need a hand with?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="button">
            Find help <ArrowRight size={18} />
          </button>
        </form>
        <div className="trustline">
          <ShieldCheck size={17} /> Local people • Clear requests • You choose
        </div>
      </div>
      <div
        className="hero-art"
        aria-label="Illustration of neighbors helping each other"
      >
        <div className="sun" />
        <svg
          viewBox="0 0 420 390"
          role="img"
          aria-label="Two neighbors passing a plant"
        >
          <path d="M0 350 Q105 285 205 347T420 330V390H0Z" fill="#d8aa7f" />
          <path d="M42 260 115 190l70 70v100H42Z" fill="#df8065" />
          <path d="M70 195 115 153l44 42Z" fill="#176b61" />
          <rect x="75" y="278" width="28" height="45" rx="3" fill="#f6dfad" />
          <rect x="135" y="278" width="28" height="45" rx="3" fill="#f6dfad" />
          <circle cx="254" cy="171" r="32" fill="#c67f55" />
          <path d="M219 209q35-24 69 0l14 90h-98Z" fill="#176b61" />
          <path
            d="M228 222q-40 14-67 37M274 224q27 9 48 17"
            fill="none"
            stroke="#c67f55"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <circle cx="329" cy="218" r="27" fill="#e5b88f" />
          <path d="M301 247q30-19 59 0l14 72h-86Z" fill="#e9bd59" />
          <path
            d="M320 248 300 231"
            stroke="#e5b88f"
            strokeWidth="13"
            strokeLinecap="round"
          />
          <path d="M300 276q22-24 38-2-19 7-38 2Z" fill="#628b56" />
          <path d="M318 272q10-39 25-43 0 27-25 43Z" fill="#83a36a" />
          <path
            d="M94 350v-18m47 18v-18m98 18 10-51m-39 51-7-51m116 51-2-34m45 34 2-34"
            stroke="#183a37"
            strokeWidth="10"
            strokeLinecap="round"
          />
        </svg>
        <span className="art-note">
          A little help goes a long way <Heart size={14} fill="currentColor" />
        </span>
      </div>
      <div className="hero-curve" />
    </section>
  );
}
function Home() {
  const { data: categories = [], isLoading, error } = useCatalog();
  return (
    <>
      <Hero />
      <section className="wrap section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">A GOOD PLACE TO START</span>
            <h2>What do you need a hand with?</h2>
          </div>
          <Link className="text-link" to="/services">
            See all services <ArrowRight size={17} />
          </Link>
        </div>
        {isLoading ? (
          <div className="loading">Finding services…</div>
        ) : error ? (
          <ErrorBox text="We couldn’t load the services just now." />
        ) : categories.length ? (
          <div className="category-grid">
            {categories.slice(0, 8).map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <HandHelping />
            </div>
            <h3>Our local service list is growing</h3>
            <p>
              We’re preparing useful services for communities across Malta and
              Gozo.
            </p>
            <Link className="button button-outline" to="/join">
              Offer a service <ArrowRight size={17} />
            </Link>
          </div>
        )}
      </section>
      <section className="wrap section modes">
        <div className="section-heading">
          <div>
            <span className="eyebrow">HELP YOUR WAY</span>
            <h2>Three ways to get things done</h2>
          </div>
        </div>
        <div className="mode-grid">
          {modes.map(([id, title], i) => (
            <Link to={"/find?mode=" + id} className="mode-card" key={id}>
              <span className="mode-num">0{i + 1}</span>
              <h3>{title}</h3>
              <p>
                {
                  [
                    "Find someone to take care of a task for you.",
                    "Team up with someone and do it together.",
                    "Get patient, practical guidance as you learn.",
                  ][i]
                }
              </p>
              <ChevronRight />
            </Link>
          ))}
        </div>
      </section>
      <section className="cta wrap">
        <span className="eyebrow">HAVE A SKILL TO SHARE?</span>
        <h2>
          Your know-how could
          <br />
          make someone’s day.
        </h2>
        <Link to="/join" className="button">
          Become a local helper <ArrowRight />
        </Link>
      </section>
    </>
  );
}
function CategoryCard({ category: c }: { category: Category }) {
  return (
    <Link to={"/services/" + c.slug} className="category-card">
      <span className="category-icon">
        <IconMark />
      </span>
      <span>
        <b>{c.name}</b>
        <small>{c.description}</small>
      </span>
      <ArrowRight size={17} />
    </Link>
  );
}
function ErrorBox({ text }: { text: string }) {
  return (
    <div className="error-box" role="alert">
      <strong>We hit a small snag.</strong>
      <p>{text}</p>
      <button className="text-link" onClick={() => location.reload()}>
        Try again
      </button>
    </div>
  );
}
function Services() {
  const { data: cats = [], isLoading, error } = useCatalog();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const filtered = cats.filter((c) =>
    (c.name + " " + c.description)
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <section className="wrap page">
      <span className="eyebrow">SERVICES AROUND YOU</span>
      <h1>Find the right kind of help.</h1>
      <p className="intro">
        Browse what people offer in Malta and Gozo. Availability and pricing
        come from each helper’s profile.
      </p>
      <label className="service-search">
        Search services
        <input
          aria-label="Search services"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Try gardening, repairs, lessons…"
        />
      </label>
      {error ? (
        <ErrorBox text="The service list is temporarily unavailable." />
      ) : isLoading ? (
        <div className="loading">Loading services…</div>
      ) : filtered.length ? (
        <div className="category-grid">
          {filtered.map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>
            {search
              ? "No services match that search yet"
              : "Services are being added"}
          </h3>
          <p>
            {search
              ? "Try a different word, or browse all available services."
              : "Check back soon, or be among the first to offer a helping hand."}
          </p>
          {search ? (
            <button
              className="button button-outline"
              onClick={() => setSearch("")}
            >
              Browse all services
            </button>
          ) : (
            <Link to="/join" className="button">
              Join as a helper
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
function Find() {
  const { data: cats = [] } = useCatalog();
  const [params] = useSearchParams();
  const [categoryId, setCategory] = useState(params.get("categoryId") || "");
  const [mode, setMode] = useState(params.get("mode") || "");
  const [locality, setLocality] = useState(params.get("locality") || "");
  const [available, setAvailable] = useState(false);
  const {
    data: workers = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["workers", categoryId, mode, locality, available],
    queryFn: () =>
      api<Worker[]>(
        `/api/workers?${new URLSearchParams({ ...(categoryId ? { categoryId } : {}), ...(mode ? { mode } : {}), ...(locality ? { locality } : {}), ...(available ? { availableNow: "true" } : {}) })}`,
      ),
  });
  return (
    <section className="wrap page">
      <span className="eyebrow">LOCAL HELP</span>
      <h1>Find a helper.</h1>
      <p className="intro">
        Browse real profiles and reach out when you find the right fit.
      </p>
      <div className="filters">
        <label>
          Service
          <select
            value={categoryId}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All services</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          How would you like help?
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Any way</option>
            {modes.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Your area
          <input
            list="malta-localities"
            value={locality}
            onChange={(e) => setLocality(e.target.value)}
            placeholder="e.g. Mosta"
          />
        </label>
        <label className="check-filter">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
          />{" "}
          Available now
        </label>
      </div>
      {error ? (
        <ErrorBox text="We couldn’t load helper profiles." />
      ) : isLoading ? (
        <div className="loading">Looking for local helpers…</div>
      ) : workers.length ? (
        <div className="worker-grid">
          {workers.map((w) => (
            <WorkerCard key={w.id} worker={w} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <Search />
          </div>
          <h3>No helpers match these filters yet</h3>
          <p>
            Try another area or service, or offer your skills to your community.
          </p>
          <Link to="/join" className="button">
            Become a helper
          </Link>
        </div>
      )}
    </section>
  );
}
function WorkerCard({ worker: w }: { worker: Worker }) {
  return (
    <article className="worker-card">
      <div className="avatar">
        {w.displayName
          .split(" ")
          .map((x) => x[0])
          .slice(0, 2)
          .join("")}
      </div>
      <div className="worker-main">
        <div className="worker-title">
          <h3>{w.displayName}</h3>
          {w.verificationStatus === "Verified" && (
            <span className="verified">
              <ShieldCheck size={14} /> Verified
            </span>
          )}
          {w.isDemo && <span className="demo-label">Demo profile</span>}
        </div>
        <p className="muted">
          <MapPin size={14} />
          {w.locality} <span>·</span> {w.yearsExperience} years’ experience
          {w.averageRating !== null && w.reviewCount > 0 && (
            <span className="real-rating">
              ★ {w.averageRating.toFixed(1)} · {w.reviewCount}{" "}
              {w.reviewCount === 1 ? "review" : "reviews"}
            </span>
          )}
        </p>
        <p>{w.bio || "A local helper ready to lend a hand."}</p>
        <div className="worker-footer">
          <span>
            {w.pricingType === "Quote"
              ? "Ask for a quote"
              : w.pricingType === "Fixed"
                ? "Fixed price"
                : `€${w.hourlyRate}/hour`}
          </span>
          <Link to={"/workers/" + w.id} className="text-link">
            View profile <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}
function ShareButton({ title, url }: { title: string; url?: string }) {
  const [done, setDone] = useState(false);
  const shareUrl = url || location.href;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${title} · ${shareUrl}`)}`;
  return (
    <div className="share-actions">
      <button
        className="button button-outline"
        onClick={async () => {
          if (navigator.share) await navigator.share({ title, url: shareUrl });
          else {
            await navigator.clipboard.writeText(shareUrl);
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          }
        }}
      >
        <Share2 size={17} />
        {done ? "Link copied" : "Share"}
      </button>
      <a
        className="share-whatsapp"
        href={whatsappUrl}
        target="_blank"
        rel="noreferrer"
      >
        Share on WhatsApp
      </a>
    </div>
  );
}
function WorkerDetail() {
  const { id = "" } = useParams();
  const {
    data: w,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["worker", id],
    queryFn: () =>
      api<
        Worker & {
          offerings: {
            categoryId: string;
            modes: string[];
            pricingType: string;
            price: number;
          }[];
          availability: unknown[];
          reviews: {
            id: string;
            rating: number;
            comment: string;
            customerName: string;
            createdAt: string;
          }[];
        }
      >(`/api/workers/${id}`),
  });
  if (isLoading)
    return <div className="wrap page loading">Loading profile…</div>;
  if (error || !w)
    return (
      <section className="wrap page">
        <ErrorBox text="This helper profile is unavailable." />
        <Link to="/find" className="text-link">
          Back to helpers
        </Link>
      </section>
    );
  return (
    <section className="wrap page">
      <Link to="/find" className="back-link">
        ← All helpers
      </Link>
      <div className="profile">
        <div className="profile-head">
          <div className="avatar avatar-large">
            {w.displayName
              .split(" ")
              .map((x) => x[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div>
            <div className="worker-title">
              <h1>{w.displayName}</h1>
              {w.verificationStatus === "Verified" && (
                <span className="verified">
                  <ShieldCheck size={15} /> Verified
                </span>
              )}
              {w.isDemo && <span className="demo-label">Demo profile</span>}
            </div>
            <p className="muted">
              <MapPin size={16} />
              {w.locality} <span>·</span> {w.yearsExperience} years’ experience
            </p>
          </div>
          <ShareButton title={w.displayName} />
        </div>
        <MediaPanel
          listUrl={`/api/workers/${w.id}/media`}
          kind="worker"
          canUpload={false}
        />
        <div className="profile-columns">
          <div>
            <h2>A little about me</h2>
            <p>{w.bio || "This helper has not added a bio yet."}</p>
            <h2>Services I offer</h2>
            {w.offerings.length ? (
              w.offerings.map((o, i) => (
                <p key={i}>
                  {o.pricingType === "Quote"
                    ? "Quote on request"
                    : o.pricingType === "Fixed"
                      ? `Fixed price · €${o.price}`
                      : `€${o.price} per hour`}
                </p>
              ))
            ) : (
              <p>Contact this helper to learn more.</p>
            )}
            <h2>Reviews</h2>
            {w.reviews.length ? (
              w.reviews.map((r) => (
                <blockquote key={r.id}>
                  “{r.comment}”
                  <small>
                    {r.customerName} · {r.rating}/5
                  </small>
                </blockquote>
              ))
            ) : (
              <p>No reviews yet.</p>
            )}
          </div>
          <aside className="request-card">
            <h3>Need a hand?</h3>
            <p>
              Send a request with a little detail. You can review the plan
              before confirming.
            </p>
            <Link
              to={"/bookings/new?workerId=" + w.id}
              className="button button-full"
            >
              Request this helper <ArrowRight />
            </Link>
            <small>No payment is taken on this site.</small>
          </aside>
        </div>
      </div>
    </section>
  );
}
function Auth({ register = false }: { register?: boolean }) {
  const [params] = useSearchParams();
  const [err, setErr] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(
        register ? "/api/auth/register" : "/api/auth/login",
        json(
          register
            ? { ...d, role: d.role || "Customer" }
            : { email: d.email, password: d.password },
        ),
      );
      const refreshed = await api<Session>("/api/session");
      setCsrf(refreshed.csrfToken);
      qc.setQueryData(["session"], refreshed);
      await qc.invalidateQueries();
      nav(refreshed.user?.role === "Worker" ? "/worker" : "/dashboard");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-wrap">
      <div className="auth-card">
        <span className="eyebrow">
          {register ? "JOIN YOUR COMMUNITY" : "WELCOME BACK"}
        </span>
        <h1>{register ? "Let’s get started." : "Good to see you."}</h1>
        <p>
          {register
            ? "Create your account to request help or offer your skills."
            : "Sign in to manage your requests and profile."}
        </p>
        <form className="stack-form" onSubmit={submit}>
          {register && (
            <>
              <label>
                Your name
                <input name="displayName" required autoComplete="name" />
              </label>
              <label>
                Phone number
                <input name="phone" required autoComplete="tel" />
              </label>
              <label>
                Your locality
                <input
                  name="locality"
                  list="malta-localities"
                  required
                  placeholder="e.g. Żabbar"
                />
              </label>
              {params.get("role") === "Worker" ? (
                <>
                  <input type="hidden" name="role" value="Worker" />
                  <p className="role-note">
                    Helper account · You can offer your skills on Daqqa t’Id.
                  </p>
                </>
              ) : (
                <label>
                  I want to
                  <select name="role" defaultValue="Customer">
                    <option value="Customer">Find help</option>
                    <option value="Worker">Offer my skills</option>
                  </select>
                </label>
              )}
            </>
          )}
          <label>
            Email address
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </label>
          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}
          <button className="button button-full" disabled={busy}>
            {busy ? "Please wait…" : register ? "Create account" : "Log in"}{" "}
            <ArrowRight />
          </button>
        </form>
        {!register && (
          <p className="form-foot">
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
        )}
        <p className="form-foot">
          {register ? "Already have an account?" : "New to Daqqa t’Id?"}{" "}
          <Link to={register ? "/login" : "/register"}>
            {register ? "Log in" : "Create an account"}
          </Link>
        </p>
      </div>
    </section>
  );
}
function Forgot() {
  const [msg, setMsg] = useState("");
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    try {
      const r = await api<{ message: string }>(
        "/api/auth/forgot-password",
        json({ email }),
      );
      setMsg(r.message);
    } catch (e) {
      setMsg(
        e instanceof Error ? e.message : "We couldn’t send a reset request.",
      );
    }
  }
  return (
    <section className="auth-wrap">
      <div className="auth-card">
        <span className="eyebrow">ACCOUNT ACCESS</span>
        <h1>Reset your password.</h1>
        <p>
          Enter the email address on your account. If password reset is
          available, we’ll send instructions.
        </p>
        <form className="stack-form" onSubmit={send}>
          <label>
            Email address
            <input type="email" name="email" required />
          </label>
          <button className="button button-full">Request reset link</button>
        </form>
        {msg && (
          <p role="status" className="notice">
            {msg}
          </p>
        )}
        <p className="form-foot">
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </section>
  );
}
function ResetPassword() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const email = params.get("email") || "";
  const token = params.get("token") || "";
  async function reset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const d = Object.fromEntries(new FormData(e.currentTarget));
    if (d.password !== d.confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    try {
      const r = await api<{ message: string }>(
        "/api/auth/reset-password",
        json({ email, token, password: d.password }),
      );
      setMessage(
        r.message || "Your password has been updated. You can now log in.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This reset link may have expired. Request a new one and try again.",
      );
    }
  }
  return (
    <section className="auth-wrap">
      <div className="auth-card">
        <span className="eyebrow">ACCOUNT ACCESS</span>
        <h1>Choose a new password.</h1>
        {email && (
          <p>
            Resetting the password for <b>{email}</b>.
          </p>
        )}
        {!email || !token ? (
          <>
            <p>
              This reset link is incomplete. Request a new password reset email
              to get a fresh link.
            </p>
            <Link to="/forgot-password" className="button button-full">
              Request a reset link
            </Link>
          </>
        ) : (
          <form className="stack-form" onSubmit={reset}>
            <label>
              New password
              <input
                type="password"
                name="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </label>
            <small className="help-text">
              Use at least 10 characters, with a number and an uppercase letter.
            </small>
            <label>
              Confirm new password
              <input
                type="password"
                name="confirmPassword"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="notice">
                {message} <Link to="/login">Log in</Link>
              </p>
            )}
            <button className="button button-full">Save new password</button>
          </form>
        )}
        <p className="form-foot">
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </section>
  );
}
function Join() {
  const { data } = useSession();
  const user = data?.user;
  return (
    <section className="wrap page">
      <span className="eyebrow">SHARE WHAT YOU KNOW</span>
      <h1>Become a local helper.</h1>
      <p className="intro">
        Start small. Tell us what you can help with, where you work, and when
        you’re available. You can improve your profile as you go.
      </p>
      <div className="join-steps">
        <div>
          <b>1</b>
          <h3>Make your account</h3>
          <p>A name and a way for customers to reach you.</p>
        </div>
        <div>
          <b>2</b>
          <h3>Add your skills</h3>
          <p>Choose the services and ways of working that fit you.</p>
        </div>
        <div>
          <b>3</b>
          <h3>Set your availability</h3>
          <p>Switch “Available now” on or set your usual hours.</p>
        </div>
      </div>
      <div className="join-cta">
        {user?.role === "Worker" ? (
          <Link to="/worker" className="button">
            Continue your profile <ArrowRight />
          </Link>
        ) : (
          <Link to="/register?role=Worker" className="button">
            Create a helper account <ArrowRight />
          </Link>
        )}
        <p>Regulated work may need approval before customers can request it.</p>
      </div>
    </section>
  );
}
function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/session"),
    retry: false,
  });
}
function BookingForm() {
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [chosenWorker, setChosenWorker] = useState(
    params.get("workerId") || "",
  );
  const [duration, setDuration] = useState(60);
  const [isAsap, setIsAsap] = useState(false);
  const [startAt, setStartAt] = useState(() =>
    maltaLocalDateTimeValue(new Date(Date.now() + 86400000)),
  );
  const nav = useNavigate();
  const { data: cats = [] } = useCatalog();
  const { data: workers = [] } = useQuery({
    queryKey: ["workers", "booking"],
    queryFn: () => api<Worker[]>("/api/workers"),
  });
  const worker = workers.find((w) => w.id === chosenWorker);
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const b = await api<{ id: string }>(
        "/api/bookings",
        json({
          ...d,
          workerId: chosenWorker,
          categoryId: String(d.categoryId),
          durationMinutes: duration,
          startAt: isAsap ? new Date().toISOString() : maltaLocalDateTimeToUtc(startAt),
          isAsap,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      nav("/bookings/" + b.id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Please sign in and try again.",
      );
    }
  }
  return (
    <section className="wrap page narrow">
      <Link
        to={chosenWorker ? "/workers/" + chosenWorker : "/find"}
        className="back-link"
      >
        ← Back
      </Link>
      <span className="eyebrow">A SIMPLE REQUEST</span>
      <h1>Tell them what you need.</h1>
      <p className="intro">
        This sends a request. You can review details and pricing before
        confirming.
      </p>
      <form className="stack-form" onSubmit={send}>
        <label>
          Helper
          <select
            name="workerId"
            value={chosenWorker}
            onChange={(e) => setChosenWorker(e.target.value)}
            required
          >
            <option value="">Choose a helper</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.displayName} · {w.locality}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select name="categoryId" required>
            <option value="">Choose a service</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          How would you like help?
          <select name="mode" required>
            {modes.map(([id, title]) => (
              <option value={id} key={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Short title
          <input
            name="summary"
            placeholder="e.g. Help putting up shelves"
            required
            maxLength={120}
          />
        </label>
        <label>
          What do they need to know?
          <textarea
            name="description"
            rows={4}
            required
            placeholder="A few details help the helper decide if it’s a good fit."
          />
        </label>
        <label>
          Locality
          <input
            name="locality"
            list="malta-localities"
            required
            placeholder="e.g. Birkirkara"
          />
        </label>
        <label>
          Service address{" "}
          <span className="muted">(shared after confirmation)</span>
          <input name="address" required autoComplete="street-address" />
        </label>
        <label>
          Preferred date and time
          <input
            type="datetime-local"
            name="startAt"
            value={startAt}
            disabled={isAsap}
            min={maltaLocalDateTimeValue(new Date())}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </label>
        <small className="help-text">
          {isAsap ? "ASAP uses the next few minutes, within the helper’s working hours and time off." : "Times are shown in Malta local time."}
        </small>
        <label>
          Estimated time
          <select
            name="durationMinutes"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            <option value="60">About 1 hour</option>
            <option value="120">About 2 hours</option>
            <option value="180">About 3 hours</option>
            <option value="240">Half day</option>
          </select>
        </label>
        {worker && (
          <div className="price-summary" aria-live="polite">
            <b>Price information</b>
            {worker.pricingType === "Quote" ? (
              <p>
                {worker.displayName} will provide a quote for you to review
                before booking.
              </p>
            ) : worker.pricingType === "Fixed" ? (
              <p>
                Listed price: <strong>€{worker.hourlyRate.toFixed(2)}</strong>.
                The helper will confirm the final amount.
              </p>
            ) : (
              <p>
                About {duration / 60} {duration === 60 ? "hour" : "hours"} at €
                {worker.hourlyRate.toFixed(2)}/hour:{" "}
                <strong>
                  €{((worker.hourlyRate * duration) / 60).toFixed(2)} estimate
                </strong>
                . The helper confirms the final amount.
              </p>
            )}
            <small>No payment is taken on Daqqa t’Id.</small>
          </div>
        )}
        <label className="check-filter">
          <input type="checkbox" name="isAsap" checked={isAsap} onChange={(e) => setIsAsap(e.target.checked)} /> I need help as soon as
          possible
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button button-full">
          Send request <ArrowRight />
        </button>
      </form>
    </section>
  );
}
function Dashboard() {
  const { data: session } = useSession();
  const {
    data: bookings = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["bookings"],
    queryFn: () => api<any[]>("/api/bookings"),
    enabled: !!session?.user,
  });
  return (
    <section className="wrap page">
      <span className="eyebrow">YOUR SPACE</span>
      <h1>
        Hello
        {session?.user?.displayName
          ? `, ${session.user.displayName.split(" ")[0]}`
          : ""}
        .
      </h1>
      <p className="intro">Keep track of requests and the next steps.</p>
      {!session?.user ? (
        <div className="empty">
          <p>Log in to see your requests.</p>
          <Link to="/login" className="button">
            Log in
          </Link>
        </div>
      ) : (
        <>
          <div className="dashboard-actions">
            {session.user.role === "Worker" && (
              <Link to="/worker" className="dash-tile">
                <CalendarDays />
                <b>My helper profile</b>
                <span>Set services and availability</span>
              </Link>
            )}
            {session.user.role === "Admin" && (
              <Link to="/admin" className="dash-tile">
                <ShieldCheck />
                <b>Admin workspace</b>
                <span>Manage verifications and marketplace</span>
              </Link>
            )}
            <Link to="/account" className="dash-tile">
              <ShieldCheck />
              <b>Account & privacy</b>
              <span>Update your details and requests</span>
            </Link>
            <Link to="/find" className="dash-tile">
              <Search />
              <b>Find local help</b>
              <span>Browse services and helpers</span>
            </Link>
          </div>
          <h2>Your requests</h2>
          {error ? (
            <ErrorBox text="We couldn’t load your requests." />
          ) : isLoading ? (
            <div className="loading">Loading requests…</div>
          ) : bookings.length ? (
            <div className="booking-list">
              {bookings.map((b) => (
                <Link
                  className="booking-row"
                  key={b.id}
                  to={"/bookings/" + b.id}
                >
                  <span>
                    <b>{b.summary}</b>
                    <small>
                      {b.workerName} · {b.locality}
                    </small>
                  </span>
                  <span className="status">{b.status}</span>
                  <ChevronRight />
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty compact">
              <h3>No requests yet</h3>
              <p>When you request a helper, your updates will show up here.</p>
              <Link to="/find" className="button button-outline">
                Find a helper <ArrowRight />
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}
function WorkerSetup() {
  const qc = useQueryClient();
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: cats = [] } = useCatalog();
  const { data: profile } = useQuery({
    queryKey: ["worker-profile"],
    queryFn: () => api<any>("/api/worker/profile"),
    enabled: session?.user?.role === "Worker",
  });
  const [available, setAvailable] = useState(false);
  const [notice, setNotice] = useState("");
  const [verifyNotice, setVerifyNotice] = useState("");
  const [step, setStep] = useState(1);
  const [pricingType, setPricingType] = useState("Hourly");
  const [timeOff, setTimeOff] = useState<
    { date: string; isAvailable: boolean }[]
  >([]);
  useEffect(() => {
    if (profile) {
      setAvailable(!!profile.availableNow);
      setPricingType(profile.pricingType || "Hourly");
      setTimeOff(profile.exceptions || []);
    }
  }, [profile]);
  const savedWindows = () => profile?.availability || [];
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    const categoryIds = FormDataArray(form, "categoryIds");
    const modesSelected = FormDataArray(form, "modes");
    try {
      await api("/api/worker/profile", {
        method: "PUT",
        body: JSON.stringify({
          ...d,
          yearsExperience: Number(d.yearsExperience || 0),
          radiusKm: Number(d.radiusKm || 20),
          hourlyRate: Number(d.hourlyRate || 0),
          categoryIds,
          modes: modesSelected,
          pricingType: d.pricingType || "Hourly",
        }),
      });
      const windows = weeklyWindows(form);
      await api("/api/worker/availability", {
        method: "PUT",
        body: JSON.stringify({
          availableNow: available,
          windows,
          exceptions: timeOff,
        }),
      });
      setNotice("Your profile and usual hours have been saved.");
      await qc.invalidateQueries({ queryKey: ["worker-profile"] });
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not save your profile.",
      );
    }
  }
  async function availability() {
    try {
      await api("/api/worker/availability", {
        method: "PUT",
        body: JSON.stringify({
          availableNow: !available,
          windows: savedWindows(),
          exceptions: timeOff,
        }),
      });
      setAvailable(!available);
      setNotice(
        !available
          ? "You’re marked available now."
          : "You’re no longer marked available.",
      );
      await qc.invalidateQueries({ queryKey: ["worker-profile"] });
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not update availability.",
      );
    }
  }
  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/api/worker/verification", json(d));
      setVerifyNotice(
        "Your details have been sent for review. We’ll update your profile when the review is complete.",
      );
      await qc.invalidateQueries({ queryKey: ["worker-profile"] });
    } catch (e) {
      setVerifyNotice(
        e instanceof Error ? e.message : "Could not send your details.",
      );
    }
  }
  function nextStep(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    const current = form?.querySelector<HTMLElement>(`.guide-step-${step}`);
    const invalid = current?.querySelector<HTMLInputElement>("input:invalid");
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    setStep((value) => Math.min(3, value + 1));
  }
  if (sessionLoading)
    return <div className="wrap page loading">Loading your account…</div>;
  if (session?.user?.role !== "Worker") {
    return (
      <section className="wrap page narrow">
        <span className="eyebrow">YOUR HELPER PROFILE</span>
        <h1>Set up a helper account first.</h1>
        <p className="intro">
          A helper profile has its own services and availability. Create one in
          a few simple steps.
        </p>
        <Link to="/register?role=Worker" className="button">
          Create a helper account <ArrowRight />
        </Link>
        {session?.user && (
          <p className="help-text">
            You are signed in to a customer account. You can create a separate
            helper account with another email address.
          </p>
        )}
        {!session?.user && (
          <p className="form-foot">
            <Link to="/login">Already have a helper account? Log in</Link>
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="wrap page narrow">
      <span className="eyebrow">YOUR HELPER PROFILE</span>
      <h1>Let people know how you can help.</h1>
      <p className="intro">
        Start with the basics. You can fill in more details as you go.
      </p>
      {profile?.id && (
        <div className="worker-share">
          <b>Your public profile</b>
          <ShareButton
            title={profile.displayName || "My Daqqa t’Id profile"}
            url={new URL(`/workers/${profile.id}`, location.origin).toString()}
          />
        </div>
      )}
      {profile?.id && (
        <MediaPanel
          listUrl={`/api/workers/${profile.id}/media`}
          kind="worker"
          canUpload
        />
      )}
      <button
        type="button"
        aria-pressed={available}
        className={available ? "availability on" : "availability"}
        onClick={availability}
      >
        <span className="availability-dot" />
        <span>
          <b>{available ? "Available now" : "Not available now"}</b>
          <small>Tap to change your availability</small>
        </span>
        <span className="switch" />
      </button>
      <div className="step-progress">
        <b>Step {step} of 3</b>
        <div
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={3}
          aria-label="Profile setup progress"
        >
          <span style={{ width: `${step * 33.333}%` }} />
        </div>
        <small>
          {["Your details", "Your services", "Your hours"][step - 1]}
        </small>
      </div>
      <form className="stack-form" onSubmit={save}>
        <fieldset className="guide-step guide-step-1" hidden={step !== 1}>
          <legend>Your details</legend>
          <p>Start with the details customers need to find you.</p>
          <label>
            Your display name
            <input
              name="displayName"
              defaultValue={profile?.displayName || ""}
              required
            />
          </label>
          <label>
            Your area
            <input
              name="locality"
              list="malta-localities"
              defaultValue={profile?.locality || ""}
              required
              placeholder="e.g. Rabat"
            />
          </label>
          <label>
            Years of experience
            <input
              name="yearsExperience"
              type="number"
              min="0"
              defaultValue={profile?.yearsExperience || 0}
            />
          </label>
        </fieldset>
        <fieldset className="guide-step guide-step-2" hidden={step !== 2}>
          <legend>Your services</legend>
          <p>Choose a service and the way you like to help.</p>
          <label>
            How far can you travel?
            <select name="radiusKm" defaultValue={profile?.radiusKm || 20}>
              <option value="5">Up to 5 km</option>
              <option value="10">Up to 10 km</option>
              <option value="20">Up to 20 km</option>
              <option value="40">Across Malta or Gozo</option>
            </select>
          </label>
          <fieldset>
            <legend>What can you help with?</legend>
            {cats.map((c) => (
              <label className="choice" key={c.id}>
                <input
                  type="checkbox"
                  name="categoryIds"
                  value={c.id}
                  defaultChecked={profile?.categoryIds?.includes(c.id)}
                />{" "}
                {c.name}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>How do you like to help?</legend>
            {modes.map(([id, title]) => (
              <label className="choice" key={id}>
                <input
                  type="checkbox"
                  name="modes"
                  value={id}
                  defaultChecked={profile?.modes?.includes(id)}
                />{" "}
                {title}
              </label>
            ))}
          </fieldset>
          <label>
            How do you charge?
            <select
              name="pricingType"
              value={pricingType}
              onChange={(e) => setPricingType(e.target.value)}
            >
              <option value="Hourly">By the hour</option>
              <option value="Fixed">One fixed price</option>
              <option value="Quote">I’ll agree a price first</option>
            </select>
          </label>
          <label>
            {pricingType === "Fixed"
              ? "Fixed price (€)"
              : pricingType === "Quote"
                ? "Optional starting price (€)"
                : "Hourly rate (€)"}
            <input
              name="hourlyRate"
              type="number"
              min="0"
              step="0.50"
              defaultValue={profile?.hourlyRate || ""}
              aria-describedby="price-help"
            />
          </label>
          <small id="price-help" className="help-text">
            Enter your hourly or fixed price. Leave 0 if you prefer to agree a
            quote.
          </small>
          <label>
            A little about you (optional)
            <textarea
              name="bio"
              rows={3}
              defaultValue={profile?.bio || ""}
              placeholder="Tell customers what you enjoy helping with."
            />
          </label>
        </fieldset>
        <fieldset className="guide-step guide-step-3" hidden={step !== 3}>
          <legend>Your usual hours</legend>
          <p>
            Set your usual times. You can also switch “Available now” on or off
            above.
          </p>
          <fieldset className="schedule">
            <legend>Usual hours (optional)</legend>
            <p>
              Pick the days and times you normally work. You can change these
              any time.
            </p>
            {[
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
            ].map((day, index) => {
              const dayOfWeek = (index + 1) % 7;
              const existing = (profile?.availability || []).find(
                (w: any) => w.dayOfWeek === dayOfWeek,
              );
              return (
                <div className="schedule-row" key={day}>
                  <b>{day}</b>
                  <label>
                    <span className="sr-only">{day} start time</span>
                    <input
                      type="time"
                      name={`schedule-start-${index}`}
                      defaultValue={existing?.startTime || ""}
                    />
                  </label>
                  <span>to</span>
                  <label>
                    <span className="sr-only">{day} end time</span>
                    <input
                      type="time"
                      name={`schedule-end-${index}`}
                      defaultValue={existing?.endTime || ""}
                    />
                  </label>
                </div>
              );
            })}
          </fieldset>
          <fieldset className="time-off">
            <legend>Dates off (optional)</legend>
            <p>
              Add a date when your usual hours are different. Press “Save my
              profile &amp; hours” when you’re finished.
            </p>
            <label>
              Date
              <input type="date" name="timeOffDate" />
            </label>
            <label>
              For this date, I am
              <select name="timeOffAvailable" defaultValue="false">
                <option value="false">Not available</option>
                <option value="true">Available</option>
              </select>
            </label>
            <button
              className="button button-outline"
              type="button"
              onClick={(event) => {
                const form = event.currentTarget.form;
                const date = (
                  form?.elements.namedItem(
                    "timeOffDate",
                  ) as HTMLInputElement | null
                )?.value;
                const isAvailable =
                  (
                    form?.elements.namedItem(
                      "timeOffAvailable",
                    ) as HTMLSelectElement | null
                  )?.value === "true";
                if (!date) {
                  setNotice("Choose a date first.");
                  return;
                }
                setTimeOff((current) =>
                  [
                    ...current.filter((item) => item.date !== date),
                    { date, isAvailable },
                  ].sort((a, b) => a.date.localeCompare(b.date)),
                );
                setNotice(
                  `${date} added. Save your profile to keep this change.`,
                );
              }}
            >
              Add date
            </button>
            {timeOff.length > 0 && (
              <ul className="time-off-list">
                {timeOff.map((item) => (
                  <li key={item.date}>
                    <span>
                      <b>{item.date}</b> ·{" "}
                      {item.isAvailable ? "Available" : "Not available"}
                    </span>
                    <button
                      className="text-button"
                      type="button"
                      aria-label={`Remove ${item.date}`}
                      onClick={() =>
                        setTimeOff((current) =>
                          current.filter((date) => date.date !== item.date),
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </fieldset>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div className="guide-nav">
          {step > 1 && (
            <button
              type="button"
              className="button button-outline"
              onClick={() => setStep((value) => value - 1)}
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button type="button" className="button" onClick={nextStep}>
              Continue <ArrowRight />
            </button>
          ) : (
            <button className="button">
              Save my profile & hours <CheckCircle2 />
            </button>
          )}
        </div>
      </form>
      <details className="verification-panel">
        <summary>
          <ShieldCheck />
          <span>
            <b>Verification · {profile?.verificationStatus || "Unverified"}</b>
            <small>
              Optional unless a service requires it. Add a licence or proof of
              experience.
            </small>
          </span>
        </summary>
        <div className="verification-content">
          <p>
            Some services need verification before customers can request them.
            If you have a licence or proof of experience, you can share its
            reference with the review team.
          </p>
          <form className="stack-form" onSubmit={verify}>
            <label>
              Licence or document reference
              <input
                name="reference"
                defaultValue={profile?.verificationReference || ""}
                required
              />
            </label>
            <label>
              Short note
              <textarea
                name="notes"
                rows={2}
                defaultValue={profile?.verificationNotes || ""}
                placeholder="Tell us what this document shows."
              />
            </label>
            <button className="button button-outline">
              Send for review <ArrowRight />
            </button>
          </form>
          {verifyNotice && (
            <p role="status" className="notice">
              {verifyNotice}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
function weeklyWindows(form: HTMLFormElement) {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const startTime = (
      form.elements.namedItem(`schedule-start-${dayOfWeek}`) as HTMLInputElement
    ).value;
    const endTime = (
      form.elements.namedItem(`schedule-end-${dayOfWeek}`) as HTMLInputElement
    ).value;
    return startTime && endTime
      ? { dayOfWeek: (dayOfWeek + 1) % 7, startTime, endTime }
      : null;
  }).filter(
    (x): x is { dayOfWeek: number; startTime: string; endTime: string } =>
      x !== null,
  );
}
function FormDataArray(form: HTMLFormElement, name: string) {
  return Array.from(
    form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`),
  ).map((x) => x.value);
}
function Account() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const isCustomer = session?.user?.role === "Customer";
  const {
    data: me,
    isLoading,
    error,
  } = useQuery({ queryKey: ["me"], queryFn: () => api<any>("/api/me") });
  const { data: addresses = [] } = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api<any[]>("/api/me/addresses"),
    enabled: isCustomer,
  });
  const [notice, setNotice] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/api/me", { method: "PUT", body: JSON.stringify(d) });
      setNotice("Your details have been updated.");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not update your details.",
      );
    }
  }
  async function privacy(kind: string) {
    try {
      const r = await api<{ message: string }>(
        "/api/me/privacy-request",
        json({ kind }),
      );
      setNotice(r.message);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not send your request.",
      );
    }
  }
  async function addAddress(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/api/me/addresses", json(d));
      setNotice("Address saved.");
      qc.invalidateQueries({ queryKey: ["addresses"] });
      e.currentTarget.reset();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save address.");
    }
  }
  if (error)
    return (
      <section className="wrap page">
        <ErrorBox text="Log in to manage your account." />
        <Link to="/login" className="button">
          Log in
        </Link>
      </section>
    );
  if (isLoading)
    return <div className="wrap page loading">Loading account…</div>;
  return (
    <section className="wrap page narrow">
      <span className="eyebrow">YOUR ACCOUNT</span>
      <h1>Keep your details up to date.</h1>
      <form className="stack-form" onSubmit={save}>
        <label>
          Name
          <input name="displayName" defaultValue={me.displayName} required />
        </label>
        <label>
          Phone
          <input name="phone" defaultValue={me.phone || ""} />
        </label>
        <label>
          Locality
          <input
            name="locality"
            list="malta-localities"
            defaultValue={me.locality || ""}
          />
        </label>
        <button className="button">Save details</button>
      </form>
      {isCustomer && (
        <>
          <h2>Saved addresses</h2>
          {addresses.map((a: any) => (
            <div className="address-row" key={a.id}>
              <span>
                <b>{a.label}</b>
                <small>
                  {a.address}, {a.locality}
                </small>
              </span>
              <button
                className="text-link"
                onClick={async () => {
                  await api("/api/me/addresses/" + a.id, { method: "DELETE" });
                  qc.invalidateQueries({ queryKey: ["addresses"] });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <form className="stack-form address-form" onSubmit={addAddress}>
            <h3>Add an address</h3>
            <label>
              Label
              <input name="label" placeholder="Home" required />
            </label>
            <label>
              Address
              <input name="address" required />
            </label>
            <label>
              Locality
              <input name="locality" list="malta-localities" required />
            </label>
            <button className="button button-outline">
              <Plus /> Save address
            </button>
          </form>
        </>
      )}
      <h2>Privacy requests</h2>
      <p>
        Request a copy of your personal data or ask the team to review account
        deletion.
      </p>
      <div className="privacy-actions">
        <button
          className="button button-outline"
          onClick={() => privacy("Export")}
        >
          Request my data
        </button>
        <button
          className="button button-quiet"
          onClick={() => privacy("Delete")}
        >
          Request account deletion
        </button>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
function BookingDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [notice, setNotice] = useState("");
  const { data: session } = useSession();
  const { data: workerProfile } = useQuery({
    queryKey: ["worker-profile"],
    queryFn: () => api<any>("/api/worker/profile"),
    enabled: session?.user?.role === "Worker",
  });
  const {
    data: b,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api<any>("/api/bookings/" + id),
  });
  async function action(action: string, amount?: number) {
    try {
      await api(
        "/api/bookings/" + id + "/action",
        json({ action, ...(amount !== undefined ? { amount } : {}) }),
      );
      await qc.invalidateQueries({ queryKey: ["booking", id] });
      await qc.invalidateQueries({ queryKey: ["bookings"] });
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not update this request.",
      );
    }
  }
  if (isLoading)
    return <div className="wrap page loading">Loading request…</div>;
  if (error || !b)
    return (
      <section className="wrap page">
        <ErrorBox text="This request is unavailable." />
      </section>
    );
  const customer =
    session?.user?.role === "Customer" && session.user.id === b.customerId;
  const worker =
    session?.user?.role === "Worker" && workerProfile?.id === b.workerId;
  const admin = session?.user?.role === "Admin";
  const confirmed = ["Confirmed", "InProgress", "Completed"].includes(b.status);
  const displayAmount = b.quoteAmount ?? b.amount;
  const statusLabels: Record<string, string> = {
    Requested: "Waiting for helper",
    WorkerAccepted: "Helper accepted",
    InProgress: "In progress",
    Confirmed: "Confirmed",
    Completed: "Completed",
    Quoted: "Quote received",
    Cancelled: "Cancelled",
    Expired: "Expired",
  };
  return (
    <section className="wrap page narrow">
      <Link to="/dashboard" className="back-link">
        ← My space
      </Link>
      <span className="eyebrow">REQUEST DETAILS</span>
      <h1>{b.summary}</h1>
      <div className="status-pill">{statusLabels[b.status] || b.status}</div>
      <div className="booking-info">
        <p>
          <b>Helper</b>
          {b.workerName}
        </p>
        <p>
          <b>Service</b>
          {b.categoryName}
        </p>
        <p>
          <b>When</b>
          {formatMaltaDateTime(b.startAt)}
        </p>
        <p>
          <b>Where</b>
          {b.address || b.locality}
        </p>
        <p>
          <b>Details</b>
          {b.description}
        </p>
      </div>
      {displayAmount !== null && displayAmount !== undefined && (
        <div
          className="price-summary booking-price"
          aria-label="Price breakdown"
        >
          <h2>
            {confirmed ? "Confirmed service price" : "Estimated service price"}
          </h2>
          <p>
            <span>Service price</span>
            <b>€{displayAmount.toFixed(2)}</b>
          </p>
          <p>
            <span>Platform service fee</span>
            <b>€0.00</b>
          </p>
          <p className="price-total">
            <span>Simulated total</span>
            <b>€{displayAmount.toFixed(2)}</b>
          </p>
          <small>No payment is taken on Daqqa t’Id.</small>
          {(worker || admin) && b.commissionAmount != null && (
            <div className="worker-earnings">
              <p>
                <span>Worker earnings</span>
                <b>€{(displayAmount - b.commissionAmount).toFixed(2)}</b>
              </p>
              <p>
                <span>Platform commission</span>
                <b>€{b.commissionAmount.toFixed(2)}</b>
              </p>
              <small>Recorded for this simulated completed booking.</small>
            </div>
          )}
        </div>
      )}
      {(customer || worker) &&
        (confirmed ? (
          <MediaPanel
            listUrl={`/api/bookings/${b.id}/media`}
            kind="booking"
            bookingId={b.id}
            canUpload
            privatePhotos
          />
        ) : (
          <p className="photo-limit-note">
            Booking photos can be shared here after the booking is confirmed.
            Describe any photos you need in the request for now.
          </p>
        ))}
      <div className="action-row">
        {worker && b.status === "Requested" && (
          <>
            <button
              className="button button-outline"
              onClick={() => action("decline")}
            >
              Decline
            </button>
            <button className="button" onClick={() => action("accept")}>
              Accept request
            </button>
            <button
              className="button button-outline"
              onClick={() => {
                const v = prompt("Your quote in euros");
                if (v) void action("quote", Number(v));
              }}
            >
              Send a quote
            </button>
          </>
        )}
        {customer && b.status === "Quoted" && (
          <button className="button" onClick={() => action("confirm")}>
            Confirm this quote
          </button>
        )}
        {customer && b.status === "WorkerAccepted" && (
          <button className="button" onClick={() => action("confirm")}>
            Confirm booking
          </button>
        )}
        {worker && b.status === "Confirmed" && (
          <button className="button" onClick={() => action("start")}>
            Start service
          </button>
        )}
        {worker && b.status === "InProgress" && (
          <button className="button" onClick={() => action("complete")}>
            Mark complete
          </button>
        )}
        {customer &&
          ["Requested", "Quoted", "WorkerAccepted", "Confirmed"].includes(
            b.status,
          ) && (
            <button
              className="button button-quiet"
              onClick={() => action("cancel")}
            >
              Cancel request
            </button>
          )}
      </div>
      {customer && b.status === "Completed" && !b.review && (
        <ReviewForm
          id={id}
          onDone={() => qc.invalidateQueries({ queryKey: ["booking", id] })}
        />
      )}
      {b.review && <p className="notice">Thanks for sharing your review.</p>}
      {notice && (
        <p role="alert" className="form-error">
          {notice}
        </p>
      )}
    </section>
  );
}
function ReviewForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [notice, setNotice] = useState("");
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(
        "/api/bookings/" + id + "/review",
        json({ ...d, rating: Number(d.rating) }),
      );
      setNotice("Thank you for sharing your experience.");
      onDone();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not submit your review.",
      );
    }
  }
  return (
    <form className="stack-form review-form" onSubmit={send}>
      <h2>How did it go?</h2>
      <label>
        Your rating
        <select name="rating">
          <option value="5">5 · Great</option>
          <option value="4">4 · Good</option>
          <option value="3">3 · Okay</option>
          <option value="2">2 · Not great</option>
          <option value="1">1 · Poor</option>
        </select>
      </label>
      <label>
        Your review
        <textarea name="comment" rows={3} required />
      </label>
      <button className="button">Share review</button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
function Admin() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const enabled = session?.user?.role === "Admin";
  const [notice, setNotice] = useState("");
  const overview = useQuery({
    queryKey: ["admin"],
    queryFn: () => api<any>("/api/admin/overview"),
    enabled,
  });
  const workers = useQuery({
    queryKey: ["admin-workers"],
    queryFn: () => api<any[]>("/api/admin/workers"),
    enabled,
  });
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<any[]>("/api/admin/users"),
    enabled,
  });
  const categories = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api<Category[]>("/api/catalog"),
    enabled,
  });
  const payments = useQuery({
    queryKey: ["admin-payments"],
    queryFn: () => api<any[]>("/api/admin/payments"),
    enabled,
  });
  const audits = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => api<any[]>("/api/admin/audit"),
    enabled,
  });
  const privacy = useQuery({
    queryKey: ["admin-privacy"],
    queryFn: () => api<any[]>("/api/admin/privacy-requests"),
    enabled,
  });
  if (!enabled)
    return (
      <section className="wrap page">
        <span className="eyebrow">ADMIN</span>
        <h1>Team workspace</h1>
        <p>
          Sign in with an authorized admin account to manage the marketplace.
        </p>
        <Link to="/login" className="button">
          Log in
        </Link>
      </section>
    );
  async function run(path: string, body: unknown) {
    try {
      await api(path, json(body));
      setNotice("Saved. The change is now recorded.");
      await qc.invalidateQueries({ queryKey: ["admin"] });
      await qc.invalidateQueries({ queryKey: ["admin-workers"] });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      await qc.invalidateQueries({ queryKey: ["admin-categories"] });
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      await qc.invalidateQueries({ queryKey: ["admin-payments"] });
      await qc.invalidateQueries({ queryKey: ["admin-audit"] });
      await qc.invalidateQueries({ queryKey: ["admin-privacy"] });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save this change.");
    }
  }
  return (
    <section className="wrap page">
      <span className="eyebrow">ADMIN WORKSPACE</span>
      <h1>Marketplace overview.</h1>
      {overview.error ? (
        <ErrorBox text="Could not load the admin overview." />
      ) : overview.isLoading ? (
        <div className="loading">Loading overview…</div>
      ) : (
        <div className="stats-grid">
          {Object.entries(overview.data || {}).map(([key, val]) => (
            <div className="stat" key={key}>
              <small>{key.replace(/([A-Z])/g, " $1")}</small>
              <b>{String(val)}</b>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <h2>Helper verification</h2>
      {workers.error ? (
        <ErrorBox text="Could not load helper reviews." />
      ) : workers.isLoading ? (
        <div className="loading">Loading helper profiles…</div>
      ) : workers.data?.length ? (
        <div className="admin-list">
          {workers.data.map((row: any) => {
            const w = row.worker;
            return (
              <article className="admin-row" key={w.id}>
                <span>
                  <b>{w.displayName}</b>
                  <small>
                    {w.locality} · {w.verificationStatus}
                    {row.verificationReference
                      ? ` · ${row.verificationReference}`
                      : ""}
                  </small>
                  {row.verificationNotes && (
                    <small>{row.verificationNotes}</small>
                  )}
                </span>
                <span className="admin-row-actions">
                  <button
                    className="button button-outline"
                    onClick={() =>
                      run(`/api/admin/workers/${w.id}/verification`, {
                        status: "Verified",
                      })
                    }
                  >
                    Verify
                  </button>
                  <button
                    className="button button-quiet"
                    onClick={() =>
                      run(`/api/admin/workers/${w.id}/verification`, {
                        status: "Rejected",
                      })
                    }
                  >
                    Reject
                  </button>
                </span>
              </article>
            );
          })}
        </div>
      ) : (
        <p>No helper profiles have requested verification.</p>
      )}
      <h2>Service categories</h2>
      <AdminCategoryForm categories={categories.data || []} saving={run} />
      <h2>Accounts</h2>
      {users.error ? (
        <ErrorBox text="Could not load user accounts." />
      ) : users.isLoading ? (
        <div className="loading">Loading accounts…</div>
      ) : users.data?.length ? (
        <div className="admin-list">
          {users.data.map((u: any) => (
            <article className="admin-row" key={u.id}>
              <span>
                <b>{u.displayName}</b>
                <small>
                  {u.email} · {u.role} ·{" "}
                  {u.isSuspended ? "Suspended" : "Active"}
                </small>
              </span>
              <button
                className={
                  u.isSuspended
                    ? "button button-outline"
                    : "button button-quiet"
                }
                onClick={() =>
                  run(`/api/admin/users/${u.id}/status`, {
                    isSuspended: !u.isSuspended,
                  })
                }
              >
                {u.isSuspended ? "Restore access" : "Suspend access"}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p>No accounts yet.</p>
      )}
      <h2>Commission settings</h2>
      <form
        className="admin-setting"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void run("/api/admin/settings", {
            commissionPercent: Number(d.get("commissionPercent")),
          });
        }}
      >
        <label>
          Commission percentage
          <input
            type="number"
            name="commissionPercent"
            min="0"
            max="100"
            step="0.1"
            defaultValue={overview.data?.commissionPercent ?? 12}
          />
        </label>
        <button className="button">Save setting</button>
      </form>
      <h2>Payments</h2>
      <AdminDataList
        loading={payments.isLoading}
        error={!!payments.error}
        rows={payments.data || []}
        empty="No simulated payments yet."
        fields={[
          "bookingId",
          "amount",
          "commissionAmount",
          "status",
          "isSimulated",
          "createdAt",
        ]}
      />
      <h2>Privacy requests</h2>
      <AdminDataList
        loading={privacy.isLoading}
        error={!!privacy.error}
        rows={privacy.data || []}
        empty="No privacy requests."
        fields={["userId", "kind", "createdAt"]}
      />
      <h2>Recent audit records</h2>
      <AdminDataList
        loading={audits.isLoading}
        error={!!audits.error}
        rows={audits.data || []}
        empty="No audit records yet."
        fields={["action", "actorId", "details", "createdAt"]}
      />
    </section>
  );
}
function AdminCategoryForm({
  categories,
  saving,
}: {
  categories: Category[];
  saving: (path: string, body: unknown) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const category = categories.find((c) => c.id === selected);
  return (
    <form
      className="admin-category stack-form"
      key={selected || "new"}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const d = Object.fromEntries(new FormData(form));
        const modes = FormDataArray(form, "modes");
        const body = {
          name: d.name,
          slug: d.slug,
          description: d.description,
          icon: d.icon || "hand",
          requiresVerification: d.requiresVerification === "on",
          isActive: d.isActive === "on",
          modes,
        };
        void saving(
          selected
            ? `/api/admin/categories/${selected}`
            : "/api/admin/categories",
          body,
        );
      }}
    >
      <label>
        Edit an existing category
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Create a new category</option>
          {categories.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input name="name" defaultValue={category?.name || ""} required />
      </label>
      <label>
        URL name
        <input name="slug" defaultValue={category?.slug || ""} required />
      </label>
      <label>
        Short description
        <textarea
          name="description"
          rows={2}
          defaultValue={category?.description || ""}
        />
      </label>
      <label>
        Icon name
        <input name="icon" defaultValue={category?.icon || "hand"} />
      </label>
      <fieldset>
        <legend>Ways to help</legend>
        {modes.map(([id, title]) => (
          <label className="choice" key={id}>
            <input
              type="checkbox"
              name="modes"
              value={id}
              defaultChecked={category?.modes.includes(id)}
            />{" "}
            {title}
          </label>
        ))}
      </fieldset>
      <label className="choice">
        <input
          type="checkbox"
          name="requiresVerification"
          defaultChecked={category?.requiresVerification}
        />{" "}
        Requires verification
      </label>
      <label className="choice">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={category?.isActive ?? true}
        />{" "}
        Active
      </label>
      <button className="button">
        {selected ? "Save category" : "Add category"} <ArrowRight />
      </button>
    </form>
  );
}
function AdminDataList({
  loading,
  error,
  rows,
  empty,
  fields,
}: {
  loading: boolean;
  error: boolean;
  rows: any[];
  empty: string;
  fields: string[];
}) {
  if (error) return <ErrorBox text="Could not load records." />;
  if (loading) return <div className="loading">Loading records…</div>;
  if (!rows.length) return <p>{empty}</p>;
  return (
    <div className="record-list">
      {rows.slice(0, 20).map((row: any, i) => (
        <article className="record-row" key={row.id || i}>
          {fields.map((field) => (
            <span key={field}>
              <small>{field.replace(/([A-Z])/g, " $1")}</small>
              <b>{String(row[field] ?? "—")}</b>
            </span>
          ))}
        </article>
      ))}
    </div>
  );
}
function Legal({ privacy = false }) {
  return (
    <section className="wrap page narrow">
      <span className="eyebrow">DAQQA T’ID</span>
      <h1>{privacy ? "Privacy" : "Terms of use"}</h1>
      <div className="legal-placeholder">
        <h2>Under legal review</h2>
        <p>
          This page will explain how Daqqa t’Id handles{" "}
          {privacy ? "personal information" : "using the service"} in clear
          language for Malta and Gozo.
        </p>
        <p>
          For now, manage your saved information in{" "}
          <Link to="/account">Account & privacy</Link> and send a privacy
          request from your account.
        </p>
      </div>
    </section>
  );
}
function ServiceDetail() {
  const { slug = "" } = useParams();
  const { data: cats = [] } = useCatalog();
  const c = cats.find((x) => x.slug === slug);
  const { data: workers = [], isLoading } = useQuery({
    queryKey: ["service-workers", c?.id],
    queryFn: () =>
      api<Worker[]>(`/api/workers?categoryId=${encodeURIComponent(c!.id)}`),
    enabled: !!c,
  });
  if (!c)
    return (
      <section className="wrap page">
        <h1>Service not found.</h1>
        <Link to="/services" className="button">
          Explore services
        </Link>
      </section>
    );
  return (
    <section className="wrap page">
      <span className="eyebrow">LOCAL SERVICE</span>
      <h1>{c.name}</h1>
      <p className="intro">{c.description}</p>
      <Link to={"/find?categoryId=" + c.id} className="button">
        Browse helpers <ArrowRight />
      </Link>
      <h2 className="spaced">Helpers offering {c.name.toLowerCase()}</h2>
      {isLoading ? (
        <div className="loading">Loading profiles…</div>
      ) : workers.length ? (
        <div className="worker-grid">
          {workers.map((w) => (
            <WorkerCard key={w.id} worker={w} />
          ))}
        </div>
      ) : (
        <div className="empty compact">
          <h3>No profiles for this service just yet</h3>
          <p>Help us grow this category by sharing your skills.</p>
          <Link to="/join" className="button button-outline">
            Offer this service
          </Link>
        </div>
      )}
    </section>
  );
}
function DemoLogin() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState("");
  const { data: s } = useSession();
  if (!s?.demoEnabled) return null;
  return (
    <div className="demo-box">
      <b>Development demo access</b>
      <p>
        Choose a demo workspace. Fictional demo profiles are marked by the
        service.
      </p>
      <div>
        {(["customer", "worker", "admin"] as const).map((persona) => (
          <button
            key={persona}
            className="button button-quiet"
            onClick={async () => {
              try {
                await api("/api/auth/demo", json({ persona }));
                const refreshed = await api<Session>("/api/session");
                setCsrf(refreshed.csrfToken);
                qc.setQueryData(["session"], refreshed);
                await qc.invalidateQueries();
                location.href = "/dashboard";
              } catch (e) {
                setNotice(
                  e instanceof Error ? e.message : "Demo sign-in unavailable.",
                );
              }
            }}
          >
            {persona}
          </button>
        ))}
      </div>
      {notice && <small>{notice}</small>}
    </div>
  );
}
export default function App() {
  const { data: s } = useSession();
  useEffect(() => {
    setCsrf(s?.csrfToken || "");
  }, [s?.csrfToken]);
  return (
    <Shell user={s?.user || null} demoEnabled={!!s?.demoEnabled} stagingDemoEnabled={!!s?.stagingDemoEnabled}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/services" element={<Services />} />
        <Route path="/services/:slug" element={<ServiceDetail />} />
        <Route path="/find" element={<Find />} />
        <Route path="/workers/:id" element={<WorkerDetail />} />
        <Route path="/bookings/new" element={<BookingForm />} />
        <Route path="/bookings/:id" element={<BookingDetail />} />
        <Route path="/join" element={<Join />} />
        <Route
          path="/login"
          element={
            <>
              <Auth />
              <div className="wrap">
                <DemoLogin />
              </div>
            </>
          }
        />
        <Route path="/register" element={<Auth register />} />
        <Route path="/forgot-password" element={<Forgot />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/worker" element={<WorkerSetup />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/privacy" element={<Legal privacy />} />
        <Route path="/terms" element={<Legal />} />
        <Route
          path="*"
          element={
            <section className="wrap page">
              <h1>Page not found.</h1>
              <Link to="/" className="button">
                Back to home
              </Link>
            </section>
          }
        />
      </Routes>
    </Shell>
  );
}
