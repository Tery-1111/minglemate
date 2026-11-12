import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Section2.css'

// Authoritative question bank — the single source of truth for both
// the standalone questionnaire and the partner answer presentation.
import { section2Questions } from '../data/section2Questions'

// Returns the 0-based index of the first question (1-based numbers 1..total)
// that is not in the answered set, or -1 when every question is answered.
function firstUnansweredIndex(answeredSet, total) {
  for (let questionNumber = 1; questionNumber <= total; questionNumber++) {
    if (!answeredSet.has(questionNumber)) return questionNumber - 1
  }
  return -1
}

export default function Section2() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(0) // 0-based index, 0..19
  // Answers map: question_number (1-based) -> selected option text.
  // An entry exists only for answers that are saved in the database,
  // plus the one answer currently being saved.
  const [answers, setAnswers] = useState({})
  // Question numbers (1-based) that hold a saved answer (for completion)
  const [answered, setAnswered] = useState(new Set())

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    checkAccess()
  }, [])

  async function checkAccess() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      navigate('/')
      return
    }
    setUserId(session.user.id)

    // Load existing answers from the database
    const { data: existing } = await supabase
      .from('section2_responses')
      .select('question_number, answer_text')
      .eq('user_id', session.user.id)

    if (existing && existing.length > 0) {
      // Map stored answer_text back to the selected option
      const loaded = {}
      const answeredSet = new Set()
      existing.forEach(r => {
        const questionNumber = r.question_number // 1-based
        const questionIndex = questionNumber - 1 // 0-based
        const questionData = section2Questions[questionIndex]
        if (questionData) {
          const matchedOption = questionData.options.find(opt => opt === r.answer_text)
          if (matchedOption) {
            loaded[questionNumber] = r.answer_text
            answeredSet.add(questionNumber)
          } else {
            // Legacy unmatched answer — treat as invalid/unanswered
            // Do not display as an approved option; leave unanswered
          }
        }
      })
      setAnswers(loaded)
      setAnswered(answeredSet)
      // Resume at the last answered question, or the first question if none
      const lastAnswered = Array.from(answeredSet).reduce(
        (max, qn) => Math.max(max, qn),
        0
      )
      setCurrent(Math.max(0, Math.min(lastAnswered - 1, section2Questions.length - 1)))
    }

    setLoading(false)
  }

  // Select an option — saves immediately. The selection only counts as
  // answered if the database save succeeds; on failure it is rolled back.
  async function selectOption(optionText) {
    if (saving) return
    if (!userId) {
      setSaveState('error')
      return
    }

    const questionNumber = current + 1 // 1-based
    const previousAnswer = answers[questionNumber]
    const nowAnswered = new Set(answered)
    nowAnswered.add(questionNumber)

    setAnswers(prev => ({ ...prev, [questionNumber]: optionText }))
    setAnswered(nowAnswered)

    setSaving(true)
    setSaveState('saving')

    const { error } = await supabase.from('section2_responses').upsert(
      {
        user_id: userId,
        question_number: questionNumber,
        answer_text: optionText,
      },
      { onConflict: 'user_id,question_number' }
    )

    if (error) {
      // ROLLBACK: restore the previously saved answer, or remove the
      // unsaved selection when there was none, so the screen only ever
      // shows answers that are really stored.
      setAnswers(prev => {
        const next = { ...prev }
        if (previousAnswer) {
          next[questionNumber] = previousAnswer
        } else {
          delete next[questionNumber]
        }
        return next
      })
      setAnswered(prev => {
        const next = new Set(prev)
        if (!previousAnswer) next.delete(questionNumber)
        return next
      })
      setSaveState('error')
      setSaving(false)
      return
    }

    setSaveState('saved')
    setSaving(false)

    // Brief confirmation flash
    await new Promise(r => setTimeout(r, 300))

    if (current < section2Questions.length - 1) {
      setCurrent(current + 1)
      setSaveState('idle')
    } else if (nowAnswered.size === section2Questions.length) {
      // All 20 saved → navigate to Discover
      navigate('/discover')
    } else {
      // Last question saved but earlier questions are still unanswered:
      // go to the first unanswered one instead of finishing.
      setCurrent(firstUnansweredIndex(nowAnswered, section2Questions.length))
      setSaveState('idle')
    }
  }

  // Previous question
  function goPrevious() {
    if (current > 0) {
      setSaveState('idle')
      setCurrent(current - 1)
    }
  }

  // Next question — the current selection is preserved in answers state
  function goNext() {
    if (current < section2Questions.length - 1) {
      setSaveState('idle')
      setCurrent(current + 1)
    }
  }

  // Calculate completion based on number of saved answers
  const totalQuestions = section2Questions.length
  const savedCount = answered.size
  const progress = (savedCount / totalQuestions) * 100

  // All 20 saved?
  const isComplete = savedCount === totalQuestions

  if (loading) {
    return (
      <div className="s2-loading">
        <p>Loading...</p>
      </div>
    )
  }

  const questionData = section2Questions[current]
  const currentQuestionNumber = current + 1

  return (
    <div className="s2-container">
      <div className="s2-header">
        <button
          className="s2-back"
          onClick={() => current > 0 ? goPrevious() : navigate('/home')}
          aria-label="Go back"
        >
          ←
        </button>
        <span className="s2-progress-text">
          Question {currentQuestionNumber} of {section2Questions.length}
        </span>
      </div>

      <div className="s2-progress-bar">
        <div
          className="s2-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="s2-content">
        <h2 className="s2-question">
          {questionData ? questionData.text : ''}
        </h2>

        {/* Display saved answer for current question */}
        {answers[currentQuestionNumber] && (
          <p
            className="s2-selected-answer"
            style={{ color: 'var(--accent)', marginBottom: '16px' }}
          >
            Selected: {answers[currentQuestionNumber]}
          </p>
        )}

        {/* Answer choices: radio buttons */}
        {questionData ? (
          questionData.options.map((option, optIndex) => (
            <label
              key={optIndex}
              className="s2-option-label"
              style={{
                display: 'block',
                marginBottom: '8px',
                padding: '8px',
                borderRadius: '8px',
                background:
                  answers[currentQuestionNumber] === option
                    ? 'var(--accent)'
                    : 'var(--surface-raised)',
                color:
                  answers[currentQuestionNumber] === option
                    ? 'white'
                    : 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="s2-option"
                value={option}
                checked={answers[currentQuestionNumber] === option}
                disabled={saving}
                style={{ display: 'none' }}
                onChange={() => selectOption(option)}
              />
              {option}
            </label>
          ))
        ) : null}

        <p className="s2-char-count">
          {answers[currentQuestionNumber]
            ? answers[currentQuestionNumber]
            : ''}
        </p>

        {saveState === 'saved' && (
          <p
            className="s2-save-note s2-save-note-ok"
            role="status"
          >
            Saved ✓
          </p>
        )}
        {saveState === 'error' && (
          <p
            className="s2-save-note s2-save-note-err"
            role="alert"
          >
            We couldn't save your answer. Check your connection and select
            your answer again.
          </p>
        )}

        {/* Navigation buttons */}
        <div style={{ marginTop: '24px' }}>
          {isComplete ? (
            // All 20 saved — show completion state and Continue to Discover
            <button
              className="s2-btn"
              onClick={() => navigate('/discover')}
              disabled={saving}
            >
              Continue to Discover →
            </button>
          ) : current < section2Questions.length - 1 ? (
            <button
              className="s2-btn"
              onClick={goNext}
              disabled={!answers[currentQuestionNumber] || saving}
              aria-busy={saving}
            >
              Next Question →
            </button>
          ) : answers[currentQuestionNumber] ? (
            // Last question is answered but an earlier one is still empty:
            // never finish here, send the user to the first empty one.
            <button
              className="s2-btn"
              onClick={() => {
                setSaveState('idle')
                setCurrent(firstUnansweredIndex(answered, totalQuestions))
              }}
              disabled={saving}
            >
              Go to unanswered question →
            </button>
          ) : (
            // Last question, not yet answered: it must be answered first.
            <button className="s2-btn" disabled>
              Select an answer to finish
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
