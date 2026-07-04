import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function MatchProfile() {
  const { userId }  = useParams();
  const navigate    = useNavigate();

  const [profile,     setProfile]     = useState(null);
  const [photos,      setPhotos]      = useState([]);
  const [matchRow,    setMatchRow]    = useState(null);
  const [isUnlocked,  setIsUnlocked]  = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [activePhoto, setActivePhoto] = useState(0);
  const [error,       setError]       = useState(null);

  useEffect(() => { load(); }, [userId]);

  async function load() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/'); return; }
      const uid = session.user.id;

      // Load profile
      const { data: profileData } = await supabase
        .from('users')
        .select('id, full_name, age, gender, campus_id, bio, interests, residence_type, reputation_score, phone, whatsapp_number, display_phone')
        .eq('id', userId)
        .single();

      if (!profileData) { setError("Profile not found."); setLoading(false); return; }
      setProfile(profileData);

      // Load photos
      const { data: photoData } = await supabase
        .from('photos')
        .select('photo_url, photo_type, display_order')
        .eq('user_id', userId)
        .order('display_order');
      setPhotos(photoData || []);

      // Find match row — try both directions
      const { data: matchA } = await supabase
        .from('matches')
        .select('id, compatibility_score, status')
        .eq('user_a_id', uid)
        .eq('user_b_id', userId)
        .maybeSingle();

      const { data: matchB } = await supabase
        .from('matches')
        .select('id, compatibility_score, status')
        .eq('user_a_id', userId)
        .eq('user_b_id', uid)
        .maybeSingle();

      const match = matchA || matchB;
      setMatchRow(match);

      // Check payment unlock
      if (match) {
        const { data: payment } = await supabase
          .from('payments')
          .select('id')
          .eq('user_id', uid)
          .eq('match_id', match.id)
          .eq('status', 'completed')
          .maybeSingle();
        setIsUnlocked(!!payment);
      }

      setLoading(false);
    } catch(e) {
      setError("Something went wrong: " + e.message);
      setLoading(false);
    }
  }

  const scoreColor = (s) => s >= 80 ? "#4ade80" : s >= 60 ? "#f5c842" : "#ff6b8a";

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>💫</div>
        <p style={{ color: "#8888aa", fontSize: "14px" }}>Loading profile…</p>
      </div>
    </div>
  );

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: "320px" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
        <h2 style={{ color: "#f0f0f8", fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>Profile not found</h2>
        <button onClick={() => navigate(-1)} style={{ width: "100%", padding: "14px", borderRadius: "12px", backgroundColor: "#7c6aff", border: "none", color: "#fff", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
          Go Back
        </button>
      </div>
    </div>
  );

  const firstName = profile?.full_name?.split(' ')[0] || 'Match';

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", fontFamily: "Inter, system-ui, sans-serif", maxWidth: "480px", margin: "0 auto", paddingBottom: "40px" }}>

      {/* ── Sticky Header ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, backgroundColor: "#0a0a0fee", backdropFilter: "blur(12px)", borderBottom: "1px solid #1a1a24", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: "#8888aa", fontSize: "18px", cursor: "pointer", padding: "4px" }}>←</button>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "#f0f0f8" }}>{firstName}'s Profile</span>
        {matchRow?.compatibility_score && (
          <span style={{ fontSize: "12px", fontWeight: 700, color: scoreColor(matchRow.compatibility_score), backgroundColor: scoreColor(matchRow.compatibility_score) + "22", padding: "4px 10px", borderRadius: "20px", border: `1px solid ${scoreColor(matchRow.compatibility_score)}44` }}>
            {matchRow.compatibility_score}% match
          </span>
        )}
        {!matchRow?.compatibility_score && <span style={{ width: "60px" }} />}
      </div>

      {/* ── Photos ── */}
      {photos.length > 0 ? (
        <div>
          <div style={{ position: "relative", height: "380px", overflow: "hidden", backgroundColor: "#111118" }}>
            <img
              src={photos[activePhoto]?.photo_url}
              alt="Profile"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {/* Counter */}
            <div style={{ position: "absolute", top: "12px", right: "12px", backgroundColor: "rgba(0,0,0,0.65)", color: "#fff", fontSize: "11px", fontWeight: 600, padding: "4px 10px", borderRadius: "20px" }}>
              {activePhoto + 1} / {photos.length}
            </div>
            {/* Tap zones */}
            <div style={{ position: "absolute", inset: 0, display: "flex" }}>
              <div style={{ flex: 1, cursor: activePhoto > 0 ? "pointer" : "default" }}
                onClick={() => setActivePhoto(p => Math.max(0, p - 1))} />
              <div style={{ flex: 1, cursor: activePhoto < photos.length - 1 ? "pointer" : "default" }}
                onClick={() => setActivePhoto(p => Math.min(photos.length - 1, p + 1))} />
            </div>
          </div>
          {/* Dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: "5px", padding: "10px 0", backgroundColor: "#0a0a0f" }}>
            {photos.map((_, i) => (
              <div key={i} onClick={() => setActivePhoto(i)} style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: i === activePhoto ? "#7c6aff" : "#333", cursor: "pointer", transition: "background 0.2s" }} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ height: "220px", backgroundColor: "#111118", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "72px" }}>👤</span>
        </div>
      )}

      {/* ── Info ── */}
      <div style={{ padding: "20px" }}>

        {/* Name + meta */}
        <div style={{ marginBottom: "16px" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: 700, color: "#f0f0f8" }}>
            {profile?.full_name}{profile?.age ? `, ${profile.age}` : ""}
          </h2>
          <p style={{ margin: 0, fontSize: "13px", color: "#8888aa", lineHeight: 1.6 }}>
            {profile?.gender && <span style={{ textTransform: "capitalize" }}>{profile.gender}</span>}
            {profile?.campus_id && <span> · 📍 {profile.campus_id}</span>}
            {profile?.residence_type && <span> · 🏠 {profile.residence_type.replace(/_/g, ' ')}</span>}
          </p>
        </div>

        {/* Bio */}
        {profile?.bio && (
          <div style={{ marginBottom: "20px", padding: "14px 16px", backgroundColor: "#111118", borderRadius: "12px", border: "1px solid #2a2a3a" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "#c0c0d0", lineHeight: 1.6 }}>{profile.bio}</p>
          </div>
        )}

        {/* Interests */}
        {profile?.interests?.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#8888aa", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>Interests</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {profile.interests.map((tag, i) => (
                <span key={i} style={{ padding: "5px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: 500, backgroundColor: "#7c6aff22", color: "#7c6aff", border: "1px solid #7c6aff33" }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Contact — Unlocked ── */}
        {isUnlocked && (
          <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "#4ade8011", borderRadius: "12px", border: "1px solid #4ade8033" }}>
            <p style={{ margin: "0 0 14px", fontSize: "11px", color: "#4ade80", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>✓ Contact Details</p>
            {profile?.phone && (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                <span style={{ fontSize: "20px" }}>📞</span>
                <a href={`tel:${profile.phone}`} style={{ color: "#f0f0f8", fontSize: "15px", fontWeight: 600, textDecoration: "none" }}>{profile.phone}</a>
              </div>
            )}
            {profile?.whatsapp_number && (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                <span style={{ fontSize: "20px" }}>💬</span>
                <a href={`https://wa.me/${profile.whatsapp_number}`} target="_blank" rel="noreferrer" style={{ color: "#4ade80", fontSize: "15px", fontWeight: 600, textDecoration: "none" }}>
                  Chat on WhatsApp
                </a>
              </div>
            )}
            {profile?.display_phone && (
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "20px" }}>📱</span>
                <span style={{ color: "#f0f0f8", fontSize: "15px" }}>{profile.display_phone}</span>
              </div>
            )}
            {!profile?.phone && !profile?.whatsapp_number && !profile?.display_phone && (
              <p style={{ margin: 0, fontSize: "13px", color: "#8888aa" }}>{firstName} hasn't added contact details yet.</p>
            )}
          </div>
        )}

        {/* ── Contact — Locked ── */}
        {!isUnlocked && matchRow && (
          <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "#111118", borderRadius: "12px", border: "1px solid #2a2a3a" }}>
            <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#8888aa", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>🔒 Contact Details</p>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#666", lineHeight: 1.5 }}>
              Unlock to see {firstName}'s phone number and WhatsApp.
            </p>
            <button
              onClick={() => navigate(`/payment?matchId=${matchRow.id}&recipientId=${userId}`)}
              style={{ width: "100%", padding: "13px", borderRadius: "10px", backgroundColor: "#7c6aff", border: "none", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
            >
              🔓 Unlock {firstName}'s Contact Details
            </button>
          </div>
        )}

        {/* ── Action Buttons ── */}
        {matchRow && (
          <button
            onClick={() => navigate(`/section2-comparison/${userId}`)}
            style={{ width: "100%", padding: "13px", borderRadius: "10px", backgroundColor: "transparent", border: "1px solid #2a2a3a", color: "#7c6aff", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
          >
            💬 View Our Chemistry
          </button>
        )}

      </div>
    </div>
  );
}