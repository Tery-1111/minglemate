import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { section1Questions } from '../data/section1Questions'
import './Admin.css'

const PAGE_SIZE = 25
const BASE_CATEGORIES = ['profile', 'status', 'photos', 'matches']

// Render a Section 1 answer: answer text as stored (current
// system), or the option text for legacy numeric positions.
function answerText(row) {
  if (row == null) return '—'
  const val = row.responses_array
  if (typeof val === 'number') {
    const opts = section1Questions[row.question_number - 1]?.options
    return (opts && opts[val]) || `#${val}`
  }
  return val || '—'
}

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
  const [actionErr, setActionErr] = useState({})
  const [triggering, setTriggering] = useState(null)
  const [matchResult, setMatchResult] = useState({})
  const [activeTab, setActiveTab] = useState('campuses')

  // Users tab
  const [userQ, setUserQ] = useState('')
  const [userFilters, setUserFilters] = useState({ q: '', status: 'all', sort: 'created', asc: false, page: 0 })
  const [userList, setUserList] = useState({ total: 0, users: [] })
  const [usersLoading, setUsersLoading] = useState(false)

  // User detail
  const [detailUserId, setDetailUserId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState('')
  const [wantSensitive, setWantSensitive] = useState({ questionnaire: false, contacts: false })
  const [detailReason, setDetailReason] = useState('')

  // Matches tab
  const [matchFilter, setMatchFilter] = useState('all')
  const [matchPage, setMatchPage] = useState(0)
  const [matchList, setMatchList] = useState({ total: 0, matches: [] })

  // Reports tab (admin_reports_list — same is_admin() RPC enforcement
  // as every other admin query; no new admin logic).
  const [reports, setReports] = useState([])
  const [reportsLoading, setReportsLoading] = useState(false)

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
        loadUsers(userFilters)
      }
      setChecking(false)
    }
    checkAdmin()
  }, [navigate])

  // Debounced directory search
  useEffect(() => {
    const t = setTimeout(() => {
      const next = { ...userFilters, q: userQ, page: 0 }
      setUserFilters(next)
      loadUsers(next)
    }, 350)
    return () => clearTimeout(t)
  }, [userQ])

  async function loadData() {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('admin_overview')
    if (rpcError) {
      setError(rpcError.message)
    } else if (data) {
      setCampuses(data.campuses || [])
      setTransactions([
        ...(data.transactions || []),
        ...(data.legacy_transactions || []).map(t => ({ ...t, legacy: true }))
      ])
      setStats(data.stats || {})
    }
    setLoading(false)
  }

  async function refreshAll() {
    await loadData()
    if (activeTab === 'users') await loadUsers(userFilters)
    if (activeTab === 'matches') await loadMatches(matchFilter, matchPage)
    if (activeTab === 'reports') await loadReports()
  }

  async function loadReports() {
    setReportsLoading(true)
    const { data, error: rpcError } = await supabase.rpc('admin_reports_list', {
      p_limit: 100,
      p_offset: 0
    })
    if (rpcError) setError(rpcError.message || 'Could not load reports.')
    setReports(data || [])
    setReportsLoading(false)
  }

  async function loadUsers(f) {
    setUsersLoading(true)
    const { data, error: rpcError } = await supabase.rpc('admin_users_list', {
      p_q: f.q || null,
      p_status: f.status,
      p_sort: f.sort,
      p_asc: f.asc,
      p_page: f.page
    })
    if (rpcError) setError(rpcError.message)
    else if (data) setUserList({ total: data.total || 0, users: data.users || [] })
    setUsersLoading(false)
  }

  function setUsersFilter(patch) {
    const next = { ...userFilters, ...patch, page: patch.page ?? 0 }
    setUserFilters(next)
    loadUsers(next)
  }

  async function loadMatches(filter, page) {
    const { data, error: rpcError } = await supabase.rpc('admin_matches_list', {
      p_filter: filter, p_page: page
    })
    if (rpcError) setError(rpcError.message)
    else if (data) setMatchList({ total: data.total || 0, matches: data.matches || [] })
  }

  function changeMatchFilter(filter) {
    setMatchFilter(filter)
    setMatchPage(0)
    loadMatches(filter, 0)
  }

  function changeMatchPage(page) {
    setMatchPage(page)
    loadMatches(matchFilter, page)
  }

  // ---- User detail (sensitive categories are audit-logged) ----
  async function openDetail(u) {
    setDetailUserId(u.id)
    setDetail(null)
    setDetailErr('')
    setWantSensitive({ questionnaire: false, contacts: false })
    setDetailReason('')
    await fetchDetail(BASE_CATEGORIES, null)
  }

  async function fetchDetail(categories, reason) {
    setDetailLoading(true)
    setDetailErr('')
    const { data, error: rpcError } = await supabase.rpc('admin_user_detail', {
      p_user_id: detailUserId,
      p_categories: categories,
      p_reason: reason
    })
    if (rpcError) setDetailErr(rpcError.message)
    else if (data) setDetail(data)
    setDetailLoading(false)
  }

  async function applySensitiveAccess() {
    const sensitive = []
    if (wantSensitive.questionnaire) sensitive.push('questionnaire')
    if (wantSensitive.contacts) sensitive.push('contacts')
    if (sensitive.length === 0) {
      await fetchDetail(BASE_CATEGORIES, null)
      return
    }
    if (!detailReason.trim() || detailReason.trim().length < 4) {
      setDetailErr('Enter a reason (min 4 characters) — access to contacts and questionnaire answers is logged.')
      return
    }
    const ok = window.confirm(
      'Your admin ID, the target user and your reason will be recorded in the audit log. Continue?'
    )
    if (!ok) return
    await fetchDetail([...BASE_CATEGORIES, ...sensitive], detailReason.trim())
  }

  // ---- Campus actions: every failure is surfaced ----
  async function handleAddCampus() {
    if (!newCampus.name || !newCampus.email_domain) return
    const { error: rpcError } = await supabase.rpc('admin_add_campus', {
      p_name: newCampus.name,
      p_email_domain: newCampus.email_domain
    })
    if (rpcError) {
      setActionErr(e => ({ ...e, addCampus: 'Add campus failed: ' + rpcError.message }))
      return
    }
    setActionErr(e => ({ ...e, addCampus: '' }))
    setNewCampus({ name: '', email_domain: '' })
    loadData()
  }

  async function toggleCampus(rpcName, campusId, current, label) {
    setActionErr(e => ({ ...e, [campusId]: '' }))
    const { error: rpcError } = await supabase.rpc(rpcName, {
      p_campus_id: campusId, p_value: !current
    })
    if (rpcError) {
      setActionErr(e => ({ ...e, [campusId]: `Failed to set ${label}: ` + rpcError.message }))
      return
    }
    loadData()
  }

  // Current engine: match-generator (user_responses, 50 questions,
  // compatibilityEngine). Runs ALL campuses; per-campus flags are
  // applied by the weekly cron scheduling, not by this call.
  async function triggerMatching() {
    setTriggering(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('match-generator', {})
      if (fnError) throw fnError
      setMatchResult(m => ({ ...m, global: `Done: ${data?.matchesProcessed ?? 0} compatibility pairs, ${data?.usersDelivered ?? 0} users delivered this week.` }))
    } catch (err) {
      setMatchResult(m => ({ ...m, global: 'Matching failed: ' + (err?.message || 'unknown error') }))
    }
    setTriggering(false)
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

  const totalPages = Math.max(1, Math.ceil((matchList.total || 0) / PAGE_SIZE))
  const userPages = Math.max(1, Math.ceil((userList.total || 0) / PAGE_SIZE))

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>MingleMate Admin</h1>
        <div>
          <button className="admin-back" onClick={refreshAll} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button className="admin-back" onClick={() => navigate('/home')}>← App</button>
        </div>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'campuses' ? 'active' : ''}`} onClick={() => setActiveTab('campuses')}>Campuses</button>
        <button className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>Users</button>
        <button className={`admin-tab ${activeTab === 'matches' ? 'active' : ''}`} onClick={() => setActiveTab('matches')}>Matches</button>
        <button className={`admin-tab ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => setActiveTab('stats')}>Stats</button>
        <button className={`admin-tab ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>Payments</button>
        <button className={`admin-tab ${activeTab === 'reports' ? 'active' : ''}`} onClick={async () => { setActiveTab('reports'); await loadReports() }}>Reports</button>
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
          {actionErr.addCampus && <p className="admin-error">{actionErr.addCampus}</p>}

          <h2>All Campuses</h2>
          {campuses.length === 0 && <p className="admin-empty">No campuses yet.</p>}
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
                    onClick={() => toggleCampus('admin_set_campus_active', campus.id, campus.is_active, 'active flag')}
                  >
                    {campus.is_active ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="toggle-row">
                  <span>Matching</span>
                  <button
                    className={`toggle-btn ${campus.matching_enabled ? 'on' : 'off'}`}
                    onClick={() => toggleCampus('admin_set_campus_matching', campus.id, campus.matching_enabled, 'matching flag')}
                  >
                    {campus.matching_enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
              {actionErr[campus.id] && <p className="admin-error">{actionErr[campus.id]}</p>}
            </div>
          ))}

          <h2>Run Matching</h2>
          <p className="admin-hint">
            Runs the current matching engine (50-question compatibility) and delivers each user's
            weekly Tier 1 / Tier 2 matches. Covers all campuses.
          </p>
          <button className="admin-btn" onClick={triggerMatching} disabled={triggering}>
            {triggering ? 'Running…' : 'Run Matching Now'}
          </button>
          {matchResult.global && <p className="admin-hint">{matchResult.global}</p>}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="admin-section">
          <h2>Users ({userList.total ?? 0})</h2>
          <div className="admin-add-campus">
            <input
              className="admin-input"
              placeholder="Search name or email…"
              value={userQ}
              onChange={e => setUserQ(e.target.value)}
            />
            <select
              className="admin-input"
              value={userFilters.status}
              onChange={e => setUsersFilter({ status: e.target.value })}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="pending_deletion">Pending deletion</option>
            </select>
            <select
              className="admin-input"
              value={userFilters.sort + (userFilters.asc ? '_asc' : '')}
              onChange={e => {
                const [sort, dir] = e.target.value.split('_')
                setUsersFilter({ sort, asc: dir === 'asc' })
              }}
            >
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
              <option value="name_asc">Name A→Z</option>
              <option value="name_desc">Name Z→A</option>
            </select>
          </div>
          {usersLoading && <p className="admin-loading">Loading users…</p>}
          {userList.users.length === 0 && !usersLoading && <p className="admin-empty">No users match.</p>}
          {userList.users.map(u => (
            <div key={u.id} className="txn-card admin-user-row">
              <div>
                <p className="txn-id">{u.full_name || '(no name)'} <span className="admin-dim">· {u.email}</span></p>
                <p className="admin-dim">
                  {u.age ? `${u.age} · ` : ''}{u.campus_name || 'No campus'} · joined {new Date(u.created_at).toLocaleDateString()}
                  {u.section1_complete ? ' · Section 1 ✓' : ''}
                  {u.section2_unlocked ? ' · Section 2 ✓' : ''}
                </p>
              </div>
              <span className={`admin-chip ${u.profile_status === 'active' ? 'chip-ok' : 'chip-warn'}`}>{u.profile_status}</span>
              <button className="admin-btn" onClick={() => openDetail(u)}>Open</button>
            </div>
          ))}
          <div className="admin-pager">
            <button className="admin-btn" disabled={userFilters.page === 0} onClick={() => setUsersFilter({ page: userFilters.page - 1 })}>← Prev</button>
            <span className="admin-dim">Page {userFilters.page + 1} / {userPages}</span>
            <button className="admin-btn" disabled={userFilters.page + 1 >= userPages} onClick={() => setUsersFilter({ page: userFilters.page + 1 })}>Next →</button>
          </div>

          {detailUserId && (
            <div className="campus-card admin-detail">
              <h2>User Detail</h2>
              {detailErr && <p className="admin-error">{detailErr}</p>}
              {detailLoading && <p className="admin-loading">Loading detail…</p>}
              {detail && (
                <>
                  {detail.profile ? (
                    <div className="admin-detail-grid">
                      <p><strong>{detail.profile.full_name}</strong> · {detail.profile.age ?? '—'} · {detail.profile.gender ?? '—'}</p>
                      <p>{detail.profile.email}</p>
                      <p>Campus: {detail.profile.campus_name || 'Unaffiliated'}</p>
                      <p>Joined: {new Date(detail.profile.created_at).toLocaleDateString()}</p>
                      <p className="admin-bio">{detail.profile.bio || 'No bio'}</p>
                    </div>
                  ) : <p className="admin-error">User record not found.</p>}

                  {detail.photos?.length > 0 && (
                    <div className="admin-photos">
                      {detail.photos.map(p => (
                        <figure key={p.slot}>
                          <img src={p.photo_url} alt={p.slot} />
                          <figcaption>{p.photo_type === 'facial' ? 'Facial photo' : 'Full-body photo'}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}

                  {detail.status && (
                    <div className="admin-detail-grid">
                      <p>Status: {detail.status.profile_status} · account {detail.status.is_active === false ? 'deactivated' : 'active'}</p>
                      <p>Section 1: {detail.status.section1_complete ? 'complete' : 'incomplete'} · Section 2: {detail.status.section2_unlocked ? 'unlocked' : 'locked'}</p>
                      <p>Contact sharing — phone: {detail.status.share_phone ? 'on' : 'off'} · whatsapp: {detail.status.share_whatsapp ? 'on' : 'off'} · social: {detail.status.share_social ? 'on' : 'off'}</p>
                      {Array.isArray(detail.status.interests) && detail.status.interests.length > 0 && (
                        <p>Interests: {detail.status.interests.join(', ')}</p>
                      )}
                    </div>
                  )}

                  {detail.matches?.length > 0 && (
                    <>
                      <h3>Matches ({detail.matches.length})</h3>
                      {detail.matches.map(m => (
                        <p key={m.id} className="admin-dim">
                          {m.tier} · score {m.compatibility_score} · with {m.partner_name || m.partner_id} · {new Date(m.created_at).toLocaleDateString()}
                        </p>
                      ))}
                    </>
                  )}

                  <h3>Sensitive data</h3>
                  <p className="admin-hint">Accessing contacts or questionnaire answers is audit-logged with your reason.</p>
                  <label className="admin-check">
                    <input type="checkbox" checked={wantSensitive.questionnaire} onChange={e => setWantSensitive(w => ({ ...w, questionnaire: e.target.checked }))} />
                    Questionnaire answers
                  </label>
                  <label className="admin-check">
                    <input type="checkbox" checked={wantSensitive.contacts} onChange={e => setWantSensitive(w => ({ ...w, contacts: e.target.checked }))} />
                    Contact details (phone / WhatsApp / social)
                  </label>
                  <input
                    className="admin-input"
                    placeholder="Reason for access (required)"
                    value={detailReason}
                    onChange={e => setDetailReason(e.target.value)}
                  />
                  <button className="admin-btn" onClick={applySensitiveAccess}>Apply access</button>

                  {detail.questionnaire && (
                    <>
                      <h3>Section 1 answers ({detail.questionnaire.length})</h3>
                      {detail.questionnaire.map(row => (
                        <p key={row.question_number} className="admin-dim">
                          Q{row.question_number}: {section1Questions[row.question_number - 1]?.text || 'Question ' + row.question_number} → <strong>{answerText(row)}</strong>
                        </p>
                      ))}
                    </>
                  )}

                  {detail.contacts && (
                    <>
                      <h3>Contact details</h3>
                      <p className="admin-dim">Phone: {detail.contacts.phone || '—'}</p>
                      <p className="admin-dim">WhatsApp: {detail.contacts.whatsapp_number || '—'}</p>
                      <p className="admin-dim">Social: {detail.contacts.social_handles || '—'}</p>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'matches' && (
        <div className="admin-section">
          <h2>Match Records ({matchList.total ?? 0})</h2>
          <div className="admin-tabs admin-subtabs">
            {['all', 'tier1', 'tier2', 'qrashe'].map(f => (
              <button key={f} className={`admin-tab ${matchFilter === f ? 'active' : ''}`} onClick={() => changeMatchFilter(f)}>
                {f === 'all' ? 'All' : f === 'tier1' ? 'Tier 1' : f === 'tier2' ? 'Tier 2' : 'Qrashe'}
              </button>
            ))}
          </div>
          {matchList.matches.length === 0 && <p className="admin-empty">No matches recorded.</p>}
          {matchList.matches.map(m => (
            <div key={m.id} className="txn-card">
              <p className="txn-id">
                {m.user_a_name || m.user_a_id} ↔ {m.user_b_name || m.user_b_id}
              </p>
              <p className="admin-dim">
                {m.tier === 'qrashe' ? 'Qrashe' : m.tier === 'tier1' ? 'Tier 1' : m.tier === 'tier2' ? 'Tier 2' : m.tier}
                {' '}· score {m.compatibility_score} · {new Date(m.created_at).toLocaleString()}
                {m.has_conversation ? ' · conversation exists' : ''}
              </p>
            </div>
          ))}
          <div className="admin-pager">
            <button className="admin-btn" disabled={matchPage === 0} onClick={() => changeMatchPage(matchPage - 1)}>← Prev</button>
            <span className="admin-dim">Page {matchPage + 1} / {totalPages}</span>
            <button className="admin-btn" disabled={matchPage + 1 >= totalPages} onClick={() => changeMatchPage(matchPage + 1)}>Next →</button>
          </div>
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
              <h3>{stats.totalMatches ?? 0}</h3>
              <p>Matches Recorded</p>
            </div>
            <div className="stat-card">
              <h3>{stats.totalMessages ?? 0}</h3>
              <p>Messages Sent</p>
            </div>
            <div className="stat-card">
              <h3>{stats.pendingPayments ?? 0}</h3>
              <p>Pending Payments</p>
            </div>
            <div className="stat-card">
              <h3>{stats.openReports ?? 0}</h3>
              <p>Reports Filed</p>
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
              <p className="txn-id">
                {txn.mpesa_transaction_id || 'Pending'}
                {txn.legacy && <span className="admin-chip chip-warn">legacy</span>}
              </p>
              <p className="admin-dim">
                {txn.user_name || txn.user_id} · {txn.purpose}
              </p>
              <p className="txn-amount">KES {txn.amount} · <span className={`admin-chip ${txn.status === 'completed' || txn.status === 'success' ? 'chip-ok' : 'chip-warn'}`}>{txn.status}</span></p>
              <p className="txn-date">{new Date(txn.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="admin-section">
          <h2>User Reports</h2>
          {reportsLoading && <p className="admin-loading">Loading reports…</p>}
          {!reportsLoading && reports.length === 0 && <p className="admin-empty">No reports filed</p>}
          {!reportsLoading && reports.map(r => (
            <div key={r.id} className="txn-card">
              <p className="txn-id">Report · {new Date(r.created_at).toLocaleString()}</p>
              <p className="admin-dim">
                {r.reporter_name || r.reporter_id} reported {r.reported_name || r.reported_id}
                {r.reporter_status && (
                  <span className={`admin-chip ${r.reporter_status === 'active' ? 'chip-ok' : 'chip-warn'}`} style={{ marginLeft: 8 }}>
                    {r.reporter_status}
                  </span>
                )}
              </p>
              <p className="admin-bio">{r.reason || '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
