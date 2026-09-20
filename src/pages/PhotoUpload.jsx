import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { resizeImage } from '../utils/imageResize'
import './PhotoUpload.css'

export default function PhotoUpload() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState({
    facial: null,
    full_body: null
  })
  const [previews, setPreviews] = useState({
    facial: null,
    full_body: null
  })

  // Exactly two photo slots per the product spec:
  // Photo 1 = facial photo, Photo 2 = full-body photo.
  const slots = [
    { key: 'facial', label: 'Photo 1 — Facial photo', type: 'facial', order: 1 },
    { key: 'full_body', label: 'Photo 2 — Full-body photo', type: 'full_body', order: 2 },
  ]

  // PERF: shared resize helper — caps longest edge at 1200px and
  // compresses to JPEG q0.85 (previously re-encoded at original
  // dimensions, so 12MP uploads stored at full size).
  async function convertToJpeg(file) {
    return resizeImage(file, 1200, 0.85)
  }

  function handleFileSelect(e, key) {
    const file = e.target.files[0]
    if (!file) return
    setPhotos(prev => ({ ...prev, [key]: file }))
    setPreviews(prev => ({ ...prev, [key]: URL.createObjectURL(file) }))
  }

  function removePhoto(key) {
    setPhotos(prev => ({ ...prev, [key]: null }))
    setPreviews(prev => ({ ...prev, [key]: null }))
  }

  const allUploaded = Object.values(photos).every(p => p !== null)

  async function handleSubmit() {
    if (!allUploaded) {
      setError('Please upload both photos — a facial photo and a full-body photo.')
      return
    }

    setLoading(true)
    setError('')

    // Route is wrapped in AuthGuard; session is guaranteed here.
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const userId = session.user.id

    for (const slot of slots) {
      const originalFile = photos[slot.key]
      const file = await convertToJpeg(originalFile)
      const path = `${userId}/${slot.key}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('user-photos')
        .upload(path, file, { upsert: true, contentType: 'image/jpeg' })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        setError(uploadError.message)
        setLoading(false)
        return
      }

      const { data: urlData } = supabase.storage
        .from('user-photos')
        .getPublicUrl(path)

      await supabase.from('photos').upsert({
        user_id: userId,
        photo_url: urlData.publicUrl,
        photo_type: slot.type,
        display_order: slot.order
      }, { onConflict: 'user_id,photo_type' })
    }

    setLoading(false)
    navigate('/interests')
  }

  return (
    <div className="photo-container">
      <div className="photo-card">
        <h2 className="photo-title">Upload Your Photos</h2>
        <p className="photo-subtitle">
          Both photos are required: a facial photo and a full-body photo.
        </p>

        <div className="photo-grid">
          {slots.map(slot => (
            <div key={slot.key} className="photo-slot">
              <p className="slot-label">{slot.label}</p>
              {previews[slot.key] ? (
                <div className="photo-preview-wrapper">
                  <img
                    src={previews[slot.key]}
                    alt={slot.label}
                    className="photo-preview"
                  />
                  <button
                    className="remove-btn"
                    onClick={() => removePhoto(slot.key)}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <label className="upload-label">
                  <span className="upload-icon">📷</span>
                  <span className="upload-text">Tap to upload</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="file-input"
                    onChange={e => handleFileSelect(e, slot.key)}
                  />
                </label>
              )}
            </div>
          ))}
        </div>

        {error && <p className="photo-error">{error}</p>}

        <button
          className="photo-btn"
          onClick={handleSubmit}
          disabled={!allUploaded || loading}
        >
          {loading ? 'Uploading...' : 'Continue'}
        </button>

        <p className="photo-count">
          {Object.values(photos).filter(Boolean).length} of 2 photos uploaded
        </p>
      </div>
    </div>
  )
}