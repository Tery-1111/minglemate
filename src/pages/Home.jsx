import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Home.css'

export default function Home() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [activeTab, setActiveTab] = useState('matches')

  useEffect(() => {
    getUser()
  }, [])

  async function getUser() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      navigate('/')
      return
    }
    const { data } = await supabase
      .from('users')
      .select('full_name, profile_status, section1_complete')
      .eq('id', session.user.id)
      .single()
    setUser(data)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="home-container">

      <div className="home-header">
        <h1 className="home-logo">MingleMate</h1>
        <button className="signout-btn" onClick={handleSignOut}>Sign Out</button>
      </div>

      <div className="home-content">
        {activeTab === 'matches' && (
          <div className="tab-content">
            <div className="matches-placeholder">
              <div className="matches-icon">💝</div>
              <h2>Your matches drop</h2>
              <p>Every Tuesday at 9 PM</p>
              <div className="matches-badge">
                Welcome{user?.full_name ? `, ${user.full_name}` : ''}!
              </div>
              {!user?.section1_complete && (
                <button
                  className="start-section1-btn"
                  onClick={() => navigate('/section1')}
                >
                  Start Your Questions →
                </button>
              )}
              {user?.section1_complete && (
                <div className="section1-done">
                  ✅ Questions complete — you are in the match pool!
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'conversations' && (
          <div className="tab-content">
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <h2>No conversations yet</h2>
              <p>Start chatting with your matches</p>
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="tab-content">
            <div className="profile-view">
              <div className="empty-icon">👤</div>
              <h2>{user?.full_name || 'Your Profile'}</h2>
              <button
                className="start-section1-btn"
                onClick={() => navigate('/section2')}
                style={{ marginTop: '16px' }}
              >
                Open Section 2 Questions
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bottom-nav">
        <button
          className={`nav-btn ${activeTab === 'matches' ? 'active' : ''}`}
          onClick={() => setActiveTab('matches')}
        >
          <span className="nav-icon">💝</span>
          <span className="nav-label">Matches</span>
        </button>
        <button
          className={`nav-btn ${activeTab === 'conversations' ? 'active' : ''}`}
          onClick={() => setActiveTab('conversations')}
        >
          <span className="nav-icon">💬</span>
          <span className="nav-label">Chats</span>
        </button>
        <button
          className={`nav-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <span className="nav-icon">👤</span>
          <span className="nav-label">Profile</span>
        </button>
      </div>

    </div>
  )
}