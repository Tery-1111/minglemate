import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function Matches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId,  setUserId]  = useState(null);
  const navigate = useNavigate();

  useEffect(() => { fetchMatches(); }, []);

  async function fetchMatches() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate('/'); return; }
    const uid = session.user.id;
    setUserId(uid);

    const { data: matchRows, error } = await supabase
      .from('matches')
      .select('id, user_a_id, user_b_id, compatibility_score, status, is_visible, created_at, interested_at, discarded_at')
      .or(`user_a_id.eq.${uid},user_b_id.eq.${uid}`)
      .in('status', ['pending', 'interested', 'matched'])
      .order('created_at', { ascending: false });

    if (error) { console.error('Matches fetch error:', error); setLoading(false); return; }
    if (!matchRows || matchRows.length === 0) { setLoading(false); return; }

    const otherIds = matchRows.map(m => m.user_a_id === uid ? m.user_b_id : m.user_a_id);

    const [{ data: profiles }, { data: photos }, { data: paidMatches }] = await Promise.all([
      supabase.from('users').select('id, full_name, age, campus_id, bio').in('id', otherIds),
      supabase.from('photos').select('user_id, photo_url').in('user_id', otherIds),
      supabase.from('payments').select('match_id, status').in('match_id', matchRows.map(m => m.id)).eq('status', 'completed'),
    ]);

    const paidMatchIds = new Set((paidMatches || []).map(p => p.match_id));

    const merged = matchRows.map(m => {
      const otherId = m.user_a_id === uid ? m.user_b_id : m.user_a_id;
      const profile = profiles?.find(p => p.id === otherId) || {};
      const photo   = photos?.find(p => p.user_id === otherId);
      return {
        matchId:     m.id,
        userId:      otherId,
        full_name:   profile.full_name || 'Unknown',
        age:         profile.age,
        campus_id:   profile.campus_id,
        bio:         profile.bio,
        photo_url:   photo?.photo_url || null,
        score:       m.compatibility_score,
        status:      m.status,
        is_unlocked: paidMatchIds.has(m.id),
        is_visible:  m.is_visible,
        created_at:  m.created_at,
      };
    });

    setMatches(merged);
    setLoading(false);
  }

  async function handleInterest(match) {
    const { error } = await supabase
      .from('matches')
      .update({ interested_at: new Date().toISOString(), status: 'interested' })
      .eq('id', match.matchId);

    if (error) { console.error('Interest error:', error); alert('Something went wrong. Please try again.'); return; }

    await supabase.from('match_interactions').insert({
      match_id:   match.matchId,
      user_id:    userId,
      action:     'interested',
      created_at: new Date().toISOString(),
    }).throwOnError().catch(() => {});

    navigate(`/payment?matchId=${match.matchId}&recipientId=${match.userId}`);
  }

  async function handleDiscard(match) {
    await supabase
      .from('matches')
      .update({ discarded_at: new Date().toISOString(), status: 'discarded' })
      .eq('id', match.matchId);

    await supabase.from('match_interactions').insert({
      match_id:   match.matchId,
      user_id:    userId,
      action:     'discarded',
      created_at: new Date().toISOString(),
    }).throwOnError().catch(() => {});

    setMatches(prev => prev.filter(m => m.matchId !== match.matchId));
  }

  if (loading) return (
    <div style={{ padding: "40px", textAlign: "center", color: "#888", fontFamily: "Inter, system-ui, sans-serif" }}>
      Finding your matches…
    </div>
  );

  if (matches.length === 0) return (
    <div style={{ padding: "40px", textAlign: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ fontSize: "40px", marginBottom: "16px" }}>🔍</div>
      <p style={{ color: "#888", fontSize: "15px" }}>No matches yet. Check back soon.</p>
    </div>
  );

  return (
    <div style={{ padding: "16px", maxWidth: "480px", margin: "0 auto", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#f0f0f8", marginBottom: "20px" }}>
        Your Matches
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {matches.map(m => (
          <div key={m.matchId} style={{
            backgroundColor: "#111118",
            border: "1px solid #2a2a3a",
            borderRadius: "16px",
            overflow: "hidden",
          }}>

            {/* Photo */}
            {m.photo_url
              ? <div style={{ height: "220px", overflow: "hidden" }}>
                  <img src={m.photo_url} alt={m.full_name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              : <div style={{
                  height: "120px", backgroundColor: "#1a1a24",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: "48px" }}>👤</span>
                </div>
            }

            <div style={{ padding: "16px" }}>

              {/* Name + score */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#f0f0f8" }}>
                  {m.full_name}{m.age ? `, ${m.age}` : ""}
                </h3>
                {m.score && (
                  <span style={{
                    fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "20px",
                    backgroundColor: m.score >= 80 ? "#4ade8022" : m.score >= 60 ? "#f5c84222" : "#ff6b8a22",
                    color:           m.score >= 80 ? "#4ade80"   : m.score >= 60 ? "#f5c842"   : "#ff6b8a",
                  }}>
                    {m.score}% match
                  </span>
                )}
              </div>

              {/* Campus */}
              {m.campus_id && (
                <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#8888aa" }}>
                  📍 {m.campus_id}
                </p>
              )}

              {/* Bio */}
              {m.bio && (
                <p style={{
                  margin: "0 0 14px", fontSize: "13px", color: "#aaa", lineHeight: 1.5,
                  display: "-webkit-box", WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {m.bio}
                </p>
              )}

              {/* Unlocked badge */}
              {m.is_unlocked && (
                <div style={{ marginBottom: "12px" }}>
                  <span style={{
                    fontSize: "11px", fontWeight: 600, padding: "3px 10px",
                    borderRadius: "20px", backgroundColor: "#f5c84222", color: "#f5c842",
                  }}>
                    ✓ Contact Unlocked
                  </span>
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>

                {/* Reveal Contact */}
                {!m.is_unlocked && (
                  <button onClick={() => handleInterest(m)} style={{
                    width: "100%", padding: "13px", borderRadius: "10px",
                    backgroundColor: "#7c6aff", border: "none",
                    color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer",
                  }}>
                    Reveal Contact 🔓
                  </button>
                )}

                {/* View Chemistry */}
                <button onClick={() => navigate(`/section2-comparison/${m.userId}`)} style={{
                  width: "100%", padding: "13px", borderRadius: "10px",
                  backgroundColor: "transparent", border: "1px solid #2a2a3a",
                  color: "#7c6aff", fontSize: "14px", fontWeight: 600, cursor: "pointer",
                }}>
                  💬 View Our Chemistry
                </button>

                {/* Not Interested */}
                {!m.is_unlocked && (
                  <button onClick={() => handleDiscard(m)} style={{
                    background: "none", border: "none",
                    color: "#555", fontSize: "12px",
                    cursor: "pointer", padding: "4px", textAlign: "center",
                  }}>
                    Not Interested
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}