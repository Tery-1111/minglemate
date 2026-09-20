import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Interests.css'

const ALL_TAGS = [
  'Football', 'Basketball', 'Coding', 'Reading', 'Music',
  'Gaming', 'Cooking', 'Hiking', 'Faith/Church', 'Drama',
  'Student Politics', 'Photography', 'Fashion', 'Agriculture',
  'Debate', 'Dance', 'YouTube', 'Art', 'Fitness', 'Travelling',
  'Chess', 'Poetry', 'Volunteering', 'SACCO', 'Animation',
  'Science', 'Business', 'Film', 'Languages', 'Environment'
]

export default function Interests() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Edit mode (Profile → Edit interests) returns to Profile when
  // done. Onboarding mode keeps the original flow: ≥3 interests,
  // then on to the Algorithm Questionnaire.
  const isEdit = searchParams.get('edit') === '1'

  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(!isEdit)

  useEffect(() => {
    if (!isEdit) return
    async function prefill() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const { data: profile } = await supabase
        .from('users')
        .select('interests')
        .eq('id', session.user.id)
        .single()
      setSelected(Array.isArray(profile?.interests) ? profile.interests : [])
      setLoaded(true)
    }
    prefill()
  }, [isEdit, navigate])

  function toggleTag(tag) {
    if (selected.includes(tag)) {
      setSelected(selected.filter(t => t !== tag))
    } else {
      setSelected([...selected, tag])
    }
  }

  async function handleSubmit() {
    // Onboarding still requires at least 3; editing never forces a
    // minimum (deselecting everything is allowed there).
    if (!isEdit && selected.length < 3) {
      setError('Please select at least 3 interests.')
      return
    }

    setLoading(true)
    setError('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      navigate('/login')
      return
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ interests: selected })
      .eq('id', session.user.id)

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    if (isEdit) {
      // Edit interests → back to Profile. No questionnaire detour.
      navigate('/profile')
      return
    }

    // Onboarding order: Sign Up → Profile → Photos → Interests →
    // Algorithm Questionnaire (Section 1) → Guided Questions (Section 2)
    navigate('/section1')
  }

  return (
    <div className="interests-container">
      <div className="interests-card">
        <h2 className="interests-title">
          {isEdit ? 'Edit Your Interests' : 'Your Interests'}
        </h2>
        <p className="interests-subtitle">
          {isEdit
            ? 'Update your interests — these help us find your matches'
            : 'Select at least 3 — these help us find your matches'}
        </p>

        {loaded ? (
          <>
            <div className="tags-grid">
              {ALL_TAGS.map(tag => (
                <button
                  key={tag}
                  className={`tag-btn ${selected.includes(tag) ? 'selected' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>

            <p className="tag-counter">
              {selected.length} selected
              {!isEdit && selected.length < 3 ? ` (${3 - selected.length} more needed)` : ' ✓'}
            </p>

            {error && <p className="interests-error">{error}</p>}

            <button
              className="interests-btn"
              onClick={handleSubmit}
              disabled={(!isEdit && selected.length < 3) || loading}
            >
              {loading ? 'Saving...' : isEdit ? 'Save interests' : 'Continue'}
            </button>
          </>
        ) : (
          <p className="interests-error">Loading your interests…</p>
        )}
      </div>
    </div>
  )
}
