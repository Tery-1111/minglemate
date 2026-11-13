import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { signPhotoUrl } from '../lib/photoUrls'
import './ForceConnect.css'

// FORCE CONNECT: confirmation for the KSh 80 payment that creates a
// Qrashe match. Receipt pattern (matches the Payment screen that
// follows): who, what you pay, what happens — stated plainly. The
// recipient is notified and cannot decline.
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
      setFace(await signPhotoUrl(photos?.[0]?.photo_url))
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="fc-page">
        <p className="fc-loading loading-dots">Loading</p>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="fc-page">
        <div className="fc-card">
          <button className="fc-back" onClick={() => navigate('/discover')}>← Back</button>
          <div className="fc-missing">
            <h1 className="fc-missing-title">Profile not found</h1>
            <p className="fc-missing-sub">
              This person may no longer be available. Head back to Discover
              to see who's here this week.
            </p>
            <button className="fc-btn" onClick={() => navigate('/discover')}>
              Back to Discover
            </button>
          </div>
        </div>
      </div>
    )
  }

  const firstName = profile.full_name.split(' ')[0]

  return (
    <div className="fc-page">
      <div className="fc-card">
        <button className="fc-back" onClick={() => navigate('/discover')}>← Back</button>

        <p className="fc-eyebrow">Force Connect</p>
        <h1 className="fc-title">Connect with {firstName} now</h1>

        <div className="fc-person">
          {face ? (
            <img src={face} alt={profile.full_name} className="fc-photo" loading="lazy" />
          ) : (
            <span className="fc-photo fc-photo-empty" aria-hidden="true">{firstName.charAt(0)}</span>
          )}
          <div className="fc-person-info">
            <span className="fc-name">{profile.full_name}, {profile.age}</span>
            <span className="fc-person-sub">Not matched with you yet — that's what this does.</span>
          </div>
        </div>

        <div className="fc-receipt" aria-label="Purchase summary">
          <div className="fc-receipt-row fc-receipt-total">
            <span>You pay</span>
            <strong className="fc-amount">KSh 80</strong>
          </div>
          <div className="fc-receipt-row">
            <span>You get</span>
            <strong>An instant Qrashe match with {firstName}</strong>
          </div>
          <div className="fc-receipt-row">
            <span>Then</span>
            <strong>A conversation opens for both of you</strong>
          </div>
          <div className="fc-receipt-row">
            <span>Charged</span>
            <strong>Once · via M-Pesa</strong>
          </div>
        </div>

        <p className="fc-honest">
          {firstName} will be notified and <strong>cannot decline</strong> a
          Force Connect. Please use it thoughtfully.
        </p>

        <button
          className="fc-btn"
          onClick={() => navigate(`/payment?purpose=force_connect&recipientId=${profile.id}`)}
        >
          Continue to Payment →
        </button>

        <p className="fc-note">
          The price is set by MingleMate and can't be altered. Payment is
          verified before the match is created.
        </p>
      </div>
    </div>
  )
}
