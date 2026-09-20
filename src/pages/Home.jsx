import { saveOneSignalPlayerId } from '../supabaseClient'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import BottomNav from '../components/BottomNav'
import './Home.css'
import Matches from './Matches'

// MATCHES tab (primary nav). Shows the weekly Tier 1/2 cards (and
// plays the Match Celebration once per week) or the questionnaire
// CTA when Section 1 isn't complete yet.
export default function Home() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [userId, setUserId] = useState(null)
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

    // Match Celebration: once per week, after this week's matches exist.
    if (data?.section1_complete) {
      const weekId = getWeekId()
      const { data: row } = await supabase
        .from('match_history')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('week_id', weekId)
        .maybeSingle()
      if (row && sessionStorage.getItem('celebrated_week') !== weekId) {
        sessionStorage.setItem('celebrated_week', weekId)
        navigate('/celebration')
      }
    }
  }

  function getWeekId() {
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 1)
    const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7)
    return `${now.getFullYear()}-W${week}`
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
          {/* Settings lives under Profile (Profile → Settings). */}
          <button className="signout-btn" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>

      <div className="home-content">
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
      </div>

      <BottomNav />
    </div>
  )
}