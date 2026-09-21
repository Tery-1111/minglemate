import './MaintenanceBanner.css'

// Top-of-app banner driven by app_settings.maintenance_message
// (public-read single-row table; empty string = banner hidden).
// Set the message via SQL as an admin or through
// admin_set_maintenance_message() — e.g.:
//   select admin_set_maintenance_message('Scheduled maintenance Sunday 02:00–03:00 EAT.');
// or, with the SQL editor signed in as an admin:
//   update app_settings set maintenance_message = '...';
export default function MaintenanceBanner({ message, onDismiss }) {
  if (!message) return null
  return (
    <div className="maintenance-banner" role="status">
      <span className="maintenance-banner-text">{message}</span>
      <button
        className="maintenance-banner-close"
        onClick={onDismiss}
        aria-label="Dismiss maintenance notice"
      >
        ×
      </button>
    </div>
  )
}
