import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Admin.css'

export default function Admin() {
  const navigate = useNavigate()
  const [isAdmin, setIsAdmin] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [campuses, setCampuses] = useState([])
  const [stats, setStats] = useState({})
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [newCampus, setNewCampus] = useState({ name: '', email_domain: '' })
  const [triggering, setTriggering] = useState(null)
  const [activeTab, setActiveTab] = useState('campuses')

  // Verify admin role server-side on mount. No client password:
  // membership lives in admin_users and is checked by RPCs.
  useEffect(() => {
    async function checkAdmin() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const { data, error: rpcError } = await supabase.rpc('am_i_admin')
      if (rpcError) {
        setError('Admin check failed: ' + rpcError.message)
      } else if (data === true) {
        setIsAdmin(true)
        loadData()
      }
      setChecking(false)
    }
    checkAdmin()
  }, [navigate])

  async function loadData() {
    setLoading(true)

    // One server-side call; the function re-verifies admin and
    // returns campuses, stats, and transactions as JSON.
    const { data, error: rpcError } = await supabase.rpc('admin_overview')

    if (rpcError) {
      setError(rpcError.message)
    } else if (data) {
      setCampuses(data.campuses || [])
      setTransactions(data.transactions || [])
      setStats(data.stats || {})
    }

    setLoading(false)
  }

  async function handleAddCampus() {
    if (!newCampus.name || !newCampus.email_domain) return
    const { error: rpcError } = await supabase.rpc('admin_add_campus', {
      p_name: newCampus.name,
      p_email_domain: newCampus.email_domain
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setNewCampus({ name: '', email_domain: '' })
    loadData()
  }

  async function toggleMatching(campusId, current) {
    await supabase.rpc('admin_set_campus_matching', { p_campus_id: campusId, p_value: !current })
    loadData()
  }

  async function toggleActive(campusId, current) {
    await supabase.rpc('admin_set_campus_active', { p_campus_id: campusId, p_value: !current })
    loadData()
  }

  async function triggerMatching(campusId) {
    setTriggering(campusId)
    try {
      // Invoke via the SDK so the user's own JWT is attached;
      // the function must verify the caller is an admin.
      const { data, error: fnError } = await supabase.functions.invoke('run-weekly-matching', {
        body: { campus_id: campusId }
      })
      if (fnError) throw fnError
      alert(`Matching complete! ${data?.totalMatches || 0} matches created for week ${data?.weekId || ''}`)
    } catch (err) {
      alert('Matching failed: ' + err.message)
    }
    setTriggering(null)
  }

  if (checking) {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <p>Checking access…</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <h2>Admin Panel</h2>
          <p>MingleMate Administration</p>
          <p className="admin-error">
            {error || 'Your account does not have admin access. Log in with an admin account.'}
          </p>
          <button className="admin-btn" onClick={() => navigate('/login')}>
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>MingleMate Admin</h1>
        <button className="admin-back" onClick={() => navigate('/home')}>← App</button>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'campuses' ? 'active' : ''}`} onClick={() => setActiveTab('campuses')}>Campuses</button>
        <button className={`admin-tab ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => setActiveTab('stats')}>Stats</button>
        <button className={`admin-tab ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>Payments</button>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {loading && <p className="admin-loading">Loading...</p>}

      {activeTab === 'campuses' && (
        <div className="admin-section">
          <h2>Add New Campus</h2>
          <div className="admin-add-campus">
            <input
              className="admin-input"
              placeholder="Campus name"
              value={newCampus.name}
              onChange={e => setNewCampus({ ...newCampus, name: e.target.value })}
            />
            <input
              className="admin-input"
              placeholder="Email domain e.g. ku.ac.ke"
              value={newCampus.email_domain}
              onChange={e => setNewCampus({ ...newCampus, email_domain: e.target.value })}
            />
            <button className="admin-btn" onClick={handleAddCampus}>Add Campus</button>
          </div>

          <h2>All Campuses</h2>
          {campuses.map(campus => (
            <div key={campus.id} className="campus-card">
              <div className="campus-info">
                <h3>{campus.name}</h3>
                <p>{campus.email_domain}</p>
              </div>
              <div className="campus-controls">
                <div className="toggle-row">
                  <span>Active</span>
                  <button
                    className={`toggle-btn ${campus.is_active ? 'on' : 'off'}`}
                    onClick={() => toggleActive(campus.id, campus.is_active)}
                  >
                    {campus.is_active ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="toggle-row">
                  <span>Matching</span>
                  <button
                    className={`toggle-btn ${campus.matching_enabled ? 'on' : 'off'}`}
                    onClick={() => toggleMatching(campus.id, campus.matching_enabled)}
                  >
                    {campus.matching_enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                <button
                  className="trigger-btn"
                  onClick={() => triggerMatching(campus.id)}
                  disabled={triggering === campus.id}
                >
                  {triggering === campus.id ? 'Running...' : '⚡ Trigger Matching'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="admin-section">
          <h2>Platform Stats</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <h3>{stats.totalUsers ?? 0}</h3>
              <p>Total Users</p>
            </div>
            <div className="stat-card">
              <h3>{stats.activeUsers ?? 0}</h3>
              <p>Active Users</p>
            </div>
            <div className="stat-card">
              <h3>{stats.section1Complete ?? 0}</h3>
              <p>Section 1 Done</p>
            </div>
            <div className="stat-card">
              <h3>{stats.section2Unlocked ?? 0}</h3>
              <p>Section 2 Unlocked</p>
            </div>
            <div className="stat-card">
              <h3>{stats.totalMessages ?? 0}</h3>
              <p>Messages Sent</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="admin-section">
          <h2>Payment Transactions</h2>
          {transactions.length === 0 && <p className="admin-empty">No transactions yet</p>}
          {transactions.map(txn => (
            <div key={txn.id} className="txn-card">
              <p className="txn-id">{txn.mpesa_transaction_id || 'Pending'}</p>
              <p className="txn-amount">KES {txn.amount}</p>
              <p className="txn-date">{new Date(txn.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
