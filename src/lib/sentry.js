import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN;

// Call this once when the app starts.
// If there is no DSN (for example on your laptop), Sentry stays off.
export function initSentry() {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_VERCEL_ENV || import.meta.env.MODE,

    // MingleMate is a dating app, so keep user data out of error reports.
    sendDefaultPii: false,

    // Only record performance data for 10% of visits (keeps you inside the free limit).
    tracesSampleRate: 0.1,

    // Ignore harmless browser noise.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelayed notifications",
    ],

    // Last cleanup before anything leaves the browser:
    // keep only the user's ID, and drop cookies and headers.
    beforeSend(event) {
      if (event.user) {
        event.user = { id: event.user.id };
      }
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
}

// Call after login so errors show which user hit them (ID only, no email or name).
export function setSentryUser(userId) {
  Sentry.setUser(userId ? { id: userId } : null);
}

export function clearSentryUser() {
  Sentry.setUser(null);
}

export { Sentry };