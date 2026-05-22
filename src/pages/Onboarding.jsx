import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

// Setup local or imported Supabase client wrapper
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || '',
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''
);

export default function Onboarding() {
  const navigate = useNavigate();
  
  // Form parameters
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [bio, setBio] = useState('');
  
  // Safe async pipeline state indicators
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleOnboardingSubmit = async (e) => {
    e.preventDefault();
    
    // 🚨 ANTI-SMASHING GATE: Exit instantly if an execution cycle is already moving
    if (isSubmitting) return;

    // Lock down form inputs immediately
    setIsSubmitting(true);
    setError(null);

    try {
      // Fetch currently authenticated user session reference info
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('No valid authenticated profile session located.');

      // Push sanitized entries down to public.users table mapping metrics
      const { error: updateError } = await supabase
        .from('users')
        .update({
          full_name: fullName.trim(),
          age: parseInt(age, 10),
          gender: gender,
          looking_for: lookingFor,
          bio: bio.trim(),
          onboarding_completed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // Move forward cleanly down to questionnaire stage paths
      navigate('/section1');
    } catch (err) {
      setError(err.message || 'Failed to save onboarding selections.');
      console.error('Onboarding submission write error:', err);
      // Unlock fields exclusively if an operational crash happened so they can try again
      setIsSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.viewCard}>
        <div style={styles.headingBlock}>
          <h1 style={styles.titleText}>Tell Us About Yourself</h1>
          <p style={styles.subtext}>Set up your baseline student discoverability card</p>
        </div>

        {error && <div style={styles.alertError}>{error}</div>}

        <form onSubmit={handleOnboardingSubmit} style={styles.formContainer}>
          <div style={styles.inputCell}>
            <label style={styles.fieldLabel}>Full Name / Nickname</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g., Alex"
              required
              disabled={isSubmitting}
              style={styles.textInput}
            />
          </div>

          <div style={styles.inputCell}>
            <label style={styles.fieldLabel}>Age</label>
            <input
              type="number"
              min="18"
              max="30"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Your age"
              required
              disabled={isSubmitting}
              style={styles.textInput}
            />
          </div>

          <div style={styles.inputCell}>
            <label style={styles.fieldLabel}>Your Gender</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              required
              disabled={isSubmitting}
              style={styles.selectInput}
            >
              <option value="" disabled>Select gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>

          <div style={styles.inputCell}>
            <label style={styles.fieldLabel}>Looking For</label>
            <select
              value={lookingFor}
              onChange={(e) => setLookingFor(e.target.value)}
              required
              disabled={isSubmitting}
              style={styles.selectInput}
            >
              <option value="" disabled>Select match type</option>
              <option value="male">Males</option>
              <option value="female">Females</option>
              <option value="everyone">Everyone</option>
            </select>
          </div>

          <div style={styles.inputCell}>
            <label style={styles.fieldLabel}>Campus Bio (Max 150 chars)</label>
            <textarea
              maxLength={150}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Interests, major, favorite spots around campus..."
              required
              disabled={isSubmitting}
              style={styles.textareaInput}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.continueBtn,
              opacity: isSubmitting ? 0.6 : 1,
              cursor: isSubmitting ? 'not-allowed' : 'pointer'
            }}
          >
            {isSubmitting ? 'Saving Framework...' : 'Save & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0a0a',
    padding: '24px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
  },
  viewCard: {
    width: '100%',
    maxWidth: '440px',
    background: '#141414',
    border: '1px solid #262626',
    borderRadius: '16px',
    padding: '32px 24px'
  },
  headingBlock: {
    marginBottom: '28px'
  },
  titleText: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '800',
    margin: '0 0 6px 0'
  },
  subtext: {
    color: '#888888',
    fontSize: '14px',
    margin: 0
  },
  alertError: {
    background: 'rgba(232, 65, 107, 0.1)',
    border: '1px solid #E8416B',
    color: '#E8416B',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '14px',
    marginBottom: '20px'
  },
  formContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px'
  },
  inputCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  fieldLabel: {
    color: '#cccccc',
    fontSize: '13px',
    fontWeight: '500'
  },
  textInput: {
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#ffffff',
    fontSize: '15px',
    outline: 'none'
  },
  selectInput: {
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#ffffff',
    fontSize: '15px',
    outline: 'none'
  },
  textareaInput: {
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#ffffff',
    fontSize: '15px',
    outline: 'none',
    minHeight: '80px',
    resize: 'vertical',
    fontFamily: 'inherit'
  },
  continueBtn: {
    background: '#E8416B',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontSize: '15px',
    fontWeight: '700',
    marginTop: '12px',
    transition: 'opacity 0.2s'
  }
};