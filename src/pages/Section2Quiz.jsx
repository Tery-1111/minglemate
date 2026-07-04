import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const QUESTIONS = [
  {
    id: 1, category: "Playful Curiosity",
    text: "What's something small that instantly makes you like someone more?",
    choices: [
      "They remember something I told them last week — scary but cute",
      "They can laugh at themselves without being weird about it",
      "They ask questions back instead of making it an interview",
      "They're nice to the mama mboga or guard — shows character",
      "They don't try too hard. Just chill.",
    ]
  },
  {
    id: 2, category: "Playful Curiosity",
    text: "What's something small that instantly makes you like someone less?",
    choices: [
      "They interrupt me constantly",
      "They're rude to waiters or anyone 'below' them",
      "They only talk about themselves — never ask about me",
      "They try way too hard to be funny",
      "They're on their phone while I'm talking",
    ]
  },
  {
    id: 3, category: "Playful Curiosity",
    text: "What's something people usually assume about you that's completely wrong?",
    choices: [
      "That I'm confident when inside I'm stressing",
      "That I'm rude when I'm just shy or introverted",
      "That I have everything figured out (I really don't)",
      "That I'm okay because I don't complain",
      "That I'm unserious because I joke around a lot",
    ]
  },
  {
    id: 4, category: "Playful Curiosity",
    text: "What's a word your friends would use to describe you that most people wouldn't guess?",
    choices: ["Loyal", "Chaotic", "Deep", "Funny", "Overthinker"]
  },
  {
    id: 5, category: "Identity",
    text: "What's something you're lowkey proud of but never get to talk about?",
    choices: [
      "I've been through hard things and I'm still here",
      "I'm a really loyal friend — I show up",
      "I'm good at reading people's emotions",
      "I've gotten better at something I used to be bad at",
      "I'm funnier than people expect",
    ]
  },
  {
    id: 6, category: "Identity",
    text: "What's a moment from your past you think quietly shaped who you are today?",
    choices: [
      "A friendship that ended badly",
      "A time someone believed in me when I didn't",
      "Losing someone close to me",
      "Moving to a new place and starting over",
      "A moment I failed at something important",
    ]
  },
  {
    id: 7, category: "Identity",
    text: "What's something you're still trying to figure out about yourself?",
    choices: [
      "What I actually want in a relationship vs what I say I want",
      "What I want to do with my life — career is confusing",
      "Why I push people away when I start liking them",
      "How to stop overthinking every small thing",
      "What I actually need vs what I think I want",
    ]
  },
  {
    id: 8, category: "Identity",
    text: "What kind of person usually catches your attention — even before attraction kicks in?",
    choices: [
      "Someone who's funny without trying too hard",
      "Someone who's quiet but observant — notices things",
      "Someone who's passionate about something, anything",
      "Someone who's kind to people who can't do anything for them",
      "Someone who's just... different. Can't explain it.",
    ]
  },
  {
    id: 9, category: "Emotional Worldview",
    text: "What qualities make someone feel genuinely trustworthy to you?",
    choices: [
      "They keep their word — small things and big things",
      "They don't gossip about others to me",
      "They admit when they're wrong",
      "They don't disappear when things get hard",
      "They're the same in public and private",
    ]
  },
  {
    id: 10, category: "Emotional Worldview",
    text: "When life gets stressful or overwhelming, what kind of support actually helps you most?",
    choices: [
      "Someone just being there — not talking, just present",
      "Someone helping me organize my chaos",
      "Someone making me laugh and forget for a bit",
      "Someone telling me it's okay to not be okay",
      "Honestly, I usually just isolate until it passes",
    ]
  },
  {
    id: 11, category: "Emotional Worldview",
    text: "What's something about your personality or effort you wish people appreciated more?",
    choices: [
      "That I check in on people even when I'm struggling too",
      "That I think about how my actions affect others",
      "That I'm trying even when it doesn't look like much",
      "That I remember small things about people",
      "That I show up even when I don't feel like it",
    ]
  },
  {
    id: 12, category: "Emotional Worldview",
    text: "What usually causes you to emotionally pull away from someone — even when you still care about them?",
    choices: [
      "They don't keep their word",
      "I feel like I care more than they do",
      "They judge me instead of trying to understand me",
      "They only want to talk about themselves",
      "I feel like I can't be fully honest without being judged",
    ]
  },
  {
    id: 13, category: "Soft Vulnerability",
    text: "When you feel hurt, disappointed, or emotionally neglected, how do you normally react?",
    choices: [
      "Shut down and go quiet",
      "Get loud or confrontational",
      "Pull away slowly without saying much",
      "Over-explain and try to fix it immediately",
      "Pretend I'm fine then cry later alone",
    ]
  },
  {
    id: 14, category: "Soft Vulnerability",
    text: "What kind of relationship dynamic naturally brings out the best version of you?",
    choices: [
      "When we can joke around and be stupid together",
      "When we push each other to grow",
      "When there's no pressure and things feel easy",
      "When we can be honest even when it's uncomfortable",
      "When we both make an effort without keeping score",
    ]
  },
  {
    id: 15, category: "Soft Vulnerability",
    text: "What's something you used to believe about relationships that you don't believe anymore?",
    choices: [
      "That love is supposed to be hard",
      "That someone would complete me",
      "That fighting means it's not working",
      "That I had to change who I am to be loved",
      "That if they wanted to, they would",
    ]
  },
  {
    id: 16, category: "Soft Vulnerability",
    text: "Are there topics or situations you personally feel should never become jokes?",
    choices: [
      "Someone's physical appearance",
      "Someone's trauma or painful past",
      "Mental health struggles",
      "Someone's family situation",
      "Honestly, nothing is off limits if we're both laughing",
    ]
  },
  {
    id: 17, category: "Romantic Imagination",
    text: "Beyond physical attraction, what do you think creates genuine emotional chemistry?",
    choices: [
      "Being able to be quiet together without it being awkward",
      "The same weird sense of humor",
      "Feeling like you've known them forever",
      "They challenge you but don't judge you",
      "Honestly? You just feel it. Can't force it.",
    ]
  },
  {
    id: 18, category: "Romantic Imagination",
    text: "What's something you'd secretly love to experience in a relationship but would never admit on a first date?",
    choices: [
      "Being someone's first thought in the morning",
      "Doing something stupid together and laughing until it hurts",
      "Being vulnerable without them using it against me later",
      "Just being chosen — not because they're settling",
      "Slow dancing at 2am for no reason",
    ]
  },
  {
    id: 19, category: "Romantic Imagination",
    text: "If you could ask your future self one honest question about love or relationships, what would you ask?",
    choices: [
      "Did I end up with the right person?",
      "Was it worth all the heartbreak?",
      "What do you wish you knew earlier?",
      "Did I settle or did I wait for what I deserved?",
      "Are you actually happy?",
    ]
  },
  {
    id: 20, category: "Romantic Imagination",
    text: "What kind of conversations make you completely lose track of time?",
    choices: [
      "Deep talks — life, death, meaning, all that heavy stuff",
      "Debating dumb things like best Kenyan artist or which chipo is superior",
      "Sharing embarrassing stories from high school",
      "Talking about childhood and how we grew up",
      "Honestly, any conversation where the other person is actually listening",
    ]
  },
];

