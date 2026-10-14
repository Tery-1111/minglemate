import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './MatchCelebration.css'

// MATCH CELEBRATION — emotional LEVEL 3 (peak): calm → anticipation →
// reveal → peak → continue (spec §13). The sequence is:
//   1. "Match detected" — quiet heart mark, no names yet (anticipation)
//   2. The two identity cards fade/rise in, one after the other (reveal)
//   3. "It's a Match!" title stamps in with the tier labels (peak)
//   4. Continue → Matches
// Everything is also readable without animation (prefers-reduced-motion
// collapses the sequence; all text states are real DOM, not motion-only).
export default function MatchCelebration() {
  const navigate = useNavigate()
  const [tier1, setTier1] = useState(null)
  const [tier2, setTier2] = useState(null)
  const [loading, setLoading] = useState(true)
  // Celebration beats: 'detecting' → 'revealing' → 'matched'
  const [beat, setBeat] = useState('detecting')

  useEffect(() => {
    load()
  }, [])

  // ANTICIPATION: a short, fixed build — never a loader pretending to
  // work, just a deliberate pause that makes the reveal land. Skipped
  // under reduced motion via the CSS (animation durations collapse).
  useEffect(() => {
    if (loading) return
    const t1 = setTimeout(() => setBeat('revealing'), 900)
    const t2 = setTimeout(() => setBeat('matched'), 2200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [loading])

  function getWeekId() {
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 1)
    const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7)
    return `${now.getFullYear()}-W${week}`
  }

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }

    const { data: row } = await supabase
      .from('match_history')
      .select('tier1_match_id, tier2_match_id')
      .eq('user_id', session.user.id)
      .eq('week_id', getWeekId())
      .maybeSingle()

    async function hydrate(id) {
      if (!id) return null
      const { data: u } = await supabase
        .from('profiles_public')
        .select('id, full_name, age')
        .eq('id', id)
        .single()
      if (!u) return null
      const { data: photos } = await supabase
        .from('photos')
        .select('photo_url, photo_type')
        .eq('user_id', id)
        .order('display_order')
      const face = (photos || []).find(p => p.photo_type === 'facial')
      return { ...u, face: face?.photo_url || null }
    }

    setTier1(await hydrate(row?.tier1_match_id))
    setTier2(await hydrate(row?.tier2_match_id))
    setLoading(false)
  }

  if (loading) {
    // Beat 0: match detected — the quiet inhale before the reveal.
    return (
      <div className="celebration-page">
        <div className="celebration-card celebration-anticipate" role="status">
          <svg className="celebration-heart" viewBox="0 0 24 24" width="52" height="52" fill="var(--champagne)" aria-hidden="true">
            <path d="M12 21c-5.6-3.8-9-7-9-10.8C3 7.3 5.2 5 8 5c1.6 0 3.1.8 4 2 .9-1.2 2.4-2 4-2 2.8 0 5 2.3 5 5.2 0 3.8-3.4 7-9 10.8z" />
          </svg>
          <h1 className="celebration-title">Match detected</h1>
          <p className="celebration-sub">The algorithm found your weekly connections…</p>
        </div>
      </div>
    )
  }

  const people = [
    { label: 'Similarity Match', person: tier1, color: 'var(--accent)' },
    { label: 'Complementary Match', person: tier2, color: 'var(--champagne)' },
  ].filter(c => c.person)

  return (
    <div className="celebration-page">
      <div className="celebration-card">
        <svg className={`celebration-heart${beat === 'matched' ? ' celebration-heart-peak' : ''}`} viewBox="0 0 24 24" width="52" height="52" fill="var(--champagne)" aria-hidden="true">
          <path d="M12 21c-5.6-3.8-9-7-9-10.8C3 7.3 5.2 5 8 5c1.6 0 3.1.8 4 2 .9-1.2 2.4-2 4-2 2.8 0 5 2.3 5 5.2 0 3.8-3.4 7-9 10.8z" />
        </svg>
        <h1 key={beat} className={`celebration-title ${beat === 'matched' ? 'stamp-in' : 's1-question-enter'}`}>
          {beat === 'matched' ? "It's a Match!" : 'Match detected'}
        </h1>
        <p className="celebration-sub" role="status">
          {beat === 'matched'
            ? 'Your weekly connections are ready.'
            : 'The algorithm found your weekly connections…'}
        </p>

        {/* Beat timing drives the reveal: identities rise in one after
            the other; before 'revealing' they exist in the DOM with
            aria-hidden so screen readers meet them at the same moment
            the title peaks. */}
        <div className="celebration-cards" aria-busy={beat !== 'matched'}>
          {people.map((c, i) => (
            <div
              key={c.person.id}
              className={`celebration-person rise-in${beat === 'matched' ? ' celebration-peak' : ' celebration-reveal'}`}
              style={{ animationDelay: beat === 'matched' ? `${i * 120}ms` : `${600 + i * 500}ms` }}
              aria-hidden={beat !== 'matched' ? true : undefined}
            >
              {c.person.face ? (
                <img src={c.person.face} alt={c.person.full_name} className="celebration-photo" />
              ) : (
                <div className="celebration-photo celebration-photo-empty" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4.5 20.5c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
                  </svg>
                </div>
              )}
              <div className="celebration-person-name">{c.person.full_name}, {c.person.age}</div>
              <div className="celebration-tier" style={{ color: c.color }}>{c.label}</div>
            </div>
          ))}
          {!tier1 && !tier2 && beat === 'matched' && (
            <p className="celebration-none rise-in">No matches this week yet.</p>
          )}
        </div>

        {beat === 'matched' && (
          <button className="celebration-btn stamp-in" onClick={() => navigate('/matches')}>
            See My Matches →
          </button>
        )}
      </div>
    </div>
  )
}
