import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { section2Questions } from '../data/section2Questions'
import './Section2Comparison.css'

// Read-only, side-by-side view of two people's Section 2 answers.
// Who may read whose answers is decided by the database policy
// section2_responses_select_own_or_partner, so this component only asks for
// the rows and shows whatever the database returns. It never writes anything
// and nothing here feeds matching, tiers or compatibility scores.

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'same', label: 'Same' },
  { key: 'diff', label: 'Different' },
]

// An answer counts only if it is exactly one of the question's four options.
function validAnswer(question, text) {
  return typeof text === 'string' && question.options.includes(text) ? text : null
}

export default function Section2Comparison({ partnerId, myId, partnerName }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [mine, setMine] = useState({})
  const [theirs, setTheirs] = useState({})
  const [filter, setFilter] = useState('all')
  const chatRef = useRef(null)
  const [pageWidth, setPageWidth] = useState(null)

  const active = Boolean(partnerId && myId && partnerId !== myId)

  useEffect(() => {
    if (!active) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function loadAnswers() {
      setLoading(true)
      setError(false)
      try {
        const { data, error: loadError } = await supabase
          .from('section2_responses')
          .select('user_id, question_number, answer_text')
          .in('user_id', [myId, partnerId])

        if (cancelled) return

        if (loadError) {
          setError(true)
          setMine({})
          setTheirs({})
        } else {
          const myAnswers = {}
          const partnerAnswers = {}
          ;(data || []).forEach(row => {
            if (row.user_id === myId) {
              myAnswers[row.question_number] = row.answer_text
            } else if (row.user_id === partnerId) {
              partnerAnswers[row.question_number] = row.answer_text
            }
          })
          setMine(myAnswers)
          setTheirs(partnerAnswers)
        }
      } catch {
        if (cancelled) return
        setError(true)
        setMine({})
        setTheirs({})
      }
      setLoading(false)
    }

    loadAnswers()

    return () => {
      cancelled = true
    }
  }, [active, myId, partnerId])

  // Page width without the scrollbar, so the full-width layout never causes
  // a sideways scroll.
  useEffect(() => {
    const measure = () => setPageWidth(document.documentElement.clientWidth)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Gentle reveal as each question scrolls into view. Questions that are
  // already visible keep their class; reduced-motion is handled in the CSS.
  useEffect(() => {
    const root = chatRef.current
    if (!root) return undefined
    const nodes = Array.from(root.querySelectorAll('.s2c-question'))
    if (nodes.length === 0) return undefined

    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach(node => node.classList.add('s2c-visible'))
      return undefined
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('s2c-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.08 }
    )
    nodes.forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [filter, loading, error, mine, theirs])

  if (!active) return null

  const name = partnerName && partnerName.trim() ? partnerName.trim() : 'Them'
  const initial = (name.charAt(0) || '?').toUpperCase()

  const rows = section2Questions.map(question => {
    const myAnswer = validAnswer(question, mine[question.id])
    const partnerAnswer = validAnswer(question, theirs[question.id])
    return {
      question,
      myAnswer,
      partnerAnswer,
      same: myAnswer !== null && partnerAnswer !== null && myAnswer === partnerAnswer,
    }
  })

  const total = rows.length
  const myAnswered = rows.filter(row => row.myAnswer !== null).length
  const partnerAnswered = rows.filter(row => row.partnerAnswer !== null).length
  const bothAnswered = rows.filter(row => row.myAnswer !== null && row.partnerAnswer !== null).length
  const sameCount = rows.filter(row => row.same).length
  const diffCount = bothAnswered - sameCount
  const counts = { all: total, same: sameCount, diff: diffCount }

  let copy = 'Some answers line up. Others give you something new to discover.'
  if (partnerAnswered < total) {
    copy = `${name} has answered ${partnerAnswered} of ${total}. The rest will appear when they finish.`
  } else if (myAnswered < total) {
    copy = `You have answered ${myAnswered} of ${total}. Your other answers will appear once you finish them.`
  } else if (sameCount === 0) {
    copy = 'Different answers can make for interesting conversations.'
  }

  const visibleRows = rows.filter(row => {
    if (filter === 'same') return row.same
    if (filter === 'diff') return row.myAnswer !== null && row.partnerAnswer !== null && !row.same
    return true
  })

  return (
    <section
      className="s2c"
      aria-label="Section 2 answer comparison"
      style={pageWidth ? { '--s2c-vw': `${pageWidth}px` } : undefined}
    >
      <div className="s2c-bg" aria-hidden="true" />
      <div className="s2c-inner">
        <header className="s2c-title-block">
          <h2 className="s2c-title">You &amp; {name}</h2>
          <p className="s2c-subtitle">A little more about each other</p>
        </header>

        {loading ? (
          <p className="s2c-footer" role="status">{'Loading the answers\u2026'}</p>
        ) : error ? (
          <p className="s2c-footer" role="alert">Could not load the answers.</p>
        ) : (
          <>
            <div className="s2c-summary">
              <div className="s2c-kicker">Your little things in common</div>
              <div className="s2c-score"><strong>{sameCount}</strong> of {bothAnswered} the same</div>
              <p className="s2c-copy">{copy}</p>
              <div className="s2c-filters" role="group" aria-label="Filter questions">
                {FILTERS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={filter === item.key}
                    onClick={() => setFilter(item.key)}
                  >
                    {item.label} <small>{counts[item.key]}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="s2c-chat" ref={chatRef}>
              {visibleRows.length === 0 ? (
                <p className="s2c-footer">No questions in this filter yet.</p>
              ) : (
                visibleRows.map(({ question, myAnswer, partnerAnswer, same }) => (
                  <article key={question.id} className="s2c-question">
                    <div className="s2c-qhead">
                      <span className="s2c-qnum">Q{String(question.id).padStart(2, '0')}</span>
                      <span className="s2c-category">{question.category}</span>
                    </div>
                    <h3 className="s2c-qtext">{question.text}</h3>

                    <div className="s2c-row s2c-you">
                      <div className="s2c-avatar" aria-hidden="true">Y</div>
                      <div className="s2c-bubble">
                        <div className="s2c-who">You</div>
                        <div className={myAnswer === null ? 's2c-answer s2c-pending' : 's2c-answer'}>
                          {myAnswer === null ? "You haven't answered yet." : myAnswer}
                        </div>
                        <div className="s2c-emoji-row">
                          <span className="s2c-emoji" aria-hidden="true">{'\u2661'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="s2c-row s2c-partner">
                      <div className="s2c-bubble">
                        <div className="s2c-who">{name}</div>
                        <div className={partnerAnswer === null ? 's2c-answer s2c-pending' : 's2c-answer'}>
                          {partnerAnswer === null ? "Hasn't answered yet." : partnerAnswer}
                        </div>
                        <div className="s2c-emoji-row" style={{ justifyContent: 'flex-end' }}>
                          <span className="s2c-emoji" aria-hidden="true">{'\u2661'}</span>
                        </div>
                      </div>
                      <div className="s2c-avatar" aria-hidden="true">{initial}</div>
                    </div>

                    {same && (
                      <div className="s2c-same">
                        <span>{'\u2726'} You chose the same answer</span>
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>

            <p className="s2c-footer">
              Your answers are yours. This comparison is just for the two of you.
            </p>
          </>
        )}
      </div>
    </section>
  )
}