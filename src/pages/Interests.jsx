import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function toggleTag(tag) {
    if (selected.includes(tag)) {
      setSelected(selected.filter(t => t !== tag))
    } else {
      setSelected([...selected, tag])
    }
  }

  async function handleSubmit() {
    if (selected.length < 3) {
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

    navigate('/home')
  }

  return (
    <div className="interests-container">
      <div className="interests-card">
        <h2 className="interests-title">Your Interests</h2>
        <p className="interests-subtitle">
          Select at least 3 — these help us find your matches
        </p>

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
          {selected.length} selected {selected.length < 3 ? `(${3 - selected.length} more needed)` : '✓'}
        </p>

        {error && <p className="interests-error">{error}</p>}

        <button
          className="interests-btn"
          onClick={handleSubmit}
          disabled={selected.length < 3 || loading}
        >
          {loading ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  )
}