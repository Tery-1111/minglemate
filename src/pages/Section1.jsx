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
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    loadProgress()
  }, [])

  async function loadProgress() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setUserId(session.user.id)

    const { data: existing } = await supabase
      .from('section1_responses')
      .select('question_number, answer_value')
      .eq('user_id', session.user.id)

    if (existing && existing.length > 0) {
      const loaded = {}
      existing.forEach(r => { loaded[r.question_number] = r.answer_value })
      setAnswers(loaded)
      const lastAnswered = Math.max(...existing.map(r => r.question_number))
      const nextIndex = Math.min(lastAnswered, section1Questions.length - 1)
      setCurrent(nextIndex)
    }
    setLoading(false)
  }

  async function handleAnswer(choice) {
    const question = section1Questions[current]
    const newAnswers = { ...answers, [question.number]: choice }
    setAnswers(newAnswers)
    setSaving(true)

    await supabase.from('section1_responses').upsert({
      user_id: userId,
      question_number: question.number,
      answer_value: choice,
      category: question.category
    })

    // Unlock early match pool at question 15
    if (question.number === 15) {
      await supabase
        .from('users')
        .update({
          profile_status: 'active',
          section1_progress: 15
        })
        .eq('id', userId)
    }

    // Complete at question 40
    if (question.number === 40) {
      await supabase
        .from('users')
        .update({
          section1_complete: true,
          section1_progress: 40,
          section1_last_edited: new Date().toISOString()
        })
        .eq('id', userId)
      setSaving(false)
      navigate('/home')
      return
    }

    setSaving(false)

    if (current < section1Questions.length - 1) {
      setCurrent(current + 1)
    }
  }

  if (loading) {
    return (
      <div className="s1-loading">
        <p>Loading your questions...</p>
      </div>
    )
  }

  const question = section1Questions[current]
  const progress = ((current + 1) / section1Questions.length) * 100

  return (
    <div className="s1-container">
      <div className="s1-header">
        <button className="s1-back" onClick={() => current > 0 ? setCurrent(current - 1) : navigate('/home')}>
          ←
        </button>
        <span className="s1-progress-text">Question {current + 1} of {section1Questions.length}</span>
        <span className="s1-category">{question.category}</span>
      </div>

      <div className="s1-progress-bar">
        <div className="s1-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="s1-content">
        <h2 className="s1-question">{question.text}</h2>

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

        {current === 14 && (
          <div className="s1-milestone">
            🎉 Almost there! One more answer and you enter the match pool.
          </div>
        )}
      </div>
    </div>
  )
}