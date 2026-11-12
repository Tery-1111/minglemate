import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { section1Questions as CAMPUS_QUESTIONS } from '../data/section1Questions';
import { normalizeStoredAnswers } from '../lib/section1';

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
  // Whether the row was already complete when the screen opened. A retake
  // edits an existing full answer set; saving one changed answer must not
  // drop the profile out of the matching pool until it reaches the end again.
  const [wasComplete, setWasComplete] = useState(false);

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

        setWasComplete(Boolean(profile?.section1_complete));

        if (profile?.section1_complete && !isRetake) {
          // Already completed: continue to Discover per the app flow.
          navigate('/discover');
          return;
        }

        // Answers are stored by position: slot i is question i + 1, and the
        // scoring engine reads the same positions. Project whatever row is
        // stored onto a full 50-slot array so a short row cannot shift an
        // answer onto a neighbouring question, and so legacy integer values
        // (now text such as '0') are not mistaken for real answers.
        const { data: responseRow } = await supabase
          .from('user_responses')
          .select('responses_array')
          .eq('user_id', user.id)
          .maybeSingle();

        setAnswers(normalizeStoredAnswers(responseRow?.responses_array, CAMPUS_QUESTIONS));

        // Resume at the saved pointer, clamped to a real question so a legacy
        // out-of-range value cannot render a blank card. A retake always
        // starts at question 1: its purpose is reviewing the answers, and a
        // completed row's pointer is the LAST question.
        const savedPointer = Number(profile?.section1_progress ?? 0);
        const resumeAt = isRetake
          ? 0
          : Math.min(Math.max(savedPointer, 0), CAMPUS_QUESTIONS.length - 1);
        setCurrent(resumeAt);
      } catch (err) {
        console.error("Survey sync disruption:", err);
        setError("We couldn't load your questionnaire. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    restoreSurveyProgress();
  }, [navigate, isRetake]);

  const handleSelectOption = async (optionIndex) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);

    // OPTIMISTIC (safe): the selection is shown instantly — the chosen
    // option lights up before any network round trip. The save is
    // awaited; on failure we keep the user's answer on screen (never
    // silently revert) and surface a retryable error.
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
          // 50 (not the last index) once every question has been saved, so the
          // pointer means "questions answered" and a resume never lands on a
          // finished questionnaire's final card.
          section1_progress: isSurveyFinished ? CAMPUS_QUESTIONS.length : nextStepIndex,
          section1_complete: isSurveyFinished || (isRetake && wasComplete),
          section1_last_edited: new Date().toISOString()
        })
        .eq('id', userId);

      if (userUpdateError) throw userUpdateError;

      setError(null);

      // 3. Routing navigation pipeline logic
      if (isSurveyFinished) {
        // Onboarding order: Algorithm Questionnaire → Guided-Question
        // Questionnaire (Section 2) → Discover. A retake is an edit started
        // from Profile, so it returns there instead of re-entering onboarding.
        navigate(isRetake ? '/profile' : '/section2');
      } else {
        // TRANSFORMATION: advance after the save is confirmed — the
        // selected option visibly holds its state through the save,
        // then the next question slides in (see .s1-question-enter).
        setCurrent(nextStepIndex);
      }
    } catch (err) {
      console.error("Answer upload crash execution:", err);
      // ROLLBACK (input-preserving): keep the optimistic selection so
      // the user's choice is never lost; the error is retryable by
      // simply tapping the same option again.
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
        {/* Progress bar — width animates; the percentage is ALSO text
            so progress never depends on motion alone. */}
        <div
          style={styles.progressBarWrapper}
          role="progressbar"
          aria-valuenow={current + 1}
          aria-valuemin={1}
          aria-valuemax={CAMPUS_QUESTIONS.length}
        >
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

        <h2 key={current} style={styles.questionTitle} className="s1-question-enter">{currentQuestion?.text}</h2>

        {/* Options Stack Grid Selection — selection feedback is
            instant (optimistic); saving is communicated separately so
            a slow network never looks like a dead button. */}
        <div style={styles.optionsContainer}>
          {currentQuestion?.options.map((option, idx) => {
            const isSelected = answers[current] === option;
            return (
              <button
                key={idx}
                disabled={isSaving}
                aria-pressed={isSelected}
                onClick={() => handleSelectOption(idx)}
                style={{
                  ...styles.optionButton,
                  background: isSelected ? 'var(--accent-soft)' : 'var(--surface-raised)',
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border-strong)',
                  boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                  cursor: isSaving ? 'wait' : 'pointer',
                  opacity: isSaving && !isSelected ? 0.6 : 1
                }}
              >
                {option}
              </button>
            );
          })}
        </div>

        {isSaving && (
          <p style={styles.savingNote} role="status">Saving your answer…</p>
        )}
        {!isSaving && error && (
          <p style={styles.errorNote} role="alert">{error}</p>
        )}

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
  savingNote: {
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '600',
    textAlign: 'center',
    margin: '0 0 8px'
  },
  errorNote: {
    color: 'var(--danger)',
    fontSize: '13px',
    fontWeight: '600',
    textAlign: 'center',
    margin: '0 0 8px'
  },
  alertBox: {
    background: 'var(--danger-soft)',
    border: '1px solid var(--danger)',
    color: 'var(--danger)',
    padding: '12px 20px',
    borderRadius: '8px'
  }
};