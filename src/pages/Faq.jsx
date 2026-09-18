import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { SITE_URL } from '../seo'
import './InfoPage.css'

// Public SEO FAQ. Every Q&A here is visible content — the FAQPage
// JSON-LD emitted for this route mirrors exactly these items.
const FAQS = [
  {
    q: 'Who can join MingleMate?',
    a: 'MingleMate is for university students in Kenya. You sign up with your campus email address, and you are only matched with students from your own campus.',
  },
  {
    q: 'How are my matches chosen?',
    a: 'You answer 50 questions across five compatibility dimensions — communication, conflict, emotional style, expectations, and values. Each week the matching engine delivers two students from your campus: your most similar match and a complementary one. Core dealbreakers are filtered out first.',
  },
  {
    q: 'Is MingleMate free?',
    a: 'Joining, completing the compatibility survey, and receiving weekly matches are free. There is a one-time payment to unlock contact details faster in chat, but matches unlock them after you answer 14 guided questions together either way.',
  },
  {
    q: 'How does MingleMate protect my privacy?',
    a: 'Your contact details — phone, WhatsApp, email — are never shown to other users until you and your match unlock them together. They are also blurred in chat messages until then. Your questionnaire answers are used for matching and are not published on your profile.',
  },
  {
    q: 'Can I choose who sees me?',
    a: 'You are only visible to students on your own campus, and only people the matching engine pairs you with can start a chat with you. There is no public directory of profiles.',
  },
  {
    q: 'What if I get a match I am not interested in?',
    a: 'Matches refresh weekly, and the engine avoids repeating recent pairings. You are never obligated to respond — simply wait for the next drop.',
  },
  {
    q: 'Which universities are supported?',
    a: 'New campuses are added over time. During signup you sign in with your campus email domain, and if your university is active you are in.',
  },
]

export default function Faq() {
  const navigate = useNavigate()

  // FAQPage JSON-LD mirroring the visible items above
  useEffect(() => {
    const id = 'jsonld-faq'
    document.getElementById(id)?.remove()
    const data = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
      url: `${SITE_URL}/faq`,
    }
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = id
    script.textContent = JSON.stringify(data)
    document.head.appendChild(script)
    return () => document.getElementById(id)?.remove()
  }, [])

  return (
    <div className="info-page">
      <nav className="info-nav">
        <span className="info-logo">MingleMate</span>
        <button className="info-cta" onClick={() => navigate('/signup')}>Sign Up</button>
      </nav>

      <main className="info-main">
        <h1>MingleMate FAQ</h1>
        <p className="info-lede">
          Straight answers about how matching works, what it costs, and how
          your data stays private.
        </p>

        {FAQS.map(({ q, a }) => (
          <section key={q} className="faq-item">
            <h2>{q}</h2>
            <p>{a}</p>
          </section>
        ))}

        <div className="info-cta-row">
          <button className="btn-primary" onClick={() => navigate('/signup')}>
            Create your account
          </button>
          <button className="btn-ghost" onClick={() => navigate('/matches-info')}>
            How matching works
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
