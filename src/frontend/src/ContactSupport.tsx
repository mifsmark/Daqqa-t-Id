export const supportContact = {
  email: "markanthonymifsud@yahoo.com",
  emailUrl: "mailto:markanthonymifsud@yahoo.com",
  whatsappNumber: "+356 9989 4619",
  whatsappUrl: "https://wa.me/35699894619",
};

export function ContactLinks({ compact = false }: { compact?: boolean }) {
  return (
    <address className={`support-contacts${compact ? " support-contacts-compact" : ""}`}>
      <a className={compact ? "" : "button"} href={supportContact.whatsappUrl} target="_blank" rel="noopener noreferrer">
        WhatsApp: {supportContact.whatsappNumber}
      </a>
      <a className={compact ? "" : "button button-outline"} href={supportContact.emailUrl}>
        {supportContact.email}
      </a>
    </address>
  );
}

export function ContactPage() {
  return (
    <section className="wrap page narrow">
      <span className="eyebrow">HERE TO HELP</span>
      <h1>Contact Daqqa t’Id</h1>
      <p className="intro">Get help with joining, your helper profile, using the app or a booking.</p>
      <ContactLinks />
      <p>Tell us briefly what you need help with. Include your booking reference if it is relevant.</p>
      <p className="section-note"><small>Keep passwords, card details and identity documents out of messages.</small></p>
    </section>
  );
}
