# Section 1 question → dimension mapping review

Grouping reproduced from the `category` field in `src/data/section1Questions.js`. Question text and answer options are verbatim.

## Communication (Q1-10)

| Q | Question | Option 1 | Option 2 | Option 3 | Option 4 |
|---|---|---|---|---|---|
| 1 | How do you prefer to communicate when getting to know someone? | In person | Text messages | Phone calls | Video calls |
| 2 | How often do you like to stay in touch during a busy day? | Several times | Once or twice | Only when needed | At the end of the day |
| 3 | What makes you feel most heard in a conversation? | Eye contact | Thoughtful questions | Helpful advice | A caring response |
| 4 | How do you usually show someone that you care? | Spend time together | Offer practical help | Give encouraging words | Remember small details |
| 5 | How comfortable are you discussing personal topics? | Very comfortable | Usually comfortable | Comfortable with trust | I need plenty of time |
| 6 | What conversation style do you enjoy most? | Deep and thoughtful | Light and playful | Balanced | Focused on shared interests |
| 7 | How do you prefer to receive feedback? | Directly | Gently | With specific examples | After some time to reflect |
| 8 | When you are excited about something, what do you do? | Tell someone immediately | Share it online | Wait for the right moment | Show it through my energy |
| 9 | What do you do when a conversation becomes awkward? | Make a joke | Ask a new question | Acknowledge the awkwardness | Give the conversation space |
| 10 | How important is honesty in everyday communication? | Essential at all times | Important but considerate | Important for serious matters | It depends on the situation |

## Conflict (Q11-20)

| Q | Question | Option 1 | Option 2 | Option 3 | Option 4 |
|---|---|---|---|---|---|
| 11 | What is your first response when a disagreement begins? | Talk it through | Take a short break | Listen before responding | Try to find common ground |
| 12 | How quickly do you prefer to resolve a disagreement? | Immediately | Within the same day | After everyone cools down | When a solution feels clear |
| 13 | What helps you stay calm during conflict? | Quiet reflection | Clear facts | A reassuring tone | Physical space |
| 14 | How do you react when you realize you were wrong? | Apologize right away | Explain my perspective | Take time to process | Ask how to make it right |
| 15 | What do you need from someone after an argument? | A sincere apology | A calm conversation | Time alone | A reassuring gesture |
| 16 | Which approach feels most constructive during a disagreement? | Focus on the issue | Share feelings openly | Look for a compromise | Agree to revisit it later |
| 17 | How do you handle frustration with someone you care about? | Discuss it directly | Write down my thoughts | Ask for support | Wait until I feel calmer |
| 18 | What makes an apology meaningful to you? | Taking responsibility | Showing understanding | Changing the behavior | Making amends |
| 19 | How comfortable are you setting boundaries during conflict? | Very comfortable | Usually comfortable | I am still learning | Only when necessary |
| 20 | What should never happen during a disagreement? | Insults | Shouting | Ignoring the issue | Threatening to leave |

## Emotional (Q21-30)

| Q | Question | Option 1 | Option 2 | Option 3 | Option 4 |
|---|---|---|---|---|---|
| 21 | How do you usually process difficult emotions? | Talk to someone | Spend time alone | Write or create | Stay active |
| 22 | What helps you feel emotionally supported? | Being listened to | Physical affection | Practical help | Words of encouragement |
| 23 | How openly do you express your feelings? | Very openly | With trusted people | Mostly through actions | Only when necessary |
| 24 | What usually lifts your mood? | Time with friends | Music or entertainment | Exercise or movement | Quiet time |
| 25 | How do you respond when someone close to you is upset? | Listen quietly | Offer comfort | Ask what they need | Help solve the problem |
| 26 | What makes you feel most appreciated? | A thoughtful message | Quality time | A small surprise | Recognition of my effort |
| 27 | How important is emotional availability in a relationship? | Essential | Very important | Important with balance | It develops over time |
| 28 | When you feel overwhelmed, what do you prefer? | Company | Space | A clear plan | Gentle encouragement |
| 29 | How do you celebrate good news? | Share it with others | Plan something fun | Enjoy a quiet moment | Express gratitude |
| 30 | What builds emotional trust for you? | Consistency | Vulnerability | Keeping promises | Respecting boundaries |

## Expectations (Q31-40)

