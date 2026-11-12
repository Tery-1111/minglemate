/**
 * Authoritative question bank for Section 2 questionnaire.
 * 20 questions with predefined selectable answers.
 * This is the single source of truth for:
 *   - The standalone Section 2 questionnaire (Section2.jsx)
 *   - The partner answer presentation in Match Detail
 *
 * Format: { id, category, text, options }
 * IDs: 1-20, sequential
 * Exactly four options per question
 * All option values are complete strings (never A/B/C/D indices)
 */

export const section2Questions = [
  {
    id: 1,
    category: 'Initial Connection',
    text: 'When getting to know someone new, what are you usually most curious to discover about them?',
    options: [
      'Their personality and sense of humour.',
      'Their interests, hobbies and favourite activities.',
      'Their background and life experiences.',
      'Their dreams, ambitions and future plans.',
    ],
  },
  {
    id: 2,
    category: 'Personality & Quirks',
    text: 'What\'s one thing about your personality that people usually notice once they get to know you?',
    options: [
      'I\'m naturally funny and love making people laugh.',
      'I\'m quiet at first, but become very talkative when comfortable.',
      'I\'m adventurous and always up for trying something new.',
      'I\'m thoughtful and enjoy meaningful conversations.',
    ],
  },
  {
    id: 3,
    category: 'Personal Growth',
    text: 'If you could wake up tomorrow with one new ability or quality, what would it be and why?',
    options: [
      'Fluency in a new language.',
      'Greater confidence in social situations.',
      'More time in the day.',
      'Deeper empathy for others.',
    ],
  },
  {
    id: 4,
    category: 'Campus Exploration',
    text: 'What\'s something you\'ve always wanted to try on campus but haven\'t, and what\'s stopping you?',
    options: [
      'Join a student club or organization.',
      'Attend a campus event or performance.',
      'Take a class outside my major.',
      'Study abroad or exchange program.',
    ],
  },
  {
    id: 5,
    category: 'Ideal Day',
    text: 'What does a perfect day on campus look like for you? Include academics, social life, and personal time.',
    options: [
      'Early morning study followed by campus lunch with friends.',
      'Balanced mix of classes, sports, and relaxation.',
      'All social events and no academics.',
      'Solo time with a good book or project.',
    ],
  },
  {
    id: 6,
    category: 'Social Life & Friendship',
    text: 'What do you enjoy most when spending time with friends?',
    options: [
      'Going out and exploring new places.',
      'Having long conversations about anything and everything.',
      'Laughing, joking and doing silly things together.',
      'Relaxing and enjoying each other\'s company.',
    ],
  },
  {
    id: 7,
    category: 'Music & Entertainment',
    text: 'Which kind of entertainment do you enjoy most when you want to switch off and relax?',
    options: [
      'Listening to music or discovering new artists.',
      'Watching movies, series or documentaries.',
      'Playing video games or following gaming content.',
      'Watching sports, comedy or live performances.',
    ],
  },
  {
    id: 8,
    category: 'Spending Time with Someone You Admire',
    text: 'If you could spend an evening doing something with someone you admire, what would you enjoy most?',
    options: [
      'Having an interesting conversation and exchanging ideas.',
      'Learning a skill or getting advice from them.',
      'Sharing a fun experience or adventure.',
      'Watching them perform or seeing them do what they\'re famous for.',
    ],
  },
  {
    id: 9,
    category: 'Food & Eating Habits',
    text: 'Which best describes your relationship with food?',
    options: [
      'I enjoy trying unfamiliar dishes and exploring new flavours.',
      'I prefer familiar meals and my favourite comfort foods.',
      'I love street food and discovering affordable local spots.',
      'I enjoy visiting different restaurants and food places.',
    ],
  },
  {
    id: 10,
    category: 'Opinions & Conversations',
    text: 'Which subject could keep you talking for hours without getting bored?',
    options: [
      'Music, movies and entertainment.',
      'Technology, science and how things work.',
      'History, culture and interesting world events.',
      'Sports, competition and current happenings.',
    ],
  },
  {
    id: 11,
    category: 'Spontaneity',
    text: 'Someone suddenly suggests doing something unplanned. What\'s your most likely reaction?',
    options: [
      'I\'m in! I love spontaneous adventures.',
      'Depends on what we\'re doing and where we\'re going.',
      'I\'d rather know the plan before committing.',
      'I usually prefer sticking to what I had planned.',
    ],
  },
  {
    id: 12,
    category: 'Love & Affection',
    text: 'How do you naturally show someone that you care about them?',
    options: [
      'Through thoughtful gestures and little surprises.',
      'By spending quality time with them.',
      'Through compliments, encouragement and kind words.',
      'By helping them and being there when they need me.',
    ],
  },
  {
    id: 13,
    category: 'Enjoying Free Time',
    text: 'What\'s your idea of a fun way to spend an unexpected free evening?',
    options: [
      'Going out with friends and exploring somewhere new.',
      'Watching a good movie or series.',
      'Listening to music, relaxing or enjoying personal time.',
      'Finding something exciting or spontaneous to do.',
    ],
  },
  {
    id: 14,
    category: 'Humour Boundaries',
    text: 'What, if anything, is too serious to joke about? Where\'s your boundary?',
    options: [
      'Never joke about serious topics.',
      'Everything is fair game if done with kindness.',
      'Only respectful, lighthearted humour.',
      'Depends on who is in the room.',
    ],
  },
  {
    id: 15,
    category: 'Discovering New Places',
    text: 'If you had a free afternoon to explore somewhere new, where would you most likely go?',
    options: [
      'A scenic outdoor location or nature spot.',
      'A lively town centre with interesting shops and activities.',
      'A café, restaurant or food destination.',
      'An event, exhibition or entertainment venue.',
    ],
  },
  {
    id: 16,
    category: 'Attraction & First Impressions',
    text: 'What usually catches your attention when you meet someone for the first time?',
    options: [
      'Their confidence and personality.',
      'Their sense of humour and ability to make me laugh.',
      'Their appearance and personal style.',
      'Their intelligence and the way they express themselves.',
    ],
  },
  {
    id: 17,
    category: 'Personal Preferences',
    text: 'Which of these little things would make an ordinary day more enjoyable for you?',
    options: [
      'Discovering a really good song.',
      'Finding an interesting place or experience.',
      'Enjoying a delicious meal.',
      'Having an unexpected but enjoyable conversation.',
    ],
  },
  {
    id: 18,
    category: 'Digital Interests',
    text: 'What do you find yourself spending the most time exploring online?',
    options: [
      'Memes, comedy and entertaining content.',
      'Educational videos, interesting facts and tutorials.',
      'Music, movies and celebrity content.',
      'News, discussions and current affairs.',
    ],
  },
  {
    id: 19,
    category: 'Personal Style',
    text: 'Which best describes how you usually approach fashion and personal style?',
    options: [
      'I enjoy keeping up with trends and experimenting with new looks.',
      'I prefer a simple, comfortable and casual style.',
      'I have my own distinctive style and don\'t follow trends much.',
      'I dress differently depending on my mood and occasion.',
    ],
  },
  {
    id: 20,
    category: 'Building Connections',
    text: 'What makes you enjoy talking to someone and want to keep getting to know them?',
    options: [
      'We can joke around and laugh without forcing anything.',
      'We have interesting conversations and share ideas.',
      'We have similar interests and enjoy doing things together.',
      'I feel comfortable being myself around them.',
    ],
  },
];