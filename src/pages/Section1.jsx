import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { section1Questions } from '../data/questions'
import './Section1.css'

export default function Section1() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [session, setSession] = useState(null)

  const question = section1Questions[current]
  const progress = ((current + 1) / section1Questions.length) * 100

  useEffect(() => {
    loadProgress()
  }, [])

  async function loadProgress() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setSession(session)

    const { data: existing } = await supabase
      .from('section1_responses')
      .select('question_number, answer_value')
      .eq('user_id', session.user.id)

    if (existing && existing.length > 0) {
      const saved = {}
      existing.forEach(r => { saved[r.question_number] = r.answer_value })
      setAnswers(saved)
      const lastAnswered = Math.max(...existing.map(r => r.question_number))
      setCurrent(Math.min(lastAnswered, section1Questions.length - 1))
    }
    setLoading(false)
  }

  async function handleAnswer(choice) {
    const newAnswers = { ...answers, [question.number]: choice }
    setAnswers(newAnswers)
    setSaving(true)

    await supabase.from('section1_responses').upsert({
      user_id: session.user.id,
      question_number: question.number,
      answer_value: choice,
      category: question.category
    })

    // Unlock early match pool at question 15
    if (question.number === 15) {
      await supabase
        .from('users')
        .update({ profile_status: 'active', section1_progress: 15 })
        .eq('id', session.user.id)
    }

    // Update progress
    await supabase
      .from('users')
      .update({ section1_progress: question.number })
      .eq('id', session.user.id)

    setSaving(false)

    if (current < section1Questions.length - 1) {
      setCurrent(current + 1)
    } else {
      // All 40 done
      await supabase
        .from('users')
        .update({ section1_complete: true, section1_last_edited: new Date().toISOString() })
        .eq('id', session.user.id)
      navigate('/home')
    }
  }

  function handleBack() {
    if (current > 0) setCurrent(current - 1)
  }

  if (loading) {
    return (
      <div className="s1-loading">
        <div className="s1-spinner">💝</div>
        <p>Loading your questions...</p>
      </div>
    )
  }

  return (
    <div className="s1-container">
      <div className="s1-header">
        <button className="s1-back" onClick={handleBack} disabled={current === 0}>
          ←
        </button>
        <div className="s1-progress-bar">
          <div className="s1-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="s1-counter">{current + 1}/40</span>
      </div>

      <div className="s1-card">
        <p className="s1-category">{question.category}</p>
        <h2 className="s1-question">{question.text}</h2>

        {current === 14 && (
          <div className="s1-milestone">
            🎉 Almost there! After this question you enter the match pool.
          </div>
        )}

        <div className="s1-choices">
          {question.choices.map((choice, i) => (
            <button
              key={i}
              className={`s1-choice ${answers[question.number] === choice ? 'selected' : ''}`}
              onClick={() => handleAnswer(choice)}
              disabled={saving}
            >
              {choice}
            </button>
          ))}
        </div>

        {saving && <p className="s1-saving">Saving...</p>}
      </div>
    </div>
  )
}