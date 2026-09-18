import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Settings.css'

export default function Blocked() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/login'); return }

    const { data: blocks } = await supabase
      .from('user_blocks')
      .select('blocked_id, created_at, profile:users!user_blocks_blocked_id_fkey(full_name)')
      .eq('blocker_id', user.id)
      .order('created_at', { ascending: false })

    setBlocked(blocks || [])
    setLoading(false)
  }

  async function unblock(blockedId) {
    const { data: { user } } = await supabase.auth.getUser()
    const { error: unblockError } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', blockedId)

    if (unblockError) {
      setError(unblockError.message)
      return
    }
    setBlocked(prev => prev.filter(b => b.blocked_id !== blockedId))
  }

  if (loading) {
    return <div className="settings-loading">Loading…</div>
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate('/settings')}>←</button>
        <h2 className="settings-heading">Blocked accounts</h2>
        <span className="settings-header-spacer" />
      </div>

      <section className="settings-section">
        {error && <p className="profile-error-text">{error}</p>}

        {blocked.length === 0 ? (
          <p className="settings-empty">
            You haven't blocked anyone. When you block someone, they can't
            message you and you won't be matched with them again.
          </p>
        ) : (
          blocked.map(b => (
            <div key={b.blocked_id} className="settings-row settings-row-static">
              <span>
                {b.profile?.full_name || 'Unknown user'}
                <small className="settings-row-sub">
                  Blocked {new Date(b.created_at).toLocaleDateString()}
                </small>
              </span>
              <button className="chat-unblock-btn" onClick={() => unblock(b.blocked_id)}>
                Unblock
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
