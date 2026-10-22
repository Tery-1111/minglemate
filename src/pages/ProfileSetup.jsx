import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './ProfileSetup.css'

export default function ProfileSetup() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [campus, setCampus] = useState(null)
  const [form, setForm] = useState({
    full_name: '',
    age: '',
    gender: '',
    residence_type: '',
    bio: '',
    phone: '',
    whatsapp_number: '',
    display_phone: '',
    social_instagram: '',
    social_x: '',
    social_tiktok: ''
  })

  useEffect(() => {
    getSession()
  }, [])

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      navigate('/')
      return
    }
    const email = session.user.email
    const domain = email.split('@')[1]

    // GENERAL STUDENT PLATFORM: institution is derived from the email
    // domain — no hardcoded university. A domain that matches a
    // registered campus scopes the user to that campus; any other
    // domain (gmail, another institution, etc.) leaves campus_id
    // unset and the platform treats them as an unaffiliated student.
    if (domain) {
      const { data: campusData } = await supabase
        .from('campuses')
        .select('id, name')
        .eq('email_domain', domain)
        .maybeSingle()
      setCampus(campusData)
    }
  }

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleSubmit() {
    if (!form.full_name || !form.age || !form.gender || !form.residence_type || !form.bio) {
      setError('Please fill in all required fields.')
      return
    }
    if (form.bio.length < 50) {
      setError('Bio must be at least 50 characters.')
      return
    }
    if (parseInt(form.age) < 18) {
      setError('You must be at least 18 years old.')
      return
    }
    if (!form.phone || !form.whatsapp_number) {
      setError('Please enter your phone and WhatsApp number.')
      return
    }

    setLoading(true)
    setError('')

    const { data: { session } } = await supabase.auth.getSession()

    // update, not upsert: the row exists from the signup trigger, and an
    // upsert's `on conflict (id) do update` reads the payload's email column,
    // which the grants withhold (measured 42501). One row, matched by id.
    const { error: upsertError } = await supabase
      .from('users')
      .update({
        full_name: form.full_name,
        age: parseInt(form.age),
        gender: form.gender,
        campus_id: campus?.id,
        residence_type: form.residence_type,
        bio: form.bio,
        phone: form.phone,
        whatsapp_number: form.whatsapp_number,
        display_phone: form.display_phone || form.phone,
        social_instagram: form.social_instagram || null,
        social_x: form.social_x || null,
        social_tiktok: form.social_tiktok || null,
        // section2_free_expires_at is deliberately NOT sent by the client:
        // the 14-day trial is granted server-side by handle_new_user() when
        // the profile row is created, and clamp_user_protected_columns
        // discards any client write to it or to section2_unlocked.
      })
      .eq('id', session.user.id)

    if (upsertError) {
      setError(upsertError.message)
      setLoading(false)
      return
    }

    navigate('/photo-upload')
  }

  return (
    <div className="profile-container">
      <div className="profile-card">
        <h2 className="profile-title">Your Profile</h2>
        <p className="profile-subtitle">Tell us about yourself</p>

        {campus && (
          <div className="campus-badge">
            🎓 {campus.name}
          </div>
        )}

        <input
          className="profile-input"
          type="text"
          name="full_name"
          placeholder="Full name"
          value={form.full_name}
          onChange={handleChange}
        />

        <input
          className="profile-input"
          type="number"
          name="age"
          placeholder="Age"
          min="18"
          max="35"
          value={form.age}
          onChange={handleChange}
        />

        <div className="gender-toggle">
          <button
            className={`gender-btn ${form.gender === 'male' ? 'active' : ''}`}
            onClick={() => setForm({ ...form, gender: 'male' })}
          >
            Male
          </button>
          <button
            className={`gender-btn ${form.gender === 'female' ? 'active' : ''}`}
            onClick={() => setForm({ ...form, gender: 'female' })}
          >
            Female
          </button>
        </div>

        <select
          className="profile-input"
          name="residence_type"
          value={form.residence_type}
          onChange={handleChange}
        >
          <option value="">Where do you live?</option>
          <option value="campus_hostel">Campus Hostel</option>
          <option value="off_campus_bedsitter">Off-campus Bedsitter</option>
          <option value="with_family">With Family</option>
          <option value="shared_room">Shared Room</option>
          <option value="other">Other</option>
        </select>

        <textarea
          className="profile-input profile-textarea"
          name="bio"
          placeholder="Write a short bio (minimum 50 characters)..."
          value={form.bio}
          onChange={handleChange}
        />
        <p className="bio-counter">{form.bio.length} / 50 minimum</p>

        <p className="contact-section-label">📞 Contact Details</p>
        <p className="contact-section-sub">
          Your phone number, WhatsApp number and social handles are not public. They are only
          revealed to your matches through the Connect feature according to your sharing choices.
        </p>

        <input
          className="profile-input"
          type="tel"
          name="phone"
          placeholder="Phone number e.g. 0712345678"
          value={form.phone}
          onChange={handleChange}
        />

        <input
          className="profile-input"
          type="tel"
          name="whatsapp_number"
          placeholder="WhatsApp number e.g. 0712345678"
          value={form.whatsapp_number}
          onChange={handleChange}
        />

        <p className="contact-section-label">🔗 Social handles (optional)</p>

        <input
          className="profile-input"
          type="text"
          name="social_instagram"
          placeholder="Instagram username (optional)"
          value={form.social_instagram}
          onChange={handleChange}
        />

        <input
          className="profile-input"
          type="text"
          name="social_x"
          placeholder="X / Twitter username (optional)"
          value={form.social_x}
          onChange={handleChange}
        />

        <input
          className="profile-input"
          type="text"
          name="social_tiktok"
          placeholder="TikTok username (optional)"
          value={form.social_tiktok}
          onChange={handleChange}
        />

        <input
          className="profile-input"
          type="email"
          name="display_phone"
          placeholder="Email to share with match (optional)"
          value={form.display_phone}
          onChange={handleChange}
        />

        {error && <p className="profile-error">{error}</p>}

        <button
          className="profile-btn"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  )
}