| Q | Question | Option 1 | Option 2 | Option 3 | Option 4 |
|---|---|---|---|---|---|
| 31 | What do you expect from a healthy relationship? | Mutual support | Shared growth | Fun and companionship | Trust and stability |
| 32 | How much time would you ideally spend with a partner each week? | Most days | Several times | Once or twice | A flexible amount |
| 33 | What role should personal space play in a relationship? | A daily priority | Regularly available | Only when needed | Shared routines matter more |
| 34 | How do you prefer to make plans? | Plan well ahead | Plan a few days ahead | Decide spontaneously | Use a mix of both |
| 35 | What does reliability mean to you? | Keeping every promise | Being present when needed | Communicating changes | Following through on priorities |
| 36 | How should responsibilities be shared? | Equally | Based on strengths | Based on availability | Discussed as needs change |
| 37 | What pace feels right when developing a relationship? | Fast and exciting | Steady and intentional | Slow and careful | Let it develop naturally |
| 38 | How important are shared interests? | Very important | Helpful but not essential | A few are enough | Different interests are exciting |
| 39 | What kind of support do you expect during stressful times? | Practical assistance | Emotional reassurance | Respect for my space | A combination of these |
| 40 | How should important decisions be made? | Together | By whoever is most affected | After independent reflection | Through open discussion |

## Values (Q41-50)

| Q | Question | Option 1 | Option 2 | Option 3 | Option 4 |
|---|---|---|---|---|---|
| 41 | Which quality matters most in a close relationship? | Kindness | Loyalty | Honesty | Respect |
| 42 | What does success mean to you? | Achieving goals | Having meaningful relationships | Making a positive impact | Living with balance |
| 43 | How important is personal growth? | A lifelong priority | Very important | Important when needed | I value contentment more |
| 44 | What principle guides your decisions most often? | Do what is right | Protect the people I love | Pursue what matters | Keep commitments |
| 45 | How do you prefer to contribute to your community? | Volunteer time | Support people directly | Share skills | Donate resources |
| 46 | What place does family have in your life? | At the center | Very important | Important with boundaries | It depends on the family |
| 47 | How do you define respect? | Listening carefully | Honoring boundaries | Treating people fairly | Valuing differences |
| 48 | What kind of life feels most fulfilling? | Adventurous | Peaceful | Purposeful | Connected |
| 49 | How important is financial responsibility? | A top priority | Very important | Important but flexible | Less important than experiences |
| 50 | What do you hope people remember about you? | My kindness | My courage | My achievements | The joy I shared |

## Engine check

| Dimension | Engine question range (`compatibilityEngine.ts:52-58`) | Equals bank grouping |
|---|---|---|
| Communication | Q1-10 (`index + 1`) | YES |
| Conflict | Q11-20 (`index + 11`) | YES |
| Emotional | Q21-30 (`index + 21`) | YES |
| Expectations | Q31-40 (`index + 31`) | YES |
| Values | Q41-50 (`index + 41`) | YES |

## Sign-off

| Q | Dimension | Will: OK / MOVE TO ___ |
|---|---|---|
| 1 | Communication | |
| 2 | Communication | |
| 3 | Communication | |
| 4 | Communication | |
| 5 | Communication | |
| 6 | Communication | |
| 7 | Communication | |
| 8 | Communication | |
| 9 | Communication | |
| 10 | Communication | |
| 11 | Conflict | |
| 12 | Conflict | |
| 13 | Conflict | |
| 14 | Conflict | |
| 15 | Conflict | |
| 16 | Conflict | |
| 17 | Conflict | |
| 18 | Conflict | |
| 19 | Conflict | |
| 20 | Conflict | |
| 21 | Emotional | |
| 22 | Emotional | |
| 23 | Emotional | |
| 24 | Emotional | |
| 25 | Emotional | |
| 26 | Emotional | |
| 27 | Emotional | |
| 28 | Emotional | |
| 29 | Emotional | |
| 30 | Emotional | |
| 31 | Expectations | |
| 32 | Expectations | |
| 33 | Expectations | |
| 34 | Expectations | |
| 35 | Expectations | |
| 36 | Expectations | |
| 37 | Expectations | |
| 38 | Expectations | |
| 39 | Expectations | |
| 40 | Expectations | |
| 41 | Values | |
| 42 | Values | |
| 43 | Values | |
| 44 | Values | |
| 45 | Values | |
| 46 | Values | |
| 47 | Values | |
| 48 | Values | |
| 49 | Values | |
| 50 | Values | |
