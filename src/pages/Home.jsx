import { saveOneSignalPlayerId } from '../supabaseClient'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Home.css'
import Matches from './Matches'

export default function Home() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [userId, setUserId] = useState(null)
  const [activeTab, setActiveTab] = useState('matches')
  const notificationsEnabledRef = useRef(true)

  useEffect(() => {
    getUser()
  }, [])

  // Real-time Notification Listener
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('notifications-channel')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Alert user of new match — respects the owner's notification
          // setting (users.notifications_enabled, owner-only toggle in
          // Settings).
          if (notificationsEnabledRef.current) {
            alert("New Match Alert: " + payload.new.message)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  async function getUser() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      navigate('/')
      return
    }
    
    setUserId(session.user.id)

    const { data } = await supabase
      .from('users')
      .select('full_name, profile_status, section1_complete, notifications_enabled')
      .eq('id', session.user.id)
      .single()
    
    setUser(data)
    notificationsEnabledRef.current = data?.notifications_enabled !== false
    saveOneSignalPlayerId(session.user.id)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="home-container">
      <div className="home-header">
        <h1 className="home-logo">MingleMate</h1>
        <div className="home-header-actions">
          <button className="settings-btn" onClick={() => navigate('/settings')} title="Settings">⚙︎</button>
          <button className="signout-btn" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>

      <div className="home-content">
        {activeTab === 'matches' && (
          <div className="tab-content-full">
            {!user?.section1_complete ? (
              <div className="matches-placeholder">
                <div className="matches-icon">💝</div>
                <h2>Your matches drop</h2>
                <p>Every Tuesday at 9 PM</p>
                <div className="matches-badge">
                  Welcome{user?.full_name ? `, ${user.full_name}` : ''}!
                </div>
                <button
                  className="start-section1-btn"
                  onClick={() => navigate('/section1')}
                >
                  Start Your Questions →
                </button>
              </div>
            ) : (
              <Matches />
            )}
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
                onClick={() => navigate('/profile')}
                style={{ marginTop: '16px' }}
              >
                View Full Profile →
              </button>
              <button
                className="start-section1-btn"
                onClick={() => navigate('/section2')}
                style={{ marginTop: '12px', background: '#4F2D7F' }}
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