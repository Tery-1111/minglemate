import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const QUESTIONS = [
  { id: 1,  category: "Playful Curiosity",    text: "What's something small that instantly makes you like someone more?" },
  { id: 2,  category: "Playful Curiosity",    text: "What's something small that instantly makes you like someone less?" },
  { id: 3,  category: "Playful Curiosity",    text: "What's something people usually assume about you that's completely wrong?" },
  { id: 4,  category: "Playful Curiosity",    text: "What's a word your friends would use to describe you that most people wouldn't guess?" },
  { id: 5,  category: "Identity",             text: "What's something you're lowkey proud of but never get to talk about?" },
  { id: 6,  category: "Identity",             text: "What's a moment from your past you think quietly shaped who you are today?" },
  { id: 7,  category: "Identity",             text: "What's something you're still trying to figure out about yourself?" },
  { id: 8,  category: "Identity",             text: "What kind of person usually catches your attention — even before attraction kicks in?" },
  { id: 9,  category: "Emotional Worldview",  text: "What qualities make someone feel genuinely trustworthy to you?" },
  { id: 10, category: "Emotional Worldview",  text: "When life gets stressful or overwhelming, what kind of support actually helps you most?" },
  { id: 11, category: "Emotional Worldview",  text: "What's something about your personality or effort you wish people appreciated more?" },
  { id: 12, category: "Emotional Worldview",  text: "What usually causes you to emotionally pull away from someone — even when you still care about them?" },
  { id: 13, category: "Soft Vulnerability",   text: "When you feel hurt, disappointed, or emotionally neglected, how do you normally react?" },
  { id: 14, category: "Soft Vulnerability",   text: "What kind of relationship dynamic naturally brings out the best version of you?" },
  { id: 15, category: "Soft Vulnerability",   text: "What's something you used to believe about relationships that you don't believe anymore?" },
  { id: 16, category: "Soft Vulnerability",   text: "Are there topics or situations you personally feel should never become jokes?" },
  { id: 17, category: "Romantic Imagination", text: "Beyond physical attraction, what do you think creates genuine emotional chemistry?" },
  { id: 18, category: "Romantic Imagination", text: "What's something you'd secretly love to experience in a relationship but would never admit on a first date?" },
  { id: 19, category: "Romantic Imagination", text: "If you could ask your future self one honest question about love or relationships, what would you ask?" },
  { id: 20, category: "Romantic Imagination", text: "What kind of conversations make you completely lose track of time?" },
];

const CATEGORY_COLORS = {
  "Playful Curiosity":    "#7c6aff",
  "Identity":             "#ff6b8a",
  "Emotional Worldview":  "#f5c842",
  "Soft Vulnerability":   "#4ade80",
  "Romantic Imagination": "#ff9eb5",
};

const CATEGORY_GROUPS = [
  { label: "Playful Curiosity",    emoji: "😄", range: [1,4]   },
  { label: "Identity",             emoji: "🔍", range: [5,8]   },
  { label: "Emotional Worldview",  emoji: "💭", range: [9,12]  },
  { label: "Soft Vulnerability",   emoji: "🤍", range: [13,16] },
  { label: "Romantic Imagination", emoji: "✨", range: [17,20] },
];

