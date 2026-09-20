import { useState, useEffect } from 'react'
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
    // Type-to-confirm: the word DELETE, exactly.
    if (deleteText !== 'DELETE' || deleting) return
    setDeleting(true)
    setDeleteError('')

    // RPC is SECURITY DEFINER: server derives who from auth.uid() —
    // a client can never pass someone else's id.
    const { error } = await supabase.rpc('request_account_deletion')

    if (error) {
      setDeleteError(error.message || 'Could not start deletion. Try again.')
      setDeleting(false)
      return
    }

    await supabase.auth.signOut()
    navigate('/')
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
          onClick={async () => { await supabase.auth.signOut(); navigate('/') }}
        >
          <span>Log out</span>
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
