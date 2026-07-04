import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, saveOneSignalPlayerId } from '../supabaseClient';
import './Home.css';
import Matches from './Matches';

export default function Home() {
  const navigate = useNavigate();
  const [user,      setUser]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('matches');
  const [isAdmin,   setIsAdmin]   = useState(false);

  useEffect(() => {
    async function getUser() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { navigate('/'); return; }

        // Admin check via env variable — set VITE_ADMIN_UUID in .env
        if (session.user.id === import.meta.env.VITE_ADMIN_UUID) {
          setIsAdmin(true);
        }

        const { data, error } = await supabase
          .from('users')
          .select('full_name, section1_complete')
          .eq('id', session.user.id)
          .single();

        if (error) throw error;
        setUser(data);
        saveOneSignalPlayerId(session.user.id);
      } catch (err) {
        console.error('Error fetching user:', err);
      } finally {
        setLoading(false);
      }
    }
    getUser();
  }, [navigate]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/');
  }

  if (loading) return (
    <div style={{ padding: "40px", textAlign: "center", color: "#888", fontFamily: "Inter, system-ui, sans-serif" }}>
      Loading your dashboard…
    </div>
  );

  return (
    <div className="home-container">
      {/* Header */}
      <div className="home-header">
        <h1 className="home-logo">MingleMate</h1>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              style={{
                padding: "6px 14px", borderRadius: "8px", cursor: "pointer",
                backgroundColor: "#7c6aff22", border: "1px solid #7c6aff44",
                color: "#7c6aff", fontSize: "12px", fontWeight: 600,
              }}
            >
              Admin
            </button>
          )}
          <button className="signout-btn" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="home-content" style={{ paddingBottom: "120px" }}>
        {activeTab === 'matches' && (
          <div className="tab-content-full">
            {!user?.section1_complete ? (
              <div className="matches-placeholder">
                <div style={{ textAlign: "center", padding: "40px 24px" }}>
                  <div style={{ fontSize: "48px", marginBottom: "16px" }}>✨</div>
                  <h2 style={{ color: "#f0f0f8", marginBottom: "10px" }}>Welcome to MingleMate</h2>
                  <p style={{ color: "#8888aa", fontSize: "14px", lineHeight: 1.6, marginBottom: "24px" }}>
                    Complete your compatibility assessment to unlock your matches.
                  </p>
                  <button
                    onClick={() => navigate('/section1')}
                    style={{
                      padding: "14px 28px", borderRadius: "12px", border: "none",
                      backgroundColor: "#7c6aff", color: "#fff",
                      fontSize: "15px", fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Start Section 1 →
                  </button>
                </div>
              </div>
            ) : (
              <Matches />
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="tab-content">
            <div className="profile-view">
              <h2 style={{ color: "#f0f0f8" }}>{user?.full_name || 'Your Profile'}</h2>
              <button
                className="start-section1-btn"
                onClick={() => navigate('/profile')}
                style={{ marginTop: "16px" }}
              >
                View Full Profile →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div className="bottom-nav">
        <button
          className={`nav-btn ${activeTab === 'matches' ? 'active' : ''}`}
          onClick={() => setActiveTab('matches')}
        >
          <span className="nav-label">Matches</span>
        </button>
        <button
          className={`nav-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <span className="nav-label">Profile</span>
        </button>
      </div>
    </div>
  );
}