import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "./api";

type SupportOffer = { enabled: boolean; checkoutUrl: string | null };

function useSupportOffer() {
  return useQuery({
    queryKey: ["optional-support"],
    queryFn: () => api<SupportOffer>("/api/support"),
    staleTime: 60_000,
    retry: false,
  });
}

function checkoutUrl(offer: SupportOffer | undefined) {
  if (!offer?.enabled || !offer.checkoutUrl) return null;
  try {
    const url = new URL(offer.checkoutUrl);
    return url.protocol === "https:" && url.host === "buy.stripe.com" &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^\/[a-zA-Z0-9]+$/.test(url.pathname)
      ? url.href : null;
  } catch {
    return null;
  }
}

export function OptionalSupportCard() {
  const { data } = useSupportOffer();
  if (!checkoutUrl(data)) return null;
  return (
    <aside className="support-card" aria-labelledby="support-heading">
      <h2 id="support-heading">Was Daqqa t’Id useful?</h2>
      <p>If we helped you find the right person, you can make an optional one-off payment to support the platform.</p>
      <Link className="text-link" to="/support">See optional support</Link>
      <small>You can keep using the service without paying. This is separate from your helper’s price.</small>
    </aside>
  );
}

export function SupportPage() {
  const offer = useSupportOffer();
  const url = checkoutUrl(offer.data);
  return (
    <section className="wrap page narrow">
      <span className="eyebrow">YOUR CHOICE</span>
      <h1>Support a useful local service.</h1>
      <p className="intro">Find local skills, compare published prices and availability, and keep your requests and booking updates together.</p>
      <div className="support-card">
        <h2>Pay only if it was useful to you</h2>
        <p>An optional one-off payment supports Daqqa t’Id. It does not change your access, search results or a helper’s response.</p>
        {offer.isPending ? <p role="status">Checking payment availability…</p> : url ? (
          <>
            <a className="button" href={url} rel="noreferrer">Choose an amount on Stripe</a>
            <p className="section-note"><small>Stripe shows the final amount and payment terms before you pay. This is separate from the service price agreed with your helper. There is no subscription. Your receipt comes from Stripe; returning here does not confirm a payment.</small></p>
          </>
        ) : (
          <p role="status">{offer.isError ? "Payment availability could not be checked. You can continue using Daqqa t’Id." : "Optional payments are not connected here yet. You can continue using Daqqa t’Id."}</p>
        )}
        <Link className="text-link" to="/services">Keep exploring services</Link>
        <p><Link className="text-link" to="/contact">Contact us about platform support</Link></p>
      </div>
    </section>
  );
}
