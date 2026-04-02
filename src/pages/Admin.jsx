import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Admin.css'

const ADMIN_PASSWORD = 'minglemate-admin-2025'

export default function Admin() {
  const navigate = useNavigate()
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [campuses, setCampuses] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const [newCampus, setNewCampus] = useState({ name: '', email_domain: '' })
  const [triggering, setTriggering] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [activeTab, setActiveTab] = useState('campuses')

  function handleLogin() {
    if (password === ADMIN_PASSWORD) {
      setAuthed(true)
      loadData()
    } else {
      setError('Incorrect password')
    }
  }

  async function loadData() {
    setLoading(true)

    const { data: campusData } = await supabase
      .from('campuses')
      .select('*')
      .order('created_at')
    setCampuses(campusData || [])

    const { data: userData } = await supabase
      .from('users')
      .select('id, profile_status, section1_complete, section2_unlocked, campus_id')
    
    const { data: msgData } = await supabase
      .from('messages')
      .select('id')

    const { data: txnData } = await supabase
      .from('token_purchases')
      .select('*')
      .order('created_at', { ascending: false })
    setTransactions(txnData || [])

    setStats({
      totalUsers: userData?.length || 0,
      activeUsers: userData?.filter(u => u.profile_status === 'active').length || 0,
      section1Complete: userData?.filter(u => u.section1_complete).length || 0,
      section2Unlocked: userData?.filter(u => u.section2_unlocked).length || 0,
      totalMessages: msgData?.length || 0,
    })

    setLoading(false)
  }

  async function handleAddCampus() {
    if (!newCampus.name || !newCampus.email_domain) return
    const { error } = await supabase
      .from('campuses')
      .insert({
        name: newCampus.name,
        email_domain: newCampus.email_domain
      })
    if (!error) {
      setNewCampus({ name: '', email_domain: '' })
      loadData()
    }
  }

  async function toggleMatching(campusId, current) {
    await supabase
      .from('campuses')
      .update({ matching_enabled: !current })
      .eq('id', campusId)
    loadData()
  }

  async function toggleActive(campusId, current) {
    await supabase
      .from('campuses')
      .update({ is_active: !current })
      .eq('id', campusId)
    loadData()
  }

  async function triggerMatching(campusId) {
    setTriggering(campusId)
    try {
      const response = await fetch(
        'https://mhdjnhiqahsllbczbzpk.supabase.co/functions/v1/run-weekly-matching',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oZGpuaGlxYWhzbGxiY3pienBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NjYzNjUsImV4cCI6MjA5MDA0MjM2NX0.3Oz9TBeTNq1owUD4zJXBXADx5-r4jIPlqcnQH3nqNto`,
            'Content-Type': 'application/json'
          }
        }
      )
      const data = await response.json()
      alert(`Matching complete! ${data.totalMatches || 0} matches created for week ${data.weekId}`)
    } catch (err) {
      alert('Matching failed: ' + err.message)
    }
    setTriggering(null)
  }

  if (!authed) {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <h2>Admin Panel</h2>
          <p>MingleMate Administration</p>
          <input
            className="admin-input"
            type="password"
            placeholder="Enter admin password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleLogin()}
          />
          {error && <p className="admin-error">{error}</p>}
          <button className="admin-btn" onClick={handleLogin}>
            Login
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
              <h3>{stats.totalUsers}</h3>
              <p>Total Users</p>
            </div>
            <div className="stat-card">
              <h3>{stats.activeUsers}</h3>
              <p>Active Users</p>
            </div>
            <div className="stat-card">
              <h3>{stats.section1Complete}</h3>
              <p>Section 1 Done</p>
            </div>
            <div className="stat-card">
              <h3>{stats.section2Unlocked}</h3>
              <p>Section 2 Unlocked</p>
            </div>
            <div className="stat-card">
              <h3>{stats.totalMessages}</h3>
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