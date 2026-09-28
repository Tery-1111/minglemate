import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { BrandLogo } from '../components/BrandLogo';
import { section1Questions as CAMPUS_QUESTIONS } from '../data/section1Questions';

export default function Section1() {
  const navigate = useNavigate();
  // ?retake=1 (Profile → Retake) lets a completed user back in to
  // edit answers; onboarding visitors still get the completed-bypass.
  const [searchParams] = useSearchParams();
  const isRetake = searchParams.get('retake') === '1';
  const [current, setCurrent] = useState(0); // Clean 0-indexed default assignment array scale
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    async function restoreSurveyProgress() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
          navigate('/login');
          return;
        }
        setUserId(user.id);

        // Fetch current questionnaire status profiles
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('section1_progress, section1_complete')
          .eq('id', user.id)
          .single();

        if (profileError) throw profileError;

        if (profile?.section1_complete && !isRetake) {
          // Already completed: continue to Discover per the app flow.
          navigate('/discover');
          return;
        }

        // 🚨 THE FIX: Map progress using absolute 0-indexed scale pointers to prevent item skipping
        const progressPointer = profile?.section1_progress || 0;
        setCurrent(progressPointer);

        // Restore previously recorded matrix vectors if any exist
        const { data: responseRow } = await supabase
          .from('user_responses')
          .select('responses_array')
          .eq('user_id', user.id)
          .maybeSingle();

        if (responseRow?.responses_array) {
          // Legacy rows from the old integer[] column may hold numeric
          // indices; map them to null IN PLACE (filtering would shift
          // answer positions). Fresh answers are always option text.
          setAnswers(responseRow.responses_array.map(a => (typeof a === 'string' ? a : null)));
        } else {
          setAnswers(new Array(CAMPUS_QUESTIONS.length).fill(null));
        }
      } catch (err) {
        console.error("Survey sync disruption:", err);
        setError("We couldn't load your questionnaire. Please try again.");
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

    // Update locally stored array element values cleanly
    const updatedAnswers = [...answers];
    updatedAnswers[current] = CAMPUS_QUESTIONS[current].options[optionIndex];
    setAnswers(updatedAnswers);

    const nextStepIndex = current + 1;
    const isSurveyFinished = nextStepIndex >= CAMPUS_QUESTIONS.length;

    try {
      // 1. Commit answer vectors down into the dedicated vector tracking tables
      const { error: responseError } = await supabase
        .from('user_responses')
        .upsert({
          user_id: userId,
          responses_array: updatedAnswers,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (responseError) throw responseError;

      // 2. Advance structural state records on users master reference configuration blocks
      const { error: userUpdateError } = await supabase
        .from('users')
        .update({
          section1_progress: isSurveyFinished ? current : nextStepIndex,
          section1_complete: isSurveyFinished,
          section1_last_edited: new Date().toISOString()
        })
        .eq('id', userId);

      if (userUpdateError) throw userUpdateError;

      // 3. Routing navigation pipeline logic
      if (isSurveyFinished) {
        // Onboarding order: Algorithm Questionnaire → Guided-Question
        // Questionnaire (Section 2) → Discover.
        navigate('/section2');
      } else {
        setCurrent(nextStepIndex);
      }
    } catch (err) {
      console.error("Answer upload crash execution:", err);
      setError("We couldn't save that answer. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <div style={styles.centerContainer}><span className="loading-dots">Loading your questionnaire</span></div>;
  if (error) return <div style={styles.centerContainer}><div style={styles.alertBox}>{error}</div></div>;

  const currentQuestion = CAMPUS_QUESTIONS[current];

  return (
    <div style={styles.container}>
      <div style={styles.surveyCard}>
        <BrandLogo variant="mark" className="brand-logo--sm brand-logo--gap" />
        {/* Progress bar */}
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

        {/* Options Stack Grid Selection */}
        <div style={styles.optionsContainer}>
          {currentQuestion?.options.map((option, idx) => (
            <button
              key={idx}
              disabled={isSaving}
              onClick={() => handleSelectOption(idx)}
              style={{
                ...styles.optionButton,
                // answers hold option TEXT (see handleSelectOption); compare
                // text-to-text so a revisited question shows its saved choice.
                background: answers[current] === option ? 'var(--accent-soft)' : 'var(--surface-raised)',
                borderColor: answers[current] === option ? 'var(--accent)' : 'var(--border-strong)',
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
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
  },
  centerContainer: {
    minHeight: '100vh',
    background: 'var(--bg)',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '15px'
  },
  surveyCard: {
    width: '100%',
    maxWidth: '480px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    padding: '32px 24px'
  },
  progressBarWrapper: {
    width: '100%',
    height: '6px',
    background: 'var(--surface-active)',
    borderRadius: '3px',
    marginBottom: '20px',
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    background: 'var(--accent)',
    transition: 'width 0.3s ease-in-out'
  },
  counterText: {
    color: 'var(--text-muted)',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '8px',
    textTransform: 'uppercase'
  },
  questionTitle: {
    color: 'var(--text-primary)',
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
    color: 'var(--text-primary)',
    fontSize: '15px',
    border: '1px solid var(--border-strong)',
    borderRadius: '10px',
    transition: 'all 0.15s ease',
    outline: 'none'
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    padding: '4px',
    outline: 'none',
    transition: 'color 0.2s'
  },
  alertBox: {
    background: 'var(--danger-soft)',
    border: '1px solid var(--danger)',
    color: 'var(--danger)',
    padding: '12px 20px',
    borderRadius: '8px'
  }
};