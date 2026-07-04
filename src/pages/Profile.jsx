import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Profile.css'

export default function Profile() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ bio: '', residence_type: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single()

    const { data: photoData } = await supabase
      .from('photos')
      .select('*')
      .eq('user_id', session.user.id)
      .order('display_order')

    setUser(userData)
    setPhotos(photoData || [])
    setForm({
      bio: userData?.bio || '',
      residence_type: userData?.residence_type || ''
    })
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()

    await supabase
      .from('users')
      .update({
        bio: form.bio,
        residence_type: form.residence_type
      })
      .eq('id', session.user.id)

    setUser({ ...user, ...form })
    setEditing(false)
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="profile-loading">
        <p>Loading profile...</p>
      </div>
    )
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <button className="profile-back" onClick={() => navigate('/home')}>←</button>
        <h2 className="profile-heading">My Profile</h2>
        <button className="profile-edit-btn" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

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
            <button onClick={() => navigate('/photo-upload')}>Upload Photos</button>
          </div>
        )}
      </div>

      <div className="profile-info">
        <h2 className="profile-name">{user?.full_name}</h2>
        <p className="profile-meta">{user?.age} years • {user?.gender}</p>

        {editing ? (
          <div className="profile-edit-form">
            <textarea
              className="profile-bio-input"
              value={form.bio}
              onChange={e => setForm({ ...form, bio: e.target.value })}
              rows={4}
              placeholder="Write your bio..."
            />
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
            <button
              className="profile-save-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        ) : (
          <>
            <p className="profile-bio">{user?.bio}</p>
            <p className="profile-residence">🏠 {user?.residence_type?.replace(/_/g, ' ')}</p>
          </>
        )}

        <div className="profile-interests">
          <h3>Interests</h3>
          <div className="interests-tags">
            {(user?.interests || []).map((tag, i) => (
              <span key={i} className="interest-tag">{tag}</span>
            ))}
          </div>
        </div>

        <div className="profile-actions">
          <button
            className="profile-action-btn"
            onClick={() => navigate('/section1')}
          >
            📝 Section 1 Questions
          </button>
          {/* Section 2 button successfully removed to lock down flow integrity */}
        </div>
      </div>
    </div>
  )
}
