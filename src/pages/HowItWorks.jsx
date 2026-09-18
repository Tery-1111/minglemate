import { useNavigate } from 'react-router-dom'
import './InfoPage.css'

// Public SEO page: explains the matching system honestly, using the
// product's real mechanics (50 questions, 5 dimensions, weekly tiered
// matches, paywalled contact reveal). No invented claims.
const DIMENSIONS = [
  ['Communication', 'How you text, call, and check in — and what makes you feel heard.'],
  ['Conflict', 'How you argue, repair after a disagreement, and what you need to move on.'],
  ['Emotional', 'How you show affection, handle stress, and what you need when life gets heavy.'],
  ['Expectations', 'What you want from the relationship now and how fast you want it to grow.'],
  ['Values', 'The beliefs and boundaries that matter most — faith, family, money, ambition.'],
]

export default function HowItWorks() {
  const navigate = useNavigate()

  return (
    <div className="info-page">
      <nav className="info-nav">
        <span className="info-logo">MingleMate</span>
        <button className="info-cta" onClick={() => navigate('/signup')}>Sign Up</button>
      </nav>

      <main className="info-main">
        <h1>How MingleMate matching works</h1>
        <p className="info-lede">
          MingleMate is a compatibility-based dating app for Kenyan university
          students. Instead of endless swiping, you answer 50 guided questions
          and we deliver two curated matches every week — one chosen for
          similarity, one for genuine complementarity.
        </p>

        <h2>The 50-question compatibility survey</h2>
        <p>
          Your profile starts with 50 multiple-choice questions, 10 in each of
          five dimensions. They're concrete, not filler — the same situations
          you actually face on campus.
        </p>
        <ul className="dimension-list">
          {DIMENSIONS.map(([name, desc]) => (
            <li key={name}>
              <h3>{name}</h3>
              <p>{desc}</p>
            </li>
          ))}
        </ul>

        <h2>How your weekly matches are chosen</h2>
        <p>
          Every week, our matching engine scores you against other students on
          your campus and delivers two matches:
        </p>
        <ul>
          <li>
            <strong>Tier 1 — Similarity match:</strong> the person whose answers
            align most closely with yours across all five dimensions, weighted
            toward values, intentions, and how you handle conflict.
          </li>
          <li>
            <strong>Tier 2 — Complementary match:</strong> someone who balances
            you — where differences are likely to strengthen the relationship
            rather than cause friction.
          </li>
        </ul>
        <p>
          Dealbreaker logic runs first: if two people's core intentions don't
          line up — for example one wants something serious and the other is
          just curious — they're never matched, no matter how similar they
          look on paper.
        </p>

        <h2>Chat that starts with real questions</h2>
        <p>
          Matches open with a guided conversation — twenty deep questions you
          and your match answer in turn. It's designed to get past "hey" and
          into actual conversation. After you've worked through 14 questions
          together, contact details unlock so you can take things offline.
        </p>

        <h2>Built for campus life in Kenya</h2>
        <p>
          MingleMate is campus-scoped: you join with your university email,
          you're only matched with students from your campus, and matches drop
          weekly — on your schedule, not a dopamine feed's.
        </p>

        <div className="info-cta-row">
          <button className="btn-primary" onClick={() => navigate('/signup')}>
            Start your 50 questions
          </button>
          <button className="btn-ghost" onClick={() => navigate('/faq')}>
            Read the FAQ
          </button>
        </div>
      </main>

      <footer className="info-footer">
        <span>© {new Date().getFullYear()} MingleMate</span>
        <span>Matched by compatibility, not coincidence.</span>
      </footer>
    </div>
  )
}
