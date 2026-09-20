import posthog from "posthog-js";

const key = import.meta.env.VITE_POSTHOG_KEY;
const host = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let started = false;

// Call once when the app starts. Without a key (for example a build with no
// variables set), analytics stays off and nothing breaks.
export function initAnalytics() {
  if (!key || started) return;

  posthog.init(key, {
    api_host: host,
    autocapture: false,            // only record events we name ourselves
    capture_pageview: false,       // we send our own events instead
    disable_session_recording: true, // never record screens in a dating app
    person_profiles: "identified_only",
  });

  // Lets you filter real users from your own testing in PostHog.
  posthog.register({
    environment: import.meta.env.VITE_VERCEL_ENV || import.meta.env.MODE,
  });

  started = true;
}

// Send a named event, e.g. track("signup_completed").
// Never put emails, names, or message text in properties.
export function track(eventName, properties) {
  if (!started) return;
  posthog.capture(eventName, properties);
}

// Call after login with the user's ID only.
export function identifyUser(userId) {
  if (!started || !userId) return;
  posthog.identify(userId);
}

// Call on logout.
export function resetUser() {
  if (!started) return;
  posthog.reset();
}