import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Section2.css'

const section2Questions = [
  "If we were matched by the algorithm, what would you hope to learn about me before meeting in person?",
  "What do you feel are your strongest traits that a partner should know about, and what are your weaknesses they should understand?",
  "If you could wake up tomorrow with one new ability or quality, what would it be and why?",
  "What's something you've always wanted to try on campus but haven't, and what's stopping you?",
  "What does a perfect day on campus look like for you? Include academics, social life, and personal time.",
  "How do you define friendship at this stage of your life, and what role does it play in your relationships?",
  "Take four minutes and tell your life story — what do you think is most important for me to know about you?",
  "If you could have dinner with anyone — a professor, celebrity, historical figure, or family member — who would it be and why?",
  "What are the three things you think we have in common right now?",
  "What's something you are most grateful for in your life at this moment?",
  "If you knew you had only one year to live, what would you change about how you're living on campus?",
  "What roles do love and affection play in your life right now — romantic, platonic, or familial?",
  "Share one embarrassing moment from your student life that still makes you cringe or laugh.",
  "What, if anything, is too serious to joke about? Where's your boundary?",
  "When did you last cry — alone or in front of someone else — and what did you learn about yourself?",
  "Tell me one thing you genuinely like about me from what you know so far.",
  "What are your personal non-negotiables in a relationship, if any, and why?",
  "Of all the people in your life, whose absence would affect you most deeply, and why?",
  "Share a personal challenge you're facing right now — academic, emotional, or social — and how you cope with it.",
  "If we were to become closer, what's one thing you think I should understand about you to build a stronger connection?"
]

export default function Section2() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState({})
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Save-state machine: idle → saving → saved | error. 'error' keeps
  // the user's text in the box (nothing is silently discarded) and
  // offers Retry. 'saved' flashes briefly before advancing.
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    checkAccess()
  }, [])

  async function checkAccess() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setUserId(session.user.id)

    // Spec (§2): the questionnaires are never paywalled — a user can
    // always answer or edit their own Section 2 answers, regardless of
    // payment or trial status. Payment lives exclusively in
    // Connect/contact-reveal, so there is no unlock/trial gate here;
    // this only restores the user's existing answers for editing.

    // Load existing answers
    const { data: existing } = await supabase
      .from('section2_responses')
      .select('question_number, answer_text')
      .eq('user_id', session.user.id)

    if (existing && existing.length > 0) {
      const loaded = {}
      existing.forEach(r => { loaded[r.question_number] = r.answer_text })
      setAnswers(loaded)
      const lastAnswered = Math.max(...existing.map(r => r.question_number))
      setCurrent(Math.min(lastAnswered, section2Questions.length - 1))
      setCurrentAnswer(loaded[Math.min(lastAnswered, section2Questions.length - 1) + 1] || '')
    }

    setLoading(false)
  }

  async function handleSave() {
    if (!currentAnswer.trim() || saving) return // no duplicate submits
    setSaving(true)
    setSaveState('saving')

    // onConflict mirrors the table's (user_id, question_number) unique
    // constraint: retakes re-answer existing questions, and without it
    // the upsert threw a duplicate-key error nobody surfaced.
    const text = currentAnswer.trim()
    const { error: saveError } = await supabase.from('section2_responses').upsert({
      user_id: userId,
      question_number: current + 1,
      answer_text: text
    }, { onConflict: 'user_id,question_number' })

    if (saveError) {
      // ROLLBACK: keep the user's text exactly as typed; say what
      // happened; offer Retry. Never silently discard.
      setSaveState('error')
      setSaving(false)
      return
    }

    const newAnswers = { ...answers, [current + 1]: text }
    setAnswers(newAnswers)
    setSaveState('saved')

    // A beat of confirmation — the save visibly lands before the
    // next question arrives.
    await new Promise(r => setTimeout(r, 500))

    if (current < section2Questions.length - 1) {
      setCurrent(current + 1)
      setCurrentAnswer(newAnswers[current + 2] || '')
      setSaveState('idle')
    } else {
      const { error: finishError } = await supabase
        .from('users')
        .update({ section2_unlocked: true })
        .eq('id', userId)
      if (finishError) {
        setSaveState('error')
        setSaving(false)
        return
      }
      // Onboarding complete → open Discover.
      navigate('/discover')
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <div className="s2-loading">
        <p>Loading...</p>
      </div>
    )
  }

  const progress = ((current + 1) / section2Questions.length) * 100

  return (
    <div className="s2-container">
      <div className="s2-header">
        <button className="s2-back" onClick={() => current > 0 ? (setCurrent(current - 1), setCurrentAnswer(answers[current] || '')) : navigate('/home')}>
          ←
        </button>
        <span className="s2-progress-text">Question {current + 1} of {section2Questions.length}</span>
      </div>

      <div className="s2-progress-bar">
        <div className="s2-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="s2-content">
        <h2 key={current} className="s2-question s1-question-enter">{section2Questions[current]}</h2>

        <textarea
          className="s2-textarea"
          placeholder="Write your answer here... be honest and open."
          value={currentAnswer}
          onChange={e => { setCurrentAnswer(e.target.value); if (saveState === 'error') setSaveState('idle') }}
          rows={6}
          aria-invalid={saveState === 'error'}
        />

        <p className="s2-char-count">{currentAnswer.length} characters</p>

        {saveState === 'saved' && (
          <p className="s2-save-note s2-save-note-ok" role="status">Saved ✓</p>
        )}
        {saveState === 'error' && (
          <p className="s2-save-note s2-save-note-err" role="alert">
            We couldn't save your answer — it's still here. Check your connection and try again.
          </p>
        )}

        <button
          className="s2-btn"
          onClick={handleSave}
          disabled={!currentAnswer.trim() || saving}
          aria-busy={saving}
        >
          {saving
            ? 'Saving…'
            : saveState === 'error'
              ? 'Retry saving →'
              : current < section2Questions.length - 1
                ? 'Next Question →'
                : 'Complete Section 2 ✓'}
        </button>
      </div>
    </div>
  )
}