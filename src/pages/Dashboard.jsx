import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || '',
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''
);

export default function Dashboard() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState({ tier_1: null, tier_2: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWeeklyMatches() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }

      // Fetch the two assigned matches for the current week
      const { data, error } = await supabase
        .from('weekly_matches')
        .select(`tier, profile:users!match_id(full_name, bio, user_photos(photo_url))`)
        .eq('user_id', user.id)
        .eq('week_start', new Date().toISOString().split('T')[0]); // simplified weekly check

      if (data) {
        const t1 = data.find(m => m.tier === 'tier_1')?.profile;
        const t2 = data.find(m => m.tier === 'tier_2')?.profile;
        setMatches({ tier_1: t1, tier_2: t2 });
      }
      setLoading(false);
    }
    fetchWeeklyMatches();
  }, [navigate]);

  if (loading) return <div style={styles.centerContainer}>⏳ Calculating your weekly matches...</div>;

  return (
    <div style={styles.container}>
      <nav style={styles.navbar}>
        <span style={styles.logo}>MingleMate ✨</span>
      </nav>

      <div style={styles.content}>
        <h2 style={styles.title}>Your Weekly Connections</h2>
        <div style={styles.matchGrid}>
          {['tier_1', 'tier_2'].map((tier) => (
            <div key={tier} style={styles.matchCard}>
              <div style={styles.tierBadge}>{tier === 'tier_1' ? '💎 Tier 1' : '✨ Tier 2'}</div>
              {matches[tier] ? (
                <>
                  <img src={matches[tier].user_photos[0].photo_url} style={styles.avatar} />
                  <h3>{matches[tier].full_name}</h3>
                  <p style={styles.bio}>{matches[tier].bio}</p>
                  <button style={styles.chatBtn}>Start Conversation</button>
                </>
              ) : (
                <p>Waiting for your algorithmic match...</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', background: '#0a0a0a', color: '#ffffff', padding: '20px' },
  navbar: { padding: '20px 0', borderBottom: '1px solid #262626' },
  logo: { fontSize: '20px', fontWeight: '800', background: 'linear-gradient(45deg, #E8416B, #ff7e5f)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  content: { maxWidth: '800px', margin: '0 auto', textAlign: 'center' },
  title: { margin: '40px 0' },
  matchGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  matchCard: { background: '#141414', padding: '20px', borderRadius: '20px', border: '1px solid #262626' },
  tierBadge: { fontSize: '12px', fontWeight: 'bold', color: '#E8416B', marginBottom: '10px' },
  avatar: { width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover', marginBottom: '15px' },
  bio: { fontSize: '14px', color: '#888888', margin: '10px 0' },
  chatBtn: { background: '#E8416B', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' },
  centerContainer: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }
};