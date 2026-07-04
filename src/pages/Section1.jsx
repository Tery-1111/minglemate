import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const CAMPUS_QUESTIONS = [
  {
    id: 1,
    text: "Which best describes how your current lifestyle is structured during a normal academic week?",
    options: [
      "Most of my time goes to academics and personal goals",
      "I balance academics with a healthy social life",
      "I juggle academics with work/business responsibilities",
      "I prioritize social activities and experiences heavily",
      "My schedule changes constantly depending on circumstances"
    ]
  },
  {
    id: 2,
    text: "When academic pressure becomes intense, what kind of support do you prefer from a partner?",
    options: [
      "Give me space to focus",
      "Encourage and emotionally support me",
      "Study/work alongside me",
      "Help practically where possible",
      "Flexible depending on the situation"
    ]
  },
  {
    id: 3,
    text: "Which best describes how you prefer to study and involve others in your academic life?",
    options: [
      "Alone",
      "With a study partner",
      "In a group",
      "Flexible depending on context"
    ]
  },
  {
    id: 4,
    text: "When overwhelmed or stressed, how do you usually react?",
    options: [
      "Withdraw and become quiet",
      "Reach out to people for support",
      "Become irritable or emotional",
      "Stay outwardly calm but internally stressed",
      "Depends on the situation"
    ]
  },
  {
    id: 5,
    text: "If your partner wanted attention during an academically stressful period, what would you most likely do?",
    options: [
      "Focus mainly on academics until pressure reduces",
      "Try balancing both even if stressful",
      "Prioritize making time for the relationship",
      "Communicate and adjust depending on circumstances"
    ]
  },
  {
    id: 6,
    text: "Which best describes your current financial situation?",
    options: [
      "Fully dependent on parents",
      "Dependent on student loans/HELB",
      "Part-time job contributing to expenses",
      "Financially independent"
    ]
  },
  {
    id: 7,
    text: "When going out with someone, what arrangement feels most fair to you financially?",
    options: [
      "One person should mostly pay",
      "Split costs equally",
      "Alternate paying depending on situation",
      "Depends on who initiated the date",
      "Flexible depending on circumstances"
    ]
  },
  {
    id: 8,
    text: "What type of dating experience feels most natural and meaningful to you during campus life?",
    options: [
      "Simple low-cost activities and quality time",
      "A balance between simple and occasional planned dates",
      "Well-planned experiences matter to me",
      "Depends more on the emotional connection than the activity itself"
    ]
  },
  {
    id: 9,
    text: "If one partner is financially struggling more than the other, how should it ideally be handled?",
    options: [
      "Openly discuss and support each other",
      "Keep finances mostly separate",
      "The financially stable partner should help more",
      "Avoid discussing finances too much",
      "Depends on the seriousness of the relationship"
    ]
  },
  {
    id: 10,
    text: "Which gesture would make you feel most appreciated in a relationship?",
    options: [
      "Thoughtful gifts or surprises",
      "Quality time and attention",
      "Emotional support and reassurance",
      "Acts of help and effort",
      "Physical affection and closeness"
    ]
  },
  {
    id: 11,
    text: "Which best describes your current living situation?",
    options: [
      "Campus hostel",
      "Off-campus bedsitter/apartment",
      "Living with family",
      "Shared apartment/roommates",
      "Other"
    ]
  },
  {
    id: 12,
    text: "How comfortable are you spending time in a partner’s hostel, apartment, or personal space?",
    options: [
      "Very comfortable",
      "Comfortable after trust is built",
      "Prefer public spaces mostly",
      "Not comfortable with it"
    ]
  },
  {
    id: 13,
    text: "How much personal space or alone time do you usually need in your life?",
    options: [
      "A lot of alone time",
      "A balanced amount",
      "Very little alone time",
      "Depends on mood and stress levels"
    ]
  },
  {
    id: 14,
    text: "Which best describes your comfort level with physical intimacy in relationships?",
    options: [
      "Prefer taking things slowly",
      "Comfortable once emotional connection exists",
      "Comfortable early if mutual",
      "Strong personal or religious boundaries"
    ]
  },
  {
    id: 15,
    text: "If your roommate or hostel mate became uncomfortable with how often your partner visited, how would you most likely respond?",
    options: [
      "Respect the roommate’s concerns first",
      "Try balancing both sides fairly",
      "Prioritize relationship freedom more",
      "Discuss and decide depending on circumstances"
    ]
  },
  {
    id: 16,
    text: "When something is bothering you in a relationship, how do you usually respond?",
    options: [
      "Bring it up immediately",
      "Wait until calm before discussing",
      "Avoid conflict if possible",
      "Keep it inside for some time first"
    ]
  },
  {
    id: 17,
    text: "How do you usually prefer having serious or emotional conversations?",
    options: [
      "Face-to-face",
      "Phone call or voice notes",
      "Text messages first",
      "Depends on the topic"
    ]
  },
  {
    id: 18,
    text: "During disagreements, what makes you feel most respected and understood?",
    options: [
      "Being listened to calmly without interruption",
      "Receiving emotional reassurance and empathy",
      "Finding practical solutions together",
      "Being given enough time to fully explain myself"
    ]
  },
  {
    id: 19,
    text: "After an argument or misunderstanding, what helps you reconnect best?",
    options: [
      "Honest conversation afterward",
      "Time and space first",
      "Physical affection or reassurance",
      "Returning to normal gradually over time"
    ]
  },
  {
    id: 20,
    text: "How private are you about your relationships with friends or people around you?",
    options: [
      "Very private",
      "Share only basic details",
      "Open with close friends",
      "Very open about relationships"
    ]
  },
  {
    id: 21,
    text: "How public would you ideally want your relationship to be?",
    options: [
      "Very private",
      "Mostly private",
      "Balanced/public when necessary",
      "Open and public"
    ]
  },
  {
    id: 22,
    text: "How important is it for your close friends to genuinely like your partner?",
    options: [
      "Very important",
      "Somewhat important",
      "Nice but not necessary",
      "Not important to me"
    ]
  },
  {
    id: 23,
    text: "How do you prefer handling social events and activities in relationships?",
    options: [
      "Attend most events together",
      "Mix of together and separate activities",
      "Mostly separate social lives",
      "Depends on the type of event"
    ]
  },
  {
    id: 24,
    text: "If close friends raised concerns about your partner, how would you most likely react?",
    options: [
      "Take their concerns very seriously",
      "Listen but make my own decision",
      "Defend my partner immediately",
      "Depends on who is giving the advice"
    ]
  },
  {
    id: 25,
    text: "How comfortable are you with your partner having very close friendships with people they could potentially be attracted to?",
    options: [
      "Completely comfortable",
      "Comfortable with clear boundaries",
      "Slightly uncomfortable",
      "Very uncomfortable"
    ]
  },
  {
    id: 26,
    text: "What role does faith or religion currently play in your life?",
    options: [
      "Very active and important",
      "Important but moderate",
      "Minimal involvement",
      "Not important to me"
    ]
  },
  {
    id: 27,
    text: "How open are you with your family about your dating life?",
    options: [
      "Very open",
      "Somewhat open",
      "Mostly private",
      "Completely private"
    ]
  },
  {
    id: 28,
    text: "How much do cultural or family expectations influence who you date?",
    options: [
      "Strong influence",
      "Moderate influence",
      "Very little influence",
      "No influence at all"
    ]
  },
  {
    id: 29,
    text: "If a relationship strongly challenged one of your personal values or boundaries, what would you most likely do?",
    options: [
      "Hold firmly to my boundaries",
      "Try compromising carefully",
      "Adjust if the emotional connection is strong",
      "Depends entirely on the situation"
    ]
  },
  {
    id: 30,
    text: "Which situation would most likely make you end a relationship, even if you still cared about the person?",
    options: [
      "Dishonesty or betrayal",
      "Lack of effort or communication",
      "Lifestyle or value incompatibility",
      "Emotional disconnection over time",
      "Repeated disrespect or boundary violations"
    ]
  },
  {
    id: 31,
    text: "What are you mainly looking for at this stage of your life?",
    options: [
      "Serious long-term relationship",
      "Something meaningful but natural",
      "Casual connection",
      "Still figuring it out"
    ]
  },
  {
    id: 32,
    text: "How open are you to a relationship continuing after campus life ends?",
    options: [
      "Very open to long-term continuation",
      "Open if the connection is strong",
      "Prefer focusing on the present only",
      "Unsure"
    ]
  },
  {
    id: 33,
    text: "If a relationship goes well, what pace feels most natural to you emotionally?",
    options: [
      "Slow and gradual",
      "Balanced progression",
      "Fast emotional commitment",
      "Depends on the connection"
    ]
  },
  {
    id: 34,
    text: "What most commonly causes you to emotionally lose interest in relationships over time?",
    options: [
      "Dishonesty or betrayal",
      "Poor communication or effort",
      "Lifestyle/value incompatibility",
      "Emotional distance growing slowly",
      "Loss of attraction or excitement"
    ]
  },
  {
    id: 35,
    text: "If you were in a serious relationship and had to move to different cities after graduation, what would you most likely do?",
    options: [
      "Commit to making long-distance work",
      "Try long-distance first, then decide",
      "Prefer ending things peacefully",
      "End the relationship completely",
      "Depends on the situation"
    ]
  },
  {
    id: 36,
    text: "Which type of environment naturally gives you the most energy?",
    options: [
      "Quiet/private environments",
      "Small groups of people",
      "Large social settings",
      "Depends on my mood"
    ]
  },
  {
    id: 37,
    text: "How easily do you express emotions or vulnerable feelings to people you trust?",
    options: [
      "Very openly",
      "Moderately openly",
      "Slowly over time",
      "Rarely/opening up is difficult"
    ]
  },
  {
    id: 38,
    text: "If you could live to 90 and keep either the body or mind of a 20-year-old, what would you choose?",
    options: [
      "Youthful body",
      "Youthful mind",
      "Balanced mix of both"
    ]
  },
  {
    id: 39,
    text: "Are there topics or situations you personally feel should not be joked about?",
    options: [
      "Very strong boundaries around humor",
      "A few sensitive topics",
      "Mostly open to humor",
      "Almost nothing is off-limits"
    ]
  },
  {
    id: 40,
    text: "Which areas would you strongly prefer to have in common with someone you are matched with? (Select up to 3)",
    options: [
      "Academic interests and career goals",
      "Hobbies and free-time activities",
      "Personality traits",
      "Lifestyle choices and habits",
      "Core values and beliefs",
      "Social style and communication habits"
    ]
  }
];

