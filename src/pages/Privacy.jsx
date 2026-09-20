import { Link, useNavigate } from 'react-router-dom'
import './InfoPage.css'

// Public legal page: MingleMate Privacy Policy.
// Written against the platform's ACTUAL, verifiable data practices
// (see supabase/sql RLS bundles + edge functions): column-scoped
// public profiles, contact details hidden until paid Connect unlock,
// snapshot copies at unlock time, questionnaire answers used only for
// matching, M-Pesa payments via edge functions, PostHog/Sentry with
// no message payloads. Bracketed values are deliberate placeholders
// the operator must fill (identity, dates, DPO contact) — same rule
// as the Terms page. Not legal advice; operator should have Kenyan
// counsel review before relying on it.
export default function Privacy() {
  const navigate = useNavigate()

  return (
    <div className="info-page">
      <nav className="info-nav">
        <Link to="/" className="info-logo" style={{ textDecoration: 'none' }}>MingleMate</Link>
        <button className="info-cta" onClick={() => navigate('/signup')}>Sign Up</button>
      </nav>

      <main className="info-main">
        <h1>MingleMate Privacy Policy</h1>
        <p className="info-lede">
          How MingleMate collects, uses, shares and protects your personal data —
          written for Kenyan law, in plain language.
        </p>

        <p className="legal-note">
          Effective Date: [INSERT DATE]<br />
          Last Updated: [INSERT DATE]<br />
          Data Protection Officer / Privacy Contact: [INSERT PRIVACY EMAIL]
        </p>

        <p>
          This Policy explains how <strong>MingleMate</strong> ("MingleMate", "we", "us", "our")
          handles personal data when you use the MingleMate website and application (the
          "Platform"). It is issued under and describes practices consistent with the{' '}
          <strong>Data Protection Act, 2019 (Kenya)</strong> ("the DPA") and related Kenyan law.
          It forms part of the agreement between you and MingleMate described in the{' '}
          <Link to="/terms">Terms of Service</Link>.
        </p>
        <p>
          <strong>Our privacy model in one sentence:</strong> your identity and questionnaire
          answers power matching; your contact details stay hidden from everyone until you choose
          to allow them to be unlocked; and we collect as little beyond that as the service
          allows.
        </p>

        <h2>1. Who we are</h2>
        <p>
          MingleMate is operated by [INSERT LEGAL ENTITY NAME], [INSERT ADDRESS]
          ("the operator"). For data-protection purposes, the operator is the data
          controller of personal data processed through the Platform. The operator is registered
          with the Office of the Data Protection Commissioner (ODPC) as a data controller [
          INSERT ODPC REGISTRATION NUMBER once issued].
        </p>
        <p>
          Questions, requests or complaints about personal data can be sent to{' '}
          [INSERT PRIVACY EMAIL]. You also have the right to complain to the{' '}
          <strong>Office of the Data Protection Commissioner</strong> if you believe your rights
          have been infringed.
        </p>

        <h2>2. The personal data we collect</h2>
        <h3>2.1 Account data</h3>
        <ul>
          <li><strong>Email address</strong> — to create your account, authenticate you, and send you service emails (for example sign-in codes).</li>
          <li><strong>Password</strong> — stored only as a salted hash by our authentication provider (Supabase Auth). We never see or store your plaintext password.</li>
        </ul>

        <h3>2.2 Profile data you provide</h3>
        <ul>
          <li><strong>Name and age</strong> — shown to matched users.</li>
          <li><strong>Photos</strong> — exactly two: a facial photo and a full-body photo, stored in our cloud storage bucket.</li>
          <li><strong>Bio and interests</strong> — shown on your profile.</li>
          <li><strong>Gender</strong> — used for matching filters.</li>
        </ul>

        <h3>2.3 Contact details (kept private until you allow unlocking)</h3>
        <ul>
          <li><strong>Phone number and WhatsApp number</strong>;</li>
          <li><strong>Social handles</strong> (for example Instagram, X, TikTok).</li>
        </ul>
        <p>
          These are never displayed on public or discoverable parts of the Platform. They are
          stored privately and only become available to another specific user after you and that
          user have matched <em>and</em> they complete a paid unlock, and only for the methods
          you have enabled — see sections 5 and 6.
        </p>

        <h3>2.4 Questionnaire answers</h3>
        <p>
          Your answers to the compatibility questionnaire (50 questions across five dimensions)
          and any guided-conversation responses are stored to operate matching and the guided
          conversation. They are not published on your profile and are not shown to other users
          as raw answers.
        </p>

        <h3>2.5 Payment data</h3>
        <ul>
          <li><strong>Transaction records</strong> — the purpose, amount, recipient and status of each M-Pesa payment you make (for example Connect or Force Connect unlocks), so we can verify payment and grant the unlock.</li>
          <li><strong>M-Pesa identifiers</strong> — the phone number used for payment and the transaction reference from our payment provider (Daraja/M-Pesa). We do <strong>not</strong> collect or store card details or M-Pesa PINs; those stay with Safaricom's system.</li>
        </ul>

        <h3>2.6 Safety and moderation data</h3>
        <ul>
          <li><strong>Reports</strong> — the reason you submit when reporting another user.</li>
          <li><strong>Blocks</strong> — records of which users you have blocked, so blocking is enforced.</li>
          <li><strong>Match and conversation records</strong> — who is matched or in conversation with whom, and conversation state (active, connected, locked, archived), so the product works and so you can unmatch, block or report.</li>
        </ul>

        <h3>2.7 Technical and diagnostic data</h3>
        <ul>
          <li><strong>Sign-in device/browser data</strong> — kept by our authentication provider for security (for example last sign-in time).</li>
          <li><strong>Error diagnostics</strong> — when something crashes, an error-tracking service (Sentry) receives a technical description of the error. Error reports do not include your messages or questionnaire answers.</li>
          <li><strong>Product analytics</strong> — a privacy-focused analytics service (PostHog) receives coarse events (for example "signup completed", "questionnaire finished") tied to a random identifier. We do not send your email, name, messages, answers or contact details to analytics.</li>
          <li><strong>Push-notification tokens</strong> — if you allow notifications, a device token is stored so we can notify you (for example about a new match). You can turn notifications off in your browser at any time.</li>
        </ul>

        <h3>2.8 What we do NOT collect</h3>
        <ul>
          <li>We do not run background checks or verify identity documents;</li>
          <li>We do not track your location (GPS);</li>
          <li>We do not access your phone contacts, photos or files beyond the photos you upload;</li>
          <li>We do not sell your personal data to anyone, ever.</li>
        </ul>

        <h2>3. Why we process your data (purposes and legal basis)</h2>
        <p>Under the DPA we must have a lawful basis for each use of personal data:</p>
        <ul>
          <li>
            <strong>To provide the service you asked for</strong> (performance of a contract) —
            creating your account, matching, guided conversation, showing profiles to matches,
            processing payments and unlocking contact details.
          </li>
          <li>
            <strong>To keep people safe and enforce our rules</strong> (legitimate interests and
            our legal obligations) — investigating reports, enforcing blocks, moderating content,
            preventing fraud and abuse, keeping payments verifiable.
          </li>
          <li>
            <strong>To communicate with you</strong> (performance of a contract) — service
            emails and sign-in codes; match notifications (in-app or push, where you have
            allowed them).
          </li>
          <li>
            <strong>To understand and improve the product</strong> (legitimate interests) —
            coarse analytics and error diagnostics, described in section 2.7.
          </li>
          <li>
            <strong>Where required by law</strong> — responding to valid legal requests,
            retaining transaction records as required by Kenyan law.
          </li>
        </ul>
        <p>
          Some of the data on a dating platform can be sensitive (the DPA calls this "sensitive
          personal data" — for example information revealing health, or — in some
          circumstances — sexual orientation). We process sensitive personal data only where
          there is an applicable lawful basis and appropriate safeguards, principally because{' '}
          <strong>you chose to provide it</strong> for matching purposes and it is necessary to
          provide the service. You should only share what you are comfortable matching users
          eventually processing for this purpose.
        </p>

        <h2>4. Who can see what (visibility by default)</h2>
        <ul>
          <li><strong>The public / other students in general:</strong> nothing. There is no public profile directory. Profiles are visible only to users the matching engine pairs with you (or who Force-Connect with you).</li>
          <li><strong>Matched users:</strong> your name, age, facial photo (on cards), full-body photo and bio (on your opened profile), plus your interests.</li>
          <li><strong>Matched users who have not paid to unlock:</strong> none of your contact details — not phone, not WhatsApp, not social handles.</li>
          <li><strong>Matched users after a paid unlock:</strong> only the contact methods you have enabled in your sharing settings, delivered per section 5.</li>
          <li><strong>MingleMate staff / administrators:</strong> only what administration and safety require (for example reviewing reports), under access controls and audit logging. Admin access is role-gated server-side and sensitive access is logged.</li>
        </ul>

        <h2>5. Contact details, unlocking and snapshots</h2>
        <p>This is the part people ask about most, so here is exactly how it works:</p>
        <ol>
          <li>Your contact details sit in a private part of our database. They are not included in the profile data other users' apps receive.</li>
          <li>You choose, in your sharing settings, which methods may ever be unlocked: phone, WhatsApp, social handles — each on or off.</li>
          <li>When another user pays to Connect with you, our server verifies the payment, checks that a genuine match exists, and only then releases your <em>enabled</em> methods to that one user.</li>
          <li>At the moment of unlock, the platform saves a copy (a "snapshot") of exactly which methods were enabled and what was revealed, tied to that connection. This protects both sides: if you later turn a method off, the person who already paid keeps what they validly received — and nobody gets anything new.</li>
          <li>Changing your sharing settings at any time affects <strong>future</strong> unlocks only.</li>
        </ol>

        <h2>6. Sharing with third parties</h2>
        <p>We share personal data only with the processors and infrastructure providers needed to run MingleMate:</p>
        <ul>
          <li><strong>Supabase</strong> — hosting, database, authentication and storage (our backend infrastructure).</li>
          <li><strong>Vercel</strong> — serving the web application.</li>
          <li><strong>Safaricom M-Pesa (via Daraja)</strong> — processing your M-Pesa payments. Payment details flow through their system under their own privacy terms.</li>
          <li><strong>Sentry</strong> — error diagnostics (technical data only).</li>
          <li><strong>PostHog</strong> — coarse product analytics (random identifier, no personal content).</li>
          <li><strong>OneSignal</strong> — push-notification delivery, where you have allowed notifications.</li>
        </ul>
        <p>
          These providers process data on our instructions under their own security and
          confidentiality commitments. We may also disclose personal data where required by law
          or valid legal process, or to protect the rights, property or safety of users and the
          public.
        </p>
        <p>We do not sell personal data, and we do not share it for third-party advertising.</p>

        <h2>7. International data transfers</h2>
        <p>
          Some of the providers listed in section 6 store or process data outside Kenya. Where
          personal data is transferred out of Kenya, we rely on the safeguards recognised by the
          DPA (such as the provider's binding commitments and appropriate security measures) and
          transfer only what is necessary for the purposes in this Policy.
        </p>

        <h2>8. How long we keep your data</h2>
        <ul>
          <li><strong>Account and profile data</strong> — until you delete your account.</li>
          <li><strong>Contact-details snapshots</strong> (section 5) — kept while the connection exists, and for a reasonable period afterwards to resolve disputes.</li>
          <li><strong>Payment/transaction records</strong> — kept for the period required by Kenyan tax and commercial law.</li>
          <li><strong>Reports and moderation records</strong> — kept for a reasonable period so that decisions can be reviewed and repeat abuse detected.</li>
          <li><strong>Analytics and error data</strong> — kept per the providers' standard retention windows.</li>
        </ul>
        <p>
          When data is no longer needed it is deleted or anonymised. Some data may be retained
          longer where required by law or to establish or defend legal claims.
        </p>

        <h2>9. Security</h2>
        <p>We protect personal data with measures including:</p>
        <ul>
          <li>Row-level security in the database, so users can only query their own data and the limited public profile columns;</li>
          <li>Contact details and payment records are excluded from publicly readable profile data entirely — enforced in the database, not just hidden in the interface;</li>
          <li>Server-verified payments; the unlock of contact details is decided by our server, never the app;</li>
          <li>Secrets held only server-side; the app uses only public keys;</li>
          <li>Encrypted transport (HTTPS) throughout;</li>
          <li>Audit logging of sensitive administrative access.</li>
        </ul>
        <p>No system is perfectly secure. If a personal-data breach is likely to cause you harm, we will notify the ODPC and affected users as the DPA requires.</p>

        <h2>10. Your rights under Kenyan law</h2>
        <p>Subject to the DPA, you have the right to:</p>
        <ul>
          <li><strong>Be informed</strong> — this Policy is that notice;</li>
          <li><strong>Access</strong> — ask for a copy of the personal data we hold about you;</li>
          <li><strong>Correction</strong> — fix inaccurate data (most profile data can be edited directly in the app);</li>
          <li><strong>Deletion</strong> — ask us to delete your personal data (you can also delete your account yourself in Settings);</li>
          <li><strong>Objection</strong> — object to certain processing, including processing for our legitimate interests;</li>
          <li><strong>Portability</strong> — receive your data in a structured, commonly used format.</li>
        </ul>
        <p>
          To exercise any right, email [INSERT PRIVACY EMAIL]. We will respond within a
          reasonable time and in any event as required by the DPA. We may ask you to verify your
          identity before acting on a request.
        </p>
        <p>
          If you are unhappy with our response, you may complain to the{' '}
          <strong>Office of the Data Protection Commissioner</strong> (Kenya).
        </p>

        <h2>11. Deleting your account</h2>
        <p>
          You can delete your account yourself in <strong>Profile → Settings</strong>. Deleting
          your account removes your profile, photos and questionnaire answers from the app, and
          ends conversations you are part of. Some records are retained as described in section
          8 — notably payment records (legal requirement) and contact-unlock snapshots ( dispute
          resolution), which are kept only as long as needed and are not shown to other users
          after deletion.
        </p>

        <h2>12. Children</h2>
        <p>
          MingleMate is for adults 18 and over (see the{' '}
          <Link to="/terms">Terms of Service</Link>). We do not knowingly collect personal data
          from anyone under 18. If we learn that an account belongs to a person under 18, we
          will delete the account and its personal data. If you believe a minor is using
          MingleMate, please contact us at [INSERT PRIVACY EMAIL].
        </p>

        <h2>13. Changes to this Policy</h2>
        <p>
          We may update this Policy as the service or the law changes. Material changes will be
          signposted in the app or on the Platform before they take effect. The "Last
          Updated" date above shows the current version.
        </p>

        <h2>14. Contact</h2>
        <div className="legal-contact">
          <p><strong>MingleMate</strong> — operated by [INSERT LEGAL ENTITY NAME]</p>
          <p><strong>Registered Address:</strong> [INSERT ADDRESS]</p>
          <p><strong>Privacy Contact / DPO:</strong> [INSERT PRIVACY EMAIL]</p>
        </div>

        <div className="info-cta-row">
          <Link to="/terms" className="btn-ghost" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            Read the Terms of Service
          </Link>
          <Link to="/faq" className="btn-ghost" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            Read the FAQ
          </Link>
        </div>
      </main>

      <footer className="info-footer">
        <span>© {new Date().getFullYear()} MingleMate</span>
        <span>Matched by compatibility, not coincidence.</span>
      </footer>
    </div>
  )
}
