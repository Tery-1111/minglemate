import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as Engine from '../utils/compatibilityEngine';

const Questionnaire = ({ currentUser, targetUserId }) => {
  const [answers, setAnswers] = useState({});
  const [currentQ, setCurrentQ] = useState(1);
  const [loading, setLoading] = useState(false);

  // 1. Correct State Management: Updates answers as user progresses
  const handleAnswer = (selectedAnswer) => {
    setAnswers(prev => ({ ...prev, [currentQ]: selectedAnswer }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // 2. Data Sync: Save progress to Supabase
      const { error: syncError } = await supabase
        .from('section1_responses')
        .upsert([{ user_id: currentUser.id, answers }]);

      if (syncError) throw syncError;

      // 3. Fetch User B
      const { data: userBData, error: fetchError } = await supabase
        .from('section1_responses')
        .select('answers')
        .eq('user_id', targetUserId)
        .single();

      if (fetchError) throw fetchError;

      const userA = { id: currentUser.id, answers };
      const userB = { id: targetUserId, answers: userBData.answers };

      // 4. Validate with Engine
      const dealbreaker = Engine.hasDealbreaker(userA, userB);
      if (dealbreaker.isDealbreaker) {
        alert(`Match Incompatible: ${dealbreaker.reason}`);
        return;
      }

      // 5. Calculate & Save Results
      const scores = {
        communication: Engine.calculateCommunicationScore(userA, userB),
        conflict: Engine.calculateConflictScore(userA, userB),
        emotional: Engine.calculateEmotionalScore(userA, userB),
        expectations: Engine.calculateExpectationsScore(userA, userB),
        values: Engine.calculateValuesScore(userA, userB)
      };

      const bonus = Engine.calculateComplementaryBonus(userA, userB);

      await supabase.from('match_results').insert([{
        user_a_id: userA.id,
        user_b_id: userB.id,
        compatibility_score: { 
          scores, 
          bonus: bonus.bonus, 
          total: Object.values(scores).reduce((a, b) => a + b, 0) / 5 
        }
      }]);

      alert("Success! Match processed.");
    } catch (err) {
      console.error(err);
      alert("Error processing match.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* UI: Use currentQ to show questions 1-50 */}
      <h2>Question {currentQ}</h2>
      {/* Example interaction */}
      <button onClick={() => { handleAnswer("Option A"); setCurrentQ(c => c + 1); }}>Next</button>
      
      {currentQ === 50 && (
        <button onClick={handleSubmit} disabled={loading}>
          {loading ? "Processing..." : "Submit Assessment"}
        </button>
      )}
    </div>
  );
};

export default Questionnaire;