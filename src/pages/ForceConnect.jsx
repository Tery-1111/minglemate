import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './ForceConnect.css'

// FORCE CONNECT: selection/confirmation for the KSh 80 payment that
// creates a Qrashe match. The recipient is notified and cannot
// decline — stated plainly on this screen.
export default function ForceConnect() {
  const navigate = useNavigate()
  const { userId } = useParams()
  const [profile, setProfile] = useState(null)
  const [face, setFace] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [userId])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }

    const { data: u } = await supabase
      .from('profiles_public')
      .select('id, full_name, age')
      .eq('id', userId)
      .single()
    setProfile(u || null)

    if (u) {
      const { data: photos } = await supabase
        .from('photos')
        .select('photo_url, photo_type')
        .eq('user_id', userId)
        .eq('photo_type', 'facial')
        .order('display_order')
        .limit(1)
      setFace(photos?.[0]?.photo_url || null)
    }
    setLoading(false)
  }

  if (loading) {
    return <div className="fc-page"><p className="fc-loading">Loading…</p></div>
  }

  if (!profile) {
    return (
      <div className="fc-page">
        <div className="fc-card"><p className="fc-none">Profile not found.</p></div>
      </div>
    )
  }

  return (
    <div className="fc-page">
      <div className="fc-card">
        <button className="fc-back" onClick={() => navigate('/discover')}>←</button>
        <h1 className="fc-title">Force Connect</h1>

        {face ? (
          <img src={face} alt={profile.full_name} className="fc-photo" />
        ) : (
          <div className="fc-photo fc-photo-empty">👤</div>
        )}

        <p className="fc-name">{profile.full_name}, {profile.age}</p>

        <div className="fc-price">
          <span className="fc-amount">KSh 80</span>
          <span className="fc-label">one-time · via M-Pesa</span>
        </div>

        <ul className="fc-facts">
          <li>You'll be matched immediately after payment.</li>
          <li>{profile.full_name.split(' ')[0]} will be notified — Force Connects can't be declined.</li>
          <li>A conversation opens for both of you right away.</li>
        </ul>

        <button
          className="fc-btn"
          onClick={() => navigate(`/payment?purpose=force_connect&recipientId=${profile.id}`)}
        >
          Continue to Payment →
        </button>
      </div>
    </div>
  )
}
