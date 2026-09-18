import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { section1Questions as CAMPUS_QUESTIONS } from '../data/section1Questions';

export default function Section1() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0); // Clean 0-indexed default assignment array scale
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

        // Fetch current questionnaire status profiles
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('section1_progress, section1_complete')
          .eq('id', user.id)
          .single();

        if (profileError) throw profileError;

        if (profile?.section1_complete) {
          navigate('/dashboard');
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
        navigate('/photos');
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
        {/* Progress Matrix Indicator Bar */}
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