# MingleMate

MingleMate is a matchmaking web app that pairs people through a guided, conversational onboarding flow and weekly curated matches.

## Features

- **Guided onboarding** — profile setup, photo upload, and interests collected step by step, with a bot-driven question flow (`Section1` / `Section2`)
- **Weekly matching** — a Supabase Edge Function (`run-weekly-matching`) computes matches on a schedule
- **Match chat** — real conversation view with contact details blurred behind a paywall
- **Payments** — checkout and verification handled by the `initiate-payment` and `payment-callback` edge functions
- **Push notifications** — OneSignal web push, with player IDs linked to user rows and delivery via the `send-notification` edge function
- **Admin panel** — internal view at `/admin` for managing the app

## Tech Stack

- [Vite](https://vite.dev/) + [React 19](https://react.dev/) (JavaScript)
- [React Router 7](https://reactrouter.com/) for routing
- [Supabase](https://supabase.com/) for auth, database, and edge functions
- [OneSignal](https://onesignal.com/) for web push notifications
- [Vercel](https://vercel.com/) for hosting

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (URL + anon key)
- A OneSignal app (pre-configured in `index.html`)

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file in the project root:

   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

## Available Scripts

| Command           | Description                    |
| ----------------- | ------------------------------ |
| `npm run dev`     | Start the Vite dev server      |
| `npm run build`   | Build for production           |
| `npm run preview` | Preview the production build   |
| `npm run lint`    | Run ESLint                     |

## Project Structure

```
├── index.html               # Entry point (loads OneSignal SDK)
├── src/
│   ├── App.jsx              # All routes
│   ├── main.jsx
│   ├── supabaseClient.js    # Supabase client + OneSignal helpers
│   ├── components/
│   ├── data/questions.js    # Bot conversation questions
│   ├── pages/               # One component per route
│   └── utils/
├── supabase/
│   └── functions/           # Edge functions:
│       ├── initiate-payment/
│       ├── payment-callback/
│       ├── run-weekly-matching/
│       └── send-notification/
└── vercel.json
```

## Routes

| Path              | Page                                  |
| ----------------- | ------------------------------------- |
| `/`               | Landing                               |
| `/signup`         | Sign up                               |
| `/login`          | Log in                                |
| `/profile-setup`  | Profile setup                         |
| `/photo-upload`   | Photo upload                          |
| `/interests`      | Interests                             |
| `/home`           | Home                                  |
| `/section1`       | Question flow — section 1             |
| `/section2`       | Question flow — section 2 (paywall)   |
| `/payment`        | Payment                               |
| `/profile`        | Profile                               |
| `/matches`        | Weekly matches                        |
| `/chat/:matchId`  | Chat with a match                     |
| `/admin`          | Admin panel                           |
