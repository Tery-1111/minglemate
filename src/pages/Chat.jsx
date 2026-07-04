import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './Chat.css';

// Your finalized 20 questions
const section2Questions = [
  "What's something small that instantly makes you like someone more?",
  "What's something small that instantly makes you like someone less?",
  "What's something people usually assume about you that's completely wrong?",
  "What's a word your friends would use to describe you?",
  "What's something you're lowkey proud of?",
  "What's a moment from your past that shaped you?",
  "What's something you're still trying to figure out?",
  "What kind of person catches your attention?",
  "What qualities make someone feel trustworthy?",
  "When life gets stressful, what support helps?",
  "What do you wish people appreciated more?",
  "What causes you to emotionally pull away?",
  "When you feel hurt, how do you react?",
  "What relationship dynamic brings out your best?",
  "What did you used to believe about relationships?",
  "Are there topics that should never be jokes?",
  "What creates emotional chemistry?",
  "What's something you'd secretly love to experience?",
  "If you could ask your future self one question?",
  "What conversations make you lose track of time?"
];

const FREE_QUESTIONS = 4;
const UNLOCK_THRESHOLD = 14;

export default function Chat() {
  const navigate = useNavigate();
  const { matchId } = useParams();
  const location = useLocation();
  
  // Existing state
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [s2Progress, setS2Progress] = useState(null);
  const [bothUnlocked, setBothUnlocked] = useState(false);
  
  // NEW: Pre-fill state updated from location.state
  const [newMessage, setNewMessage] = useState(location.state?.preFill || "");

  useEffect(() => {
    // Keep your loadChat/Auth logic here
    if (location.state?.preFill) {
      setNewMessage(location.state.preFill);
    }
  }, [location.state]);

  function renderMessage(msg, index) {
    const isMe = msg.sender_id === currentUser;
    const isBot = msg.is_bot;

    if (isBot) {
      const qNum = s2Progress?.last_question_sent || 0;
      const isPaywallPoint = qNum >= FREE_QUESTIONS && !bothUnlocked;

      return (
        <div key={msg.id || index} className="my-4 animate-fade-in">
          {isPaywallPoint ? (
            <div className="paywall-card bg-indigo-50 border border-indigo-200 p-4 rounded-2xl text-center">
              <p className="text-2xl">🔒</p>
              <h3 className="font-bold text-gray-900">Unlock Section 2</h3>
              <p className="text-sm text-gray-600 mt-2">Complete the journey together to reveal contact details.</p>
              <button className="mt-4 bg-[#6C63FF] text-white px-6 py-2 rounded-full text-sm" onClick={() => navigate('/payment')}>
                Unlock Now
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-start px-2">
              <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold ml-2 mb-1">MingleMate Prompt</span>
              <div className="bg-white border border-gray-100 text-gray-800 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm max-w-[90%] text-sm">
                {msg.content}
              </div>
            </div>
          )}
        </div>
      );
    }

    // UPDATED: User messages styling to match Comparison View
    return (
      <div key={msg.id || index} className="flex justify-end my-4 animate-fade-in">
        <div className="bg-[#6C63FF] text-white px-4 py-3 rounded-2xl rounded-br-none shadow-sm max-w-[90%] text-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container h-screen flex flex-col bg-gray-50">
      {/* Existing Chat UI structure */}
      <div className="flex-1 overflow-y-auto">
        {messages.map((msg, idx) => renderMessage(msg, idx))}
      </div>
      
      {/* Input Area */}
      <div className="p-4 bg-white border-t">
        <textarea 
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="w-full border rounded-xl p-2"
          placeholder="Type your response..."
        />
        {/* ... your send button ... */}
      </div>
    </div>
  );
}