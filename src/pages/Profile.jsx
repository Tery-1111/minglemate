import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { signPhotoUrls } from '../lib/photoUrls'
import BottomNav from '../components/BottomNav'
import {
  BIO_MAX,
  MAX_PROMPTS,
  PROMPT_ANSWER_MAX,
  PROMPT_LIBRARY,
  LOOKING_FOR_OPTIONS,
  validateProfileEdits,
} from '../lib/profile'
import './Profile.css'

const ALL_TAGS = [
  'Football', 'Basketball', 'Coding', 'Reading', 'Music',
  'Gaming', 'Cooking', 'Hiking', 'Faith/Church', 'Drama',
  'Student Politics', 'Photography', 'Fashion', 'Agriculture',
  'Debate', 'Dance', 'YouTube', 'Art', 'Fitness', 'Travelling',
  'Chess', 'Poetry', 'Volunteering', 'SACCO', 'Animation',
  'Science', 'Business', 'Film', 'Languages', 'Environment',
]

export default function Profile() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Save-state machine for the edit form: idle → saving → saved | error.
  // 'saved' is a visible confirmation, not a silent success.
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    bio: '',
    residence_type: '',
    looking_for: '',
    interests: [],
    prompts: [],
  })

  // Local draft of prompts while editing (id + question + answer)
  const [promptDraft, setPromptDraft] = useState([])

  // Contact sharing controls (owner-only). Affect FUTURE paid
  // connects only — already-paid unlocks keep their snapshot.
  const [sharing, setSharing] = useState({
    share_phone: true,
    share_whatsapp: true,
    share_email: false,
    share_social_instagram: true,
    share_social_x: true,
    share_social_tiktok: true,
    social_instagram: '',
    social_x: '',
    social_tiktok: '',
  })
  const [savingSharing, setSavingSharing] = useState(false)
  const [sharingMsg, setSharingMsg] = useState('')

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/login'); return }

    // Full own row (includes profile_prompts) via definer RPC
    const { data: rows } = await supabase.rpc('my_profile')
    const userData = rows?.[0] || null

    const { data: photoData } = await supabase
      .from('photos')
      .select('*')
      .eq('user_id', session.user.id)
      .order('display_order')

    setUser(userData)
    const photoRows = photoData || []
    const signedProfile = await signPhotoUrls(photoRows.map(p => p.photo_url))
    setPhotos(
      photoRows
        .map(p => ({ ...p, photo_url: signedProfile.get(p.photo_url) ?? null }))
        .filter(p => p.photo_url)
    )
    const prompts = Array.isArray(userData?.profile_prompts)
      ? userData.profile_prompts
      : []
    setForm({
      bio: userData?.bio || '',
      residence_type: userData?.residence_type || '',
      looking_for: userData?.looking_for || '',
      interests: userData?.interests || [],
      prompts,
    })
    setPromptDraft(prompts.map(p => ({ ...p })))
    setSharing({
      share_phone: userData?.share_phone !== false,
      share_whatsapp: userData?.share_whatsapp !== false,
      share_email: userData?.share_email === true,
      share_social_instagram: userData?.share_social_instagram !== false,
      share_social_x: userData?.share_social_x !== false,
      share_social_tiktok: userData?.share_social_tiktok !== false,
      social_instagram: userData?.social_instagram || '',
      social_x: userData?.social_x || '',
      social_tiktok: userData?.social_tiktok || '',
    })
    setLoading(false)
  }

  function startEditing() {
    setPromptDraft(form.prompts.map(p => ({ ...p })))
    setError('')
    setSaveState('idle')
    setEditing(true)
  }

  function togglePrompt(promptId) {
    setPromptDraft(prev => {
      const existing = prev.find(p => p.id === promptId)
      if (existing) return prev.filter(p => p.id !== promptId)
      if (prev.length >= MAX_PROMPTS) {
        setError('You can answer at most 3 prompts.')
        return prev
      }
      const entry = PROMPT_LIBRARY.find(p => p.id === promptId)
      setError('')
      return [...prev, { id: entry.id, question: entry.question, answer: '' }]
    })
  }

  function setPromptAnswer(promptId, answer) {
    setPromptDraft(prev =>
      prev.map(p => (p.id === promptId ? { ...p, answer } : p))
    )
  }

  function toggleInterest(tag) {
    setForm(prev => {
      const has = prev.interests.includes(tag)
      if (!has && prev.interests.length >= 15) {
        setError('Pick at most 15 interests.')
        return prev
      }
      setError('')
      return {
        ...prev,
        interests: has
          ? prev.interests.filter(t => t !== tag)
          : [...prev.interests, tag],
      }
    })
  }

  async function handleSave() {
    if (saving) return // no duplicate submits
    setError('')

    // Same limits the DB constraints enforce (bio 300, prompts <= 3)
    const check = validateProfileEdits({
      bio: form.bio,
      prompts: promptDraft,
      looking_for: form.looking_for,
      interests: form.interests,
    })
    if (!check.ok) {
      setError(check.error)
      return
    }

    setSaving(true)
    setSaveState('saving')
    const { data: { session } } = await supabase.auth.getSession()

    const { error: updateError } = await supabase
      .from('users')
      .update({
        bio: check.value.bio,
        residence_type: form.residence_type,
        looking_for: check.value.looking_for,
        interests: check.value.interests,
        profile_prompts: check.value.prompts,
      })
      .eq('id', session.user.id)

    if (updateError) {
      // ROLLBACK: keep every edit in the form (nothing discarded),
      // state the failure plainly.
      setError(updateError.message || 'Could not save your changes.')
      setSaveState('error')
      setSaving(false)
      return
    }

    // Success: reflect immediately (the visible profile updates in
    // place), show a stamped confirmation, exit edit mode.
    setUser({ ...user, ...check.value })
    setForm(prev => ({ ...prev, prompts: check.value.prompts }))
    setSaveState('saved')
    setEditing(false)
    setSaving(false)
    setTimeout(() => setSaveState('idle'), 2500)
  }

  async function handleSharingSave() {
    setSavingSharing(true)
    setSharingMsg('')
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase
      .from('users')
      .update({
        share_phone: sharing.share_phone,
        share_whatsapp: sharing.share_whatsapp,
        share_email: sharing.share_email,
        share_social_instagram: sharing.share_social_instagram,
        share_social_x: sharing.share_social_x,
        share_social_tiktok: sharing.share_social_tiktok,
        social_instagram: sharing.social_instagram || null,
        social_x: sharing.social_x || null,
        social_tiktok: sharing.social_tiktok || null,
      })
      .eq('id', session.user.id)
    setSharingMsg(error ? (error.message || 'Could not save.') : 'Saved — applies to future Connects.')
    setSavingSharing(false)
  }

  if (loading) {
    return (
      <div className="profile-loading">
        <p>Loading profile...</p>
      </div>
    )
  }

  const isPaused = user?.profile_status === 'paused'

  return (
    <div className="profile-page">
      <div className="profile-header">
        <button className="profile-back" onClick={() => navigate('/home')}>←</button>
        <h2 className="profile-heading">My Profile</h2>
        <button
          className="profile-edit-btn"
          onClick={() => (editing ? setEditing(false) : startEditing())}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {/* CONSEQUENCE: a saved edit is confirmed in text (works without
          animation); an edit-in-progress is announced via aria-busy. */}
      {saveState === 'saved' && (
        <p className="profile-save-banner stamp-in" role="status">Changes saved ✓</p>
      )}

      {isPaused && !editing && (
        <div className="profile-paused-banner">
          ⏸ Your profile is paused — hidden from matching. Resume in Settings.
        </div>
      )}

      <div className="profile-photos">
        {photos.map((photo, i) => (
          <img
            key={i}
            src={photo.photo_url}
            alt={`Photo ${i + 1}`}
            className="profile-photo"
          />
        ))}
        {photos.length === 0 && (
          <div className="no-photos">
            <p>No photos yet</p>
            <button onClick={() => navigate('/photos')}>Upload Photos</button>
          </div>
        )}
      </div>

      {!editing && (
        <button className="profile-action-btn" onClick={() => navigate('/photos')}>
          📸 Manage photos (facial + full-body)
        </button>
      )}

      <div className="profile-info">
        <h2 className="profile-name">{user?.full_name}</h2>
        <p className="profile-meta">
          {user?.age} years • {user?.gender}
          {user?.campus_id ? ' • Campus verified' : ''}
        </p>

        {editing ? (
          <div className="profile-edit-form">
            <label className="profile-field-label">About you</label>
            <textarea
              className="profile-bio-input"
              value={form.bio}
              onChange={e => setForm({ ...form, bio: e.target.value.slice(0, BIO_MAX) })}
              rows={4}
              maxLength={BIO_MAX}
              placeholder="Write your bio..."
            />
            <p className={`bio-counter ${form.bio.length >= BIO_MAX ? 'at-limit' : ''}`}>
              {form.bio.length} / {BIO_MAX}
            </p>

            <label className="profile-field-label">Relationship intention</label>
            <select
              className="profile-select"
              value={form.looking_for || ''}
              onChange={e => setForm({ ...form, looking_for: e.target.value })}
            >
              <option value="">Select intention…</option>
              {LOOKING_FOR_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <label className="profile-field-label">Where do you live?</label>
            <select
              className="profile-select"
              value={form.residence_type}
              onChange={e => setForm({ ...form, residence_type: e.target.value })}
            >
              <option value="">Where do you live?</option>
              <option value="campus_hostel">Campus Hostel</option>
              <option value="off_campus_bedsitter">Off-campus Bedsitter</option>
              <option value="with_family">With Family</option>
              <option value="shared_room">Shared Room</option>
              <option value="other">Other</option>
            </select>

            <label className="profile-field-label">
              Prompts ({promptDraft.length}/{MAX_PROMPTS})
            </label>
            {promptDraft.map(p => (
              <div key={p.id} className="prompt-edit-block">
                <div className="prompt-edit-header">
                  <span className="prompt-edit-question">{p.question}</span>
                  <button
                    type="button"
                    className="prompt-remove"
                    onClick={() => togglePrompt(p.id)}
                    aria-label="Remove prompt"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  className="prompt-answer-input"
                  value={p.answer}
                  rows={2}
                  maxLength={PROMPT_ANSWER_MAX}
                  placeholder="Your answer…"
                  onChange={e => setPromptAnswer(p.id, e.target.value)}
                />
                <p className="prompt-answer-counter">
                  {p.answer.length} / {PROMPT_ANSWER_MAX}
                </p>
              </div>
            ))}

            {promptDraft.length < MAX_PROMPTS && (
              <div className="prompt-picker">
                {PROMPT_LIBRARY
                  .filter(p => !promptDraft.some(d => d.id === p.id))
                  .map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className="prompt-choice"
                      onClick={() => togglePrompt(p.id)}
                    >
                      + {p.question}
                    </button>
                  ))}
              </div>
            )}

            <label className="profile-field-label">
              Interests ({form.interests.length}/15)
            </label>
            <div className="interests-editor">
              {ALL_TAGS.map(tag => {
                const on = form.interests.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`interest-chip ${on ? 'selected' : ''}`}
                    onClick={() => toggleInterest(tag)}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>

            {error && <p className="profile-error-text" role="alert">{error}</p>}

            <button
              className="profile-save-btn"
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
            >
              {saveState === 'error' ? 'Retry saving' : saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        ) : (
          <>
            <p className="profile-bio">{user?.bio || 'No bio yet'}</p>
            {user?.looking_for && (
              <p className="profile-residence">
                💫 {LOOKING_FOR_OPTIONS.find(o => o.value === user.looking_for)?.label || user.looking_for}
              </p>
            )}
            <p className="profile-residence">🏠 {user?.residence_type?.replace(/_/g, ' ')}</p>

            {(user?.profile_prompts || []).length > 0 && (
              <div className="profile-prompts">
                {user.profile_prompts.map(p => (
                  <div key={p.id} className="profile-prompt">
                    <p className="profile-prompt-q">{p.question}</p>
                    <p className="profile-prompt-a">{p.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="profile-interests">
          <h3>Interests</h3>
          <div className="interests-tags">
            {(user?.interests || []).map((tag, i) => (
              <span key={i} className="interest-tag">{tag}</span>
            ))}
            {(user?.interests || []).length === 0 && (
              <p className="no-photos">No interests selected yet</p>
            )}
          </div>
        </div>

        {!editing && (
          <div className="profile-sharing">
            <h3>Contact sharing</h3>
            <p className="profile-sharing-note">
              Your phone number, WhatsApp number and social handles are not public. They are only
              revealed to your matches through the Connect feature according to these choices.
              Changes affect future paid connections only — buyers keep what they already unlocked.
            </p>
            <label className="sharing-toggle">
              <input
                type="checkbox"
                checked={sharing.share_phone}
                onChange={e => setSharing({ ...sharing, share_phone: e.target.checked })}
              />
              Share phone number
            </label>
            <label className="sharing-toggle">
              <input
                type="checkbox"
                checked={sharing.share_whatsapp}
                onChange={e => setSharing({ ...sharing, share_whatsapp: e.target.checked })}
              />
              Share WhatsApp number
            </label>
            <label className="sharing-toggle">
              <input
                type="checkbox"
                checked={sharing.share_email}
                onChange={e => setSharing({ ...sharing, share_email: e.target.checked })}
              />
              Share email
            </label>
            <label className="sharing-toggle">
              <input
                type="checkbox"
                checked={sharing.share_social_instagram}
                onChange={e => setSharing({ ...sharing, share_social_instagram: e.target.checked })}
              />
              Share Instagram handle
            </label>
            <input
              className="profile-select"
              type="text"
              placeholder="Instagram username (optional)"
              value={sharing.social_instagram}
              onChange={e => setSharing({ ...sharing, social_instagram: e.target.value })}
            />
            <label className="sharing-toggle">
              <input
                type="checkbox"
                checked={sharing.share_social_x}
                onChange={e => setSharing({ ...sharing, share_social_x: e.target.checked })}
              />
              Share X / Twitter handle
            </label>
            <input
              className="profile-select"
              type="text"
              placeholder="X / Twitter username (optional)"
              value={sharing.social_x}
              onChange={e => setSharing({ ...sharing, social_x: e.target.value })}
            />
            <label className="sharing-toggle">
              <input
                type="checkbox"
                checked={sharing.share_social_tiktok}
                onChange={e => setSharing({ ...sharing, share_social_tiktok: e.target.checked })}
              />
              Share TikTok handle
            </label>
            <input
              className="profile-select"
              type="text"
              placeholder="TikTok username (optional)"
              value={sharing.social_tiktok}
              onChange={e => setSharing({ ...sharing, social_tiktok: e.target.value })}
            />
            <button
              className="profile-action-btn"
              onClick={handleSharingSave}
              disabled={savingSharing}
            >
              {savingSharing ? 'Saving...' : 'Save sharing choices'}
            </button>
            {sharingMsg && <p className="sharing-msg">{sharingMsg}</p>}
          </div>
        )}

        <div className="profile-actions">
          <button
            className="profile-action-btn"
            onClick={() => navigate('/interests?edit=1')}
          >
            ✏️ Edit interests
          </button>
          <button
            className="profile-action-btn"
            onClick={() => navigate('/section1?retake=1')}
          >
            📝 Retake Algorithm Questionnaire
          </button>
          <button
            className="profile-action-btn"
            onClick={() => navigate('/section2')}
          >
            💭 Guided Questions
          </button>
          <button
            className="profile-action-btn"
            onClick={() => navigate('/settings')}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Primary navigation — Profile is the 4th tab, same as the
          other main screens (fixes the navigation dead end). */}
      <BottomNav active="profile" />
    </div>
  )
}
