import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './PhotoUpload.css'

export default function PhotoUpload() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState({
    full_body_1: null,
    full_body_2: null,
    facial_1: null,
    facial_2: null
  })
  const [previews, setPreviews] = useState({
    full_body_1: null,
    full_body_2: null,
    facial_1: null,
    facial_2: null
  })

  const slots = [
    { key: 'full_body_1', label: 'Full Body Photo 1', type: 'full_body' },
    { key: 'full_body_2', label: 'Full Body Photo 2', type: 'full_body' },
    { key: 'facial_1',   label: 'Facial Close-up 1', type: 'facial' },
    { key: 'facial_2',   label: 'Facial Close-up 2', type: 'facial' },
  ]

  async function convertToJpeg(file) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        canvas.toBlob((blob) => {
          resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.85)
      }
      img.src = URL.createObjectURL(file)
    })
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
      setError('Please upload all 4 photos.')
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
        display_order: parseInt(slot.key.split('_').pop())
      })
    }

    setLoading(false)
    navigate('/interests')
  }

  return (
    <div className="photo-container">
      <div className="photo-card">
        <h2 className="photo-title">Upload Your Photos</h2>
        <p className="photo-subtitle">
          All 4 photos are required. Be clear and visible.
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
          {Object.values(photos).filter(Boolean).length} of 4 photos uploaded
        </p>
      </div>
    </div>
  )
}