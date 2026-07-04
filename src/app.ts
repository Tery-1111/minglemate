const PRODUCTION_URL = "https://minglemate.vercel.app";

async function initializeOneSignal() {
  if (window.location.origin !== PRODUCTION_URL) {
    console.warn("OneSignal initialization skipped for development domain.");
    return;
  }
  
  // Existing OneSignal init logic
  try {
    await OneSignal.init({ appId: "YOUR_APP_ID" });
  } catch (error) {
    console.error("OneSignal failed to start", error);
  }
}

initializeOneSignal();