export default function Section1() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    async function restoreSurveyProgress() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate('/login');
          return;
        }
        setUserId(user.id);

        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('section1_progress, section1_complete')
          .eq('id', user.id)
          .single();

        if (profileError) throw profileError;

        if (profile?.section1_complete) {
          navigate('/home');
          return;
        }

        const progressPointer = profile?.section1_progress || 0;
        setCurrent(progressPointer);

        const { data: responseRow } = await supabase
          .from('user_responses')
          .select('responses_array')
          .eq('user_id', user.id)
          .maybeSingle();

        if (responseRow?.responses_array) {
          setAnswers(responseRow.responses_array);
        } else {
          setAnswers(new Array(CAMPUS_QUESTIONS.length).fill(null));
        }
      } catch (err) {
        console.error("Survey sync disruption:", err);
        setError("Failed to coordinate profile progress maps safely.");
      } finally {
        setLoading(false);
      }
    }
    restoreSurveyProgress();
  }, [navigate]);

  const handleSelectOption = async (optionIndex) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);

    const updatedAnswers = [...answers];
    updatedAnswers[current] = optionIndex;
    setAnswers(updatedAnswers);

    const nextStepIndex = current + 1;
    const isSurveyFinished = nextStepIndex >= CAMPUS_QUESTIONS.length;

    try {
      const { error: responseError } = await supabase
        .from('user_responses')
        .upsert({
          user_id: userId,
          responses_array: updatedAnswers,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (responseError) throw responseError;

      const { error: userUpdateError } = await supabase
        .from('users')
        .update({
          section1_progress: isSurveyFinished ? current : nextStepIndex,
          section1_complete: isSurveyFinished,
          section1_last_edited: new Date().toISOString()
        })
        .eq('id', userId);

      if (userUpdateError) throw userUpdateError;

      if (isSurveyFinished) {
        navigate('/section2-quiz');
      } else {
        setCurrent(nextStepIndex);
      }
    } catch (err) {
      console.error("Answer upload crash execution:", err);
      setError("Failed to preserve selected metrics sequence indices securely.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <div style={styles.centerContainer}>⚡ Loading Structural Survey Matrix...</div>;
  if (error) return <div style={styles.centerContainer}><div style={styles.alertBox}>{error}</div></div>;

  const currentQuestion = CAMPUS_QUESTIONS[current];

  return (
    <div style={styles.container}>
      <div style={styles.surveyCard}>
        <div style={styles.progressBarWrapper}>
          <div 
            style={{ 
              ...styles.progressBarFill, 
              width: `${((current + 1) / CAMPUS_QUESTIONS.length) * 100}%` 
            }} 
          />
        </div>

        <div style={styles.counterText}>
          Question {current + 1} of {CAMPUS_QUESTIONS.length}
        </div>

        <h2 style={styles.questionTitle}>{currentQuestion?.text}</h2>

        <div style={styles.optionsContainer}>
          {currentQuestion?.options.map((option, idx) => (
            <button
              key={idx}
              disabled={isSaving}
              onClick={() => handleSelectOption(idx)}
              style={{
                ...styles.optionButton,
                background: answers[current] === idx ? 'rgba(232, 65, 107, 0.2)' : '#1a1a1a',
                borderColor: answers[current] === idx ? '#E8416B' : '#333333',
                cursor: isSaving ? 'not-allowed' : 'pointer'
              }}
            >
              {option}
            </button>
          ))}
        </div>

        {current > 0 && (
          <button 
            disabled={isSaving}
            onClick={() => setCurrent(prev => prev - 1)} 
            style={styles.backBtn}
          >
            ← Previous Question
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
  },
  centerContainer: {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#888888',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '15px'
  },
  surveyCard: {
    width: '100%',
    maxWidth: '480px',
    background: '#141414',
    border: '1px solid #262626',
    borderRadius: '16px',
    padding: '32px 24px'
  },
  progressBarWrapper: {
    width: '100%',
    height: '6px',
    background: '#262626',
    borderRadius: '3px',
    marginBottom: '20px',
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    background: '#E8416B',
    transition: 'width 0.3s ease-in-out'
  },
  counterText: {
    color: '#888888',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '8px',
    textTransform: 'uppercase'
  },
  questionTitle: {
    color: '#ffffff',
    fontSize: '20px',
    fontWeight: '700',
    lineHeight: '1.4',
    margin: '0 0 24px 0'
  },
  optionsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '24px'
  },
  optionButton: {
    width: '100%',
    textAlign: 'left',
    padding: '16px',
    color: '#ffffff',
    fontSize: '15px',
    border: '1px solid #333333',
    borderRadius: '10px',
    transition: 'all 0.15s ease',
    outline: 'none'
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#666666',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    padding: '4px',
    outline: 'none',
    transition: 'color 0.2s'
  },
  alertBox: {
    background: 'rgba(232, 65, 107, 0.1)',
    border: '1px solid #E8416B',
    color: '#E8416B',
    padding: '12px 20px',
    borderRadius: '8px'
  }
};
