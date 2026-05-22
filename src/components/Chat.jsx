import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Chat({ matchId, matchWeekId }) {
  const [messages, setMessages] = useState([]);
  const [progress, setProgress] = useState({ contacts_unlocked: false });

  // 1. Initial Load: Get messages and progress status
  useEffect(() => {
    const loadData = async () => {
      // Get chat progress
      const { data: prog } = await supabase
        .from('section2_chat_progress')
        .select('contacts_unlocked')
        .eq('match_week_id', matchWeekId)
        .single();
      if (prog) setProgress(prog);

      // Get messages
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('match_week_id', matchWeekId)
        .order('sent_at', { ascending: true });
      if (msgs) setMessages(msgs);
    };
    loadData();
  }, [matchWeekId]);

  // 2. Realtime Listener: Updates when new messages or progress changes
  useEffect(() => {
    const channel = supabase.channel('chat_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_week_id=eq.${matchWeekId}` }, 
        (payload) => setMessages((prev) => [...prev, payload.new]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'section2_chat_progress', filter: `match_week_id=eq.${matchWeekId}` },
        (payload) => setProgress(payload.new))
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [matchWeekId]);

  // 3. Helper: Blur text if contact info detected AND contacts NOT yet unlocked
  const formatMessage = (msg) => {
    if (progress.contacts_unlocked || msg.is_bot) return msg.content;
    
    // Regex to find phone numbers (e.g., 0712345678) or emails
    const contactRegex = /(\d{10})|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    return msg.content.replace(contactRegex, '██████████');
  };

  return (
    <div className="chat-container">
      {/* Contact Reveal Card */}
      {progress.contacts_unlocked && (
        <div className="reveal-card">
          <h3>🎉 Connection Unlocked!</h3>
          <p>You can now see each other's contact information.</p>
        </div>
      )}

      {/* Message Feed */}
      <div className="messages-list">
        {messages.map((m) => (
          <div key={m.id} className={m.is_bot ? 'bot-bubble' : 'user-bubble'}>
            {formatMessage(m)}
          </div>
        ))}
      </div>
    </div>
  );
}