const CATEGORY_COLORS = {
  "Playful Curiosity":    { bg: "#7c6aff22", text: "#7c6aff" },
  "Identity":             { bg: "#ff6b8a22", text: "#ff6b8a" },
  "Emotional Worldview":  { bg: "#f5c84222", text: "#f5c842" },
  "Soft Vulnerability":   { bg: "#4ade8022", text: "#4ade80" },
  "Romantic Imagination": { bg: "#ff9eb522", text: "#ff9eb5" },
};

export default function Section2Quiz() {
  const navigate  = useNavigate();
  const [step, setStep]       = useState(0);
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState({});
  const [userId, setUserId]   = useState(null);
  const [saving, setSaving]   = useState(false);
  const [done, setDone]       = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/'); return; }
      setUserId(session.user.id);

      // Load existing answers so user can resume
      const { data: existing } = await supabase
        .from('section2_responses')
        .select('question_number, answer_text')
        .eq('user_id', session.user.id);

      if (existing && existing.length > 0) {
        const loaded = {};
        existing.forEach(r => { loaded[r.question_number] = r.answer_text; });
        setAnswers(loaded);
        // Resume from where they left off
        const nextUnanswered = QUESTIONS.findIndex(q => !loaded[q.id]);
        if (nextUnanswered === -1) { setDone(true); return; }
        setStep(nextUnanswered);
      }
    })();
  }, [navigate]);

  const q = QUESTIONS[step];
  const progress = ((step + 1) / QUESTIONS.length) * 100;
  const catStyle = CATEGORY_COLORS[q?.category] || { bg: "#ffffff11", text: "#888" };

  const handleSelect = (choice) => {
    if (saving) return;
    setSelected(choice);
  };

  const handleNext = async () => {
    if (!selected && !answers[q.id]) return;
    const answer = selected || answers[q.id];
    setSaving(true);

    // Save to section2_responses table
    await supabase.from('section2_responses').upsert({
      user_id:         userId,
      question_number: q.id,
      answer_text:     answer,
    }, { onConflict: 'user_id,question_number' });

    const newAnswers = { ...answers, [q.id]: answer };
    setAnswers(newAnswers);
    setSelected(null);

    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      // All done — mark complete
      await supabase.from('users')
        .update({ section2_unlocked: true })
        .eq('id', userId);
      setDone(true);
    }
    setSaving(false);
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
      setSelected(answers[QUESTIONS[step - 1].id] || null);
    }
  };

  if (done) return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: "340px" }}>
        <div style={{ fontSize: "48px", marginBottom: "20px" }}>🎉</div>
        <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#f0f0f8", marginBottom: "10px" }}>Section 2 Complete</h2>
        <p style={{ color: "#8888aa", fontSize: "14px", lineHeight: 1.6, marginBottom: "28px" }}>
          Your answers are locked in. When you match, your chemistry comparison will be ready.
        </p>
        <button
          onClick={() => navigate('/home')}
          style={{ width: "100%", padding: "14px", borderRadius: "12px", backgroundColor: "#7c6aff", border: "none", color: "#fff", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}
        >
          Go to Home →
        </button>
      </div>
    </div>
  );

  if (!q) return null;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0a0a0f", fontFamily: "Inter, system-ui, sans-serif", maxWidth: "480px", margin: "0 auto", padding: "0 0 40px" }}>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={handleBack} disabled={step === 0}
          style={{ background: "none", border: "none", color: step === 0 ? "#333" : "#8888aa", fontSize: "20px", cursor: step === 0 ? "default" : "pointer", padding: "4px" }}>
          ←
        </button>
        <span style={{ fontSize: "13px", color: "#8888aa" }}>{step + 1} / {QUESTIONS.length}</span>
        <span style={{ fontSize: "12px", color: "#8888aa", opacity: 0 }}>x</span>
      </div>

      {/* Progress bar */}
      <div style={{ margin: "14px 20px 0", height: "4px", backgroundColor: "#1a1a24", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #7c6aff, #ff6b8a)", borderRadius: "2px", transition: "width 0.4s ease" }} />
      </div>

      {/* Category badge */}
      <div style={{ padding: "20px 20px 0" }}>
        <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, backgroundColor: catStyle.bg, color: catStyle.text, letterSpacing: "0.5px" }}>
          {q.category}
        </span>
      </div>

      {/* Question */}
      <div style={{ padding: "16px 20px 24px" }}>
        <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f0f0f8", lineHeight: 1.45, margin: 0 }}>
          {q.text}
        </h2>
      </div>

      {/* Choices */}
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {q.choices.map((choice, i) => {
          const isSelected = (selected || answers[q.id]) === choice;
          return (
            <button key={i} onClick={() => handleSelect(choice)}
              style={{
                textAlign: "left", padding: "14px 16px",
                borderRadius: "12px", cursor: "pointer",
                fontSize: "14px", lineHeight: 1.5,
                transition: "all 0.15s ease",
                backgroundColor: isSelected ? "#7c6aff22" : "#111118",
                border: isSelected ? "1px solid #7c6aff" : "1px solid #2a2a3a",
                color: isSelected ? "#f0f0f8" : "#c0c0d0",
                fontWeight: isSelected ? 600 : 400,
              }}
            >
              <span style={{ color: isSelected ? "#7c6aff" : "#444", marginRight: "10px", fontSize: "12px" }}>
                {String.fromCharCode(65 + i)}
              </span>
              {choice}
            </button>
          );
        })}

        {/* Other option */}
        <button onClick={() => handleSelect("Other")}
          style={{
            textAlign: "left", padding: "14px 16px", borderRadius: "12px", cursor: "pointer",
            fontSize: "14px", lineHeight: 1.5, transition: "all 0.15s ease",
            backgroundColor: (selected || answers[q.id]) === "Other" ? "#7c6aff22" : "transparent",
            border: (selected || answers[q.id]) === "Other" ? "1px solid #7c6aff" : "1px dashed #2a2a3a",
            color: "#666",
          }}
        >
          <span style={{ marginRight: "10px", fontSize: "12px" }}>F</span>
          Other / Prefer not to say
        </button>
      </div>

      {/* Next button */}
      <div style={{ padding: "28px 20px 0" }}>
        <button
          onClick={handleNext}
          disabled={!selected && !answers[q.id] || saving}
          style={{
            width: "100%", padding: "15px", borderRadius: "12px",
            fontSize: "15px", fontWeight: 600, cursor: "pointer",
            border: "none", transition: "all 0.15s",
            backgroundColor: (!selected && !answers[q.id]) || saving ? "#1a1a24" : "#7c6aff",
            color: (!selected && !answers[q.id]) || saving ? "#444" : "#fff",
          }}
        >
          {saving ? "Saving…" : step < QUESTIONS.length - 1 ? "Next →" : "Complete Section 2 ✓"}
        </button>
      </div>

      {/* Step dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: "4px", padding: "20px 20px 0", flexWrap: "wrap" }}>
        {QUESTIONS.map((_, i) => (
          <div key={i} style={{
            width: "6px", height: "6px", borderRadius: "50%",
            backgroundColor: answers[i + 1] ? "#7c6aff" : i === step ? "#ff6b8a" : "#2a2a3a",
            transition: "background-color 0.3s",
          }} />
        ))}
      </div>

    </div>
  );
}