import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Settings.css'

const APP_VERSION = '1.0.0'

export default function Settings() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState(null)
  const [blocked, setBlocked] = useState([])

  // pause state
  const [pausing, setPausing] = useState(false)

  // notifications state
  const [notifSaving, setNotifSaving] = useState(false)

  // delete flow state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteText, setDeleteText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Synchronous guard against double submission: React state commits async,
  // a ref is set in the same tick as the first click and checked on every one.
  const deleteInFlightRef = useRef(false)

  // Logout: acknowledged immediately, guarded against double clicks.
  // We do NOT fake a logged-out screen before signOut() completes.
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/login'); return }

    // Own row (full columns incl. notifications_enabled) via definer RPC
    const { data: rows } = await supabase.rpc('my_profile')
    setMe(rows?.[0] || null)

    // Blocks I made — show who and let me unblock
    const { data: blocks } = await supabase
      .from('user_blocks')
      .select('blocked_id, created_at, profile:users!user_blocks_blocked_id_fkey(full_name)')
      .eq('blocker_id', user.id)
      .order('created_at', { ascending: false })
    setBlocked(blocks || [])

    setLoading(false)
  }

  async function togglePause() {
    if (pausing) return
    setPausing(true)
    const next = me?.profile_status === 'paused' ? 'active' : 'paused'
    const { error } = await supabase
      .from('users')
      .update({ profile_status: next })
      .eq('id', me.id)
    if (!error) setMe({ ...me, profile_status: next })
    setPausing(false)
  }

  async function toggleNotifications() {
    if (notifSaving) return
    setNotifSaving(true)
    const next = !me?.notifications_enabled
    const { error } = await supabase
      .from('users')
      .update({ notifications_enabled: next })
      .eq('id', me.id)
    if (!error) setMe({ ...me, notifications_enabled: next })
    setNotifSaving(false)
  }

  async function unblock(blockedId) {
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', me.id)
      .eq('blocked_id', blockedId)
    if (!error) {
      setBlocked(prev => prev.filter(b => b.blocked_id !== blockedId))
    }
  }

  async function confirmDelete() {
    // Type-to-confirm: the word DELETE, exactly. The ref closes a race where
    // rapid synchronous clicks land before React commits the `deleting` state.
    if (deleteText !== 'DELETE' || deleting || deleteInFlightRef.current) return
    deleteInFlightRef.current = true
    setDeleting(true)
    setDeleteError('')

    // The Edge Function derives the account from the verified session token —
    // a client can never nominate someone else's account for deletion.
    let result = null
    let invokeError = null
    try {
      const response = await supabase.functions.invoke('request-account-deletion', {
        method: 'POST',
      })
      invokeError = response.error
      result = response.data
    } catch {
      invokeError = { message: 'network' }
    }

    // A 401 means the session lapsed, not that deletion failed on the server.
    // FunctionsHttpError keeps the status on `context`.
    const status = invokeError?.context?.status
    if (status === 401 || result?.error === 'unauthenticated' || result?.error === 'session_expired') {
      setDeleteError('Your session has expired. Please sign in again, then retry.')
      setDeleting(false)
      deleteInFlightRef.current = false
      return
    }

    // Only a genuine success signs the user out. Anything else leaves the
    // account paused and retryable — we never pretend deletion completed.
    if (!invokeError && result?.success === true && result?.pending === false) {
      await supabase.auth.signOut()
      navigate('/')
      return
    }

    if (invokeError || result?.success !== true) {
      // Deliberately generic: no raw SQL, stack trace or infrastructure detail.
      setDeleteError(
        'Your profile is hidden and deletion is still in progress. ' +
          'Please try again in a moment.',
      )
      setDeleting(false)
      deleteInFlightRef.current = false
      return
    }

    setDeleting(false)
    deleteInFlightRef.current = false
  }

  if (loading) {
    return <div className="settings-loading">Loading settings…</div>
  }

  const isPaused = me?.profile_status === 'paused'

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate('/profile')} title="Back to Profile">←</button>
        <h2 className="settings-heading">Settings</h2>
        <span className="settings-header-spacer" />
      </div>

      {/* ---- Profile ---- */}
      <section className="settings-section">
        <h3 className="settings-section-title">Profile</h3>
        <button className="settings-row" onClick={() => navigate('/profile')}>
          <span>Edit profile</span>
          <span className="settings-row-arrow">→</span>
        </button>
        <button className="settings-row" onClick={() => navigate('/photos')}>
          <span>Photos</span>
          <span className="settings-row-arrow">→</span>
        </button>
        <button className="settings-row" onClick={() => navigate('/interests')}>
          <span>Interests</span>
          <span className="settings-row-arrow">→</span>
        </button>
      </section>

      {/* ---- Privacy & Safety ---- */}
      <section className="settings-section">
        <h3 className="settings-section-title">Privacy &amp; Safety</h3>

        <div className="settings-row settings-row-static">
          <span>
            Pause my profile
            <small className="settings-row-sub">
              {isPaused
                ? 'Hidden from matching until you resume.'
                : 'Take a break — hidden from new matching.'}
            </small>
          </span>
          <button
            className={`toggle ${isPaused ? 'on' : ''}`}
            onClick={togglePause}
            disabled={pausing}
            aria-label="Pause profile"
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <button className="settings-row" onClick={() => navigate('/blocked')}>
          <span>
            Blocked accounts
            {blocked.length > 0 && <small className="settings-row-sub">{blocked.length} blocked</small>}
          </span>
          <span className="settings-row-arrow">→</span>
        </button>

        <a className="settings-row" href="/faq">
          <span>Privacy policy &amp; Terms</span>
          <span className="settings-row-arrow">→</span>
        </a>
      </section>

      {/* ---- Notifications ---- */}
      <section className="settings-section">
        <h3 className="settings-section-title">Notifications</h3>
        <div className="settings-row settings-row-static">
          <span>
            Match alerts
            <small className="settings-row-sub">Weekly match + message notifications</small>
          </span>
          <button
            className={`toggle ${me?.notifications_enabled ? 'on' : ''}`}
            onClick={toggleNotifications}
            disabled={notifSaving}
            aria-label="Toggle match alerts"
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </section>

      {/* ---- Support ---- */}
      <section className="settings-section">
        <h3 className="settings-section-title">Support</h3>
        <a className="settings-row" href="/faq">
          <span>Help &amp; FAQ</span>
          <span className="settings-row-arrow">→</span>
        </a>
        <a className="settings-row" href="mailto:support@minglemate.app">
          <span>Contact us</span>
          <span className="settings-row-arrow">→</span>
        </a>
        <div className="settings-row settings-row-static">
          <span className="settings-muted">Version</span>
          <span className="settings-muted">{APP_VERSION}</span>
        </div>
      </section>

      {/* ---- Account (destructive separated) ---- */}
      <section className="settings-section settings-section-danger">
        <h3 className="settings-section-title">Account</h3>
        <button className="settings-row" onClick={() => navigate('/profile')}>
          <span>Account information</span>
          <span className="settings-row-arrow">→</span>
        </button>
        <button
          className="settings-row settings-row-logout"
          onClick={async () => {
            if (signingOut) return
            setSigningOut(true)
            await supabase.auth.signOut()
            navigate('/')
          }}
          disabled={signingOut}
          aria-busy={signingOut}
        >
          <span>{signingOut ? 'Signing out…' : 'Log out'}</span>
        </button>

        <button
          className="settings-delete-btn"
          onClick={() => setShowDeleteConfirm(true)}
        >
          Delete Account
        </button>
      </section>

      {/* ---- Delete confirmation modal ---- */}
      {showDeleteConfirm && (
        <div className="delete-overlay" role="dialog" aria-modal="true">
          <div className="delete-modal">
            <h3>Delete your account?</h3>
            <p>
              This removes your profile, photos, questionnaire answers,
              matches and messages. Your profile stops appearing to
              others immediately. This cannot be undone.
            </p>
            <p className="delete-modal-sub">
              Payment records and contact-unlock records may be retained
              after deletion for legal and dispute-resolution purposes, as
              described in our Privacy Policy.
            </p>
            <p className="delete-modal-sub">
              Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              className="delete-input"
              value={deleteText}
              onChange={e => setDeleteText(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
            {deleteError && <p className="delete-error">{deleteError}</p>}
            <div className="delete-actions">
              <button
                className="delete-cancel"
                onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); setDeleteError('') }}
              >
                Cancel
              </button>
              <button
                className="delete-confirm"
                onClick={confirmDelete}
                disabled={deleteText !== 'DELETE' || deleting}
              >
                {deleting ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