export default function Section2Comparison() {
  const { matchId } = useParams();
  const navigate = useNavigate();

  const [myData,      setMyData]      = useState({});
  const [matchData,   setMatchData]   = useState({});
  const [matchName,   setMatchName]   = useState("Your Match");
  const [matchedDate, setMatchedDate] = useState(null);
  const [myName,      setMyName]      = useState("You");
  const [score,       setScore]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [visible,     setVisible]     = useState({});
  const [activeGroup, setActiveGroup] = useState(null);
  const [locked,      setLocked]      = useState(false);
  const [error,       setError]       = useState(null);
  const observerRefs = useRef({});

  useEffect(() => { load(); }, [matchId]);

  async function load() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/'); return; }
      const uid = session.user.id;

      const { data: matchA } = await supabase
        .from('matches')
        .select('id, created_at, status, user_a_id, user_b_id, compatibility_score')
        .eq('user_a_id', uid).eq('user_b_id', matchId).maybeSingle();

      const { data: matchB } = await supabase
        .from('matches')
        .select('id, created_at, status, user_a_id, user_b_id, compatibility_score')
        .eq('user_a_id', matchId).eq('user_b_id', uid).maybeSingle();

      const matchRow = matchA || matchB;

      if (!matchRow) { setError("Match not found."); setLoading(false); return; }

      const { data: payment } = await supabase
        .from('payments').select('id')
        .eq('user_id', uid).eq('match_id', matchRow.id).eq('status', 'completed')
        .maybeSingle();

      const isUnlocked = !!payment
        || matchRow.status === 'matched'
        || matchRow.status === 'interested';

      if (!isUnlocked) { setLocked(true); setLoading(false); return; }

      setMatchedDate(matchRow.created_at);
      setScore(matchRow.compatibility_score);

      const otherUserId = matchRow.user_a_id === uid ? matchRow.user_b_id : matchRow.user_a_id;

      const { data: myProfile }    = await supabase.from('users').select('full_name').eq('id', uid).single();
      const { data: matchProfile } = await supabase.from('users').select('full_name').eq('id', otherUserId).single();

      setMyName(myProfile?.full_name?.split(' ')[0] || 'You');
      setMatchName(matchProfile?.full_name?.split(' ')[0] || 'Your Match');

      const { data: responses } = await supabase
        .from('section2_responses')
        .select('user_id, question_number, answer_text')
        .in('user_id', [uid, otherUserId]);

      const mine = {}, theirs = {};
      (responses || []).forEach(r => {
        if (r.user_id === uid)            mine[r.question_number]   = r.answer_text;
        else if (r.user_id === otherUserId) theirs[r.question_number] = r.answer_text;
      });

      setMyData(mine);
      setMatchData(theirs);
      setLoading(false);

    } catch(e) {
      setError("Something went wrong: " + e.message);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const qId   = entry.target.dataset.qid;
            const delay = parseInt(entry.target.dataset.delay || 0);
            setTimeout(() => setVisible(v => ({ ...v, [qId]: true })), delay);
          }
        });
      },
      { threshold: 0.15 }
    );
    Object.values(observerRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [loading]);

  const scrollToGroup = (label) => {
    setActiveGroup(label);
    const el = document.getElementById(`group-${label.replace(/\s/g, '-')}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: "320px" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
        <h2 style={{ color: "#f0f0f8", fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>Something went wrong</h2>
        <p style={{ color: "#8888aa", fontSize: "14px", marginBottom: "24px" }}>{error}</p>
        <button onClick={() => navigate(-1)} style={{ width: "100%", padding: "14px", borderRadius: "12px", backgroundColor: "#7c6aff", border: "none", color: "#fff", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>Go Back</button>
      </div>
    </div>
  );

  // ── Locked ────────────────────────────────────────────────────────────────
  if (locked) return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: "320px" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔒</div>
        <h2 style={{ color: "#f0f0f8", fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>Chemistry Locked</h2>
        <p style={{ color: "#8888aa", fontSize: "14px", lineHeight: 1.6, marginBottom: "24px" }}>Unlock this match to see how your answers compare.</p>
        <button onClick={() => navigate('/payment')} style={{ width: "100%", padding: "14px", borderRadius: "12px", backgroundColor: "#7c6aff", border: "none", color: "#fff", fontSize: "15px", fontWeight: 600, cursor: "pointer", marginBottom: "12px" }}>Unlock with M-Pesa</button>
        <button onClick={() => navigate(-1)} style={{ width: "100%", padding: "14px", borderRadius: "12px", backgroundColor: "transparent", border: "1px solid #2a2a3a", color: "#8888aa", fontSize: "14px", cursor: "pointer" }}>Go Back</button>
      </div>
    </div>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>💫</div>
        <p style={{ color: "#8888aa", fontSize: "14px" }}>Opening your chemistry…</p>
      </div>
    </div>
  );

  const answeredCount  = QUESTIONS.filter(q => matchData[q.id]).length;
  const sameCount      = QUESTIONS.filter(q => myData[q.id] && matchData[q.id] && myData[q.id] === matchData[q.id]).length;
  const scoreColor     = score >= 80 ? "#4ade80" : score >= 60 ? "#f5c842" : "#ff6b8a";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", fontFamily: "Inter, system-ui, sans-serif", maxWidth: "480px", margin: "0 auto", paddingBottom: "40px" }}>

      {/* ── Sticky Header ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, backgroundColor: "#0a0a0fee", backdropFilter: "blur(12px)", borderBottom: "1px solid #1a1a24", padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: "#8888aa", fontSize: "18px", cursor: "pointer", padding: "4px" }}>←</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#f0f0f8" }}>You & {matchName}</div>
            {matchedDate && <div style={{ fontSize: "11px", color: "#8888aa", marginTop: "2px" }}>Matched {new Date(matchedDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", color: "#7c6aff", fontWeight: 600 }}>{answeredCount}/20</div>
            {score && <div style={{ fontSize: "11px", color: scoreColor, fontWeight: 700 }}>{score}%</div>}
          </div>
        </div>

        {/* Category nav pills */}
        <div style={{ display: "flex", gap: "6px", marginTop: "10px", overflowX: "auto", paddingBottom: "2px" }}>
          {CATEGORY_GROUPS.map(g => (
            <button key={g.label} onClick={() => scrollToGroup(g.label)} style={{
              whiteSpace: "nowrap", padding: "5px 10px", borderRadius: "20px",
              fontSize: "11px", fontWeight: 600, cursor: "pointer", border: "none",
              backgroundColor: activeGroup === g.label ? CATEGORY_COLORS[g.label] + "33" : "#1a1a24",
              color: activeGroup === g.label ? CATEGORY_COLORS[g.label] : "#8888aa",
            }}>
              {g.emoji} {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Intro banner ── */}
      <div style={{ margin: "20px 20px 0", padding: "16px 20px", backgroundColor: "#111118", borderRadius: "12px", border: "1px solid #2a2a3a" }}>
        <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#8888aa", lineHeight: 1.6, textAlign: "center" }}>
          These are the real answers. No filters. No highlights.<br />
          <span style={{ color: "#7c6aff" }}>Scroll down</span> to see how {matchName} answered.
        </p>
        {sameCount > 0 && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#4ade80", backgroundColor: "#4ade8022", padding: "4px 14px", borderRadius: "20px", border: "1px solid #4ade8044" }}>
              ✓ You answered the same on {sameCount} of 20 questions
            </span>
          </div>
        )}
      </div>

      {/* ── Question groups ── */}
      {CATEGORY_GROUPS.map(group => {
        const groupQuestions = QUESTIONS.filter(q => q.id >= group.range[0] && q.id <= group.range[1]);
        const color = CATEGORY_COLORS[group.label];
        return (
          <div key={group.label} id={`group-${group.label.replace(/\s/g, '-')}`} style={{ marginTop: "32px" }}>

            {/* Group header */}
            <div style={{ padding: "0 20px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ height: "1px", flex: 1, backgroundColor: color + "44" }} />
              <span style={{ fontSize: "12px", fontWeight: 700, color, letterSpacing: "1px", whiteSpace: "nowrap" }}>
                {group.emoji} {group.label.toUpperCase()}
              </span>
              <div style={{ height: "1px", flex: 1, backgroundColor: color + "44" }} />
            </div>

            {/* Questions */}
            {groupQuestions.map((q, idx) => {
              const myAnswer    = myData[q.id];
              const matchAnswer = matchData[q.id];
              const isVisible   = visible[String(q.id)];
              const isSame      = myAnswer && matchAnswer && myAnswer === matchAnswer;
              const delay       = idx * 150;

              return (
                <div key={q.id}
                  ref={el => { observerRefs.current[q.id] = el; }}
                  data-qid={String(q.id)}
                  data-delay={String(delay)}
                  style={{ padding: "0 20px", marginBottom: "28px" }}
                >
                  {/* Question label */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color, letterSpacing: "1px", paddingTop: "3px", flexShrink: 0 }}>Q{q.id}</span>
                    <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#e0e0f0", lineHeight: 1.45, flex: 1 }}>{q.text}</p>
                  </div>

                  {/* MY bubble — left */}
                  <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "10px" }}>
                    <div style={{ maxWidth: "82%" }}>
                      <div style={{ fontSize: "10px", color: "#7c6aff", fontWeight: 600, marginBottom: "4px", paddingLeft: "4px" }}>{myName.toUpperCase()}</div>
                      <div style={{
                        backgroundColor: isSame ? "#4ade8022" : "#7c6aff22",
                        border: `1px solid ${isSame ? "#4ade8044" : "#7c6aff44"}`,
                        borderRadius: "18px 18px 18px 4px",
                        padding: "12px 16px", fontSize: "14px", lineHeight: 1.5,
                        color: myAnswer ? "#f0f0f8" : "#555",
                        fontStyle: myAnswer ? "normal" : "italic",
                      }}>
                        {myAnswer || "You haven't answered this yet"}
                      </div>
                    </div>
                  </div>

                  {/* MATCH bubble — right, fades in */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: isSame ? "8px" : "4px" }}>
                    <div style={{ maxWidth: "82%" }}>
                      <div style={{ fontSize: "10px", color, fontWeight: 600, marginBottom: "4px", paddingRight: "4px", textAlign: "right" }}>{matchName.toUpperCase()}</div>
                      <div style={{
                        backgroundColor: isSame ? "#4ade8022" : matchAnswer ? "#1a1a24" : "#111118",
                        border: `1px solid ${isSame ? "#4ade8044" : matchAnswer ? color + "44" : "#2a2a3a"}`,
                        borderRadius: "18px 18px 4px 18px",
                        padding: "12px 16px", fontSize: "14px", lineHeight: 1.5,
                        color: matchAnswer ? "#f0f0f8" : "#444",
                        fontStyle: matchAnswer ? "normal" : "italic",
                        opacity: isVisible ? 1 : 0,
                        transform: isVisible ? "translateY(0)" : "translateY(10px)",
                        transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
                      }}>
                        {matchAnswer || `${matchName} hasn't answered this yet`}
                      </div>
                    </div>
                  </div>

                  {/* Same answer badge */}
                  {isSame && (
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: "4px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "#4ade80", backgroundColor: "#4ade8022", padding: "3px 12px", borderRadius: "20px", border: "1px solid #4ade8044" }}>
                        ✓ Same answer
                      </span>
                    </div>
                  )}

                  {/* Divider */}
                  <div style={{ marginTop: "20px", height: "1px", backgroundColor: "#1a1a24" }} />
                </div>
              );
            })}
          </div>
        );
      })}

      {/* ── Footer CTA ── */}
      <div style={{ padding: "20px", margin: "8px 20px 0", backgroundColor: "#111118", borderRadius: "16px", border: "1px solid #2a2a3a", textAlign: "center" }}>
        {sameCount > 0 && (
          <div style={{ marginBottom: "14px", padding: "10px", backgroundColor: "#4ade8011", borderRadius: "8px", border: "1px solid #4ade8033" }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#4ade80", fontWeight: 600 }}>
              You share {sameCount} identical answer{sameCount > 1 ? "s" : ""} with {matchName}
            </p>
          </div>
        )}
        <p style={{ margin: "0 0 16px", fontSize: "14px", color: "#8888aa", lineHeight: 1.6 }}>
          You've read how {matchName} sees the world.<br />
          <span style={{ color: "#f0f0f8", fontWeight: 600 }}>Ready to start the real conversation?</span>
        </p>
        <button
          onClick={() => navigate('/chat', { state: { matchId, matchName } })}
          style={{ width: "100%", padding: "14px", borderRadius: "12px", backgroundColor: "#7c6aff", border: "none", color: "#fff", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}
        >
          Open Chat with {matchName} →
        </button>
      </div>

    </div>
  );
}