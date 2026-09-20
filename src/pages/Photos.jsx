import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { resizeImage } from '../utils/imageResize';

// PHOTO SLOTS: exactly two — 1) Facial photo (cards/discover),
// 2) Full-body photo (opened match screen). No extra slots.
const SLOTS = [
  { key: 'facial', label: 'Facial photo', hint: 'Face photo — used on cards', type: 'facial' },
  { key: 'full_body', label: 'Full-body photo', hint: 'Shown when someone opens your match', type: 'full_body' },
];

// M1: read the file's leading bytes to confirm the declared type.
async function sniffMagic(file, bytes, offset = 0) {
  const head = new Uint8Array(await file.slice(offset, offset + bytes.length).arrayBuffer());
  return bytes.every((b, i) => head[i] === b);
}

export default function Photos() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState({}); // { facial: url, full_body: url }
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    fetchExistingPhotos();
  }, []);

  async function fetchExistingPhotos() {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      navigate('/login');
      return;
    }
    setUserId(user.id);

    const { data, error } = await supabase
      .from('photos')
      .select('photo_type, photo_url')
      .eq('user_id', user.id);

    if (!error && data) {
      const photoMap = {};
      data.forEach(item => { photoMap[item.photo_type] = item.photo_url; });
      setPhotos(photoMap);
    }
  }

  const handlePhotoUpload = async (e, slot) => {
    const file = e.target.files[0];
    if (!file) return;

    // M1: real byte sniffing — client-reported MIME types are spoofable
    const isJpeg = file.type === 'image/jpeg' && await sniffMagic(file, [0xFF, 0xD8, 0xFF]);
    const isPng  = file.type === 'image/png'  && await sniffMagic(file, [0x89, 0x50, 0x4E, 0x47]);
    const isWebp = file.type === 'image/webp' && await sniffMagic(file, [0x57, 0x45, 0x42, 0x50], 8);
    if (!isJpeg && !isPng && !isWebp) {
      setError('Only JPG, PNG, or WebP images are allowed.');
      return;
    }

    // M1: hard size cap (5 MB) — protects storage + bandwidth
    if (file.size > 5 * 1024 * 1024) {
      setError('Image is too large. Maximum size is 5 MB.');
      return;
    }

    setUploadingSlot(slot.key);
    setError(null);

    try {
      // PERF: resize + compress before upload (1200px longest edge).
      const resized = await resizeImage(file, 1200, 0.85);

      const storageFilePath = `${userId}/${slot.type}_${Date.now()}.jpg`;

      // Best-effort cleanup of the replaced object in the same slot
      if (photos[slot.type]) {
        try {
          const urlParts = photos[slot.type].split('/user-photos/');
          if (urlParts.length > 1) {
            await supabase.storage.from('user-photos').remove([urlParts[1]]);
          }
        } catch {
          // Old-photo cleanup is best-effort; upload still proceeds.
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('user-photos')
        .upload(storageFilePath, resized, { cacheControl: '3600', upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('user-photos')
        .getPublicUrl(storageFilePath);

      // Upsert the row for this slot (photos is keyed user_id+photo_type)
      const { error: dbError } = await supabase
        .from('photos')
        .upsert({
          user_id: userId,
          photo_type: slot.type,
          photo_url: publicUrl,
          display_order: slot.type === 'facial' ? 1 : 2,
        }, { onConflict: 'user_id,photo_type' });
      if (dbError) throw dbError;

      setPhotos(prev => ({ ...prev, [slot.type]: publicUrl }));
    } catch (err) {
      setError(err.message || 'Upload failed. Please try a different image.');
    } finally {
      setUploadingSlot(null);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.layoutBox}>
        <div style={styles.header}>
          <h1 style={styles.title}>Your Photos</h1>
          <p style={styles.subtitle}>Exactly two photos: a facial photo and a full-body photo.</p>
        </div>

        {error && <div style={styles.alertError}>{error}</div>}

        <div style={styles.slotList}>
          {SLOTS.map(slot => {
            const hasPhoto = !!photos[slot.type];
            const isUploading = uploadingSlot === slot.key;
            return (
              <div key={slot.key} style={styles.slotCard}>
                <div style={styles.slotPreview}>
                  {hasPhoto ? (
                    <img src={photos[slot.type]} alt={slot.label} style={styles.previewImage} />
                  ) : (
                    <div style={styles.emptyPlaceholder}>
                      <span style={styles.slotIndicator}>{slot.hint}</span>
                    </div>
                  )}
                  {isUploading && (
                    <div style={styles.overlayLoader}>
                      <span style={styles.spinnerIcon}>⏳</span>
                    </div>
                  )}
                </div>
                <div style={styles.slotMeta}>
                  <span style={styles.slotTitle}>{slot.label}</span>
                  <label style={styles.uploadTriggerLabel}>
                    {hasPhoto ? 'Replace' : 'Add Photo'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingSlot !== null}
                      onChange={(e) => handlePhotoUpload(e, slot)}
                      style={styles.hiddenNativeInput}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={() => navigate('/profile')} style={styles.actionBtn}>
          Done
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
  },
  layoutBox: {
    width: '100%',
    maxWidth: '520px',
    background: '#141414',
    border: '1px solid #262626',
    borderRadius: '16px',
    padding: '28px'
  },
  header: { marginBottom: '24px', textAlign: 'center' },
  title: { color: '#ffffff', fontSize: '22px', fontWeight: '800', margin: '0 0 6px 0' },
  subtitle: { color: '#888888', fontSize: '14px', margin: 0 },
  alertError: {
    background: 'rgba(232, 65, 107, 0.1)',
    border: '1px solid #E8416B',
    color: '#E8416B',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '13px',
    marginBottom: '20px',
    textAlign: 'center'
  },
  slotList: { display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' },
  slotCard: {
    display: 'flex',
    gap: '14px',
    background: '#1a1a1a',
    border: '1px solid #262626',
    borderRadius: '12px',
    padding: '12px'
  },
  slotPreview: {
    position: 'relative',
    width: '110px',
    height: '140px',
    borderRadius: '10px',
    overflow: 'hidden',
    flexShrink: 0
  },
  previewImage: { width: '100%', height: '100%', objectFit: 'cover' },
  emptyPlaceholder: {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    textAlign: 'center', padding: '8px'
  },
  slotIndicator: { color: '#555555', fontSize: '11px', fontWeight: '600' },
  overlayLoader: {
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  spinnerIcon: { fontSize: '20px' },
  slotMeta: {
    flex: 1, display: 'flex', flexDirection: 'column',
    justifyContent: 'center', gap: '10px'
  },
  slotTitle: { color: '#ffffff', fontSize: '15px', fontWeight: '700' },
  uploadTriggerLabel: {
    background: '#E8416B',
    color: '#ffffff',
    padding: '8px 14px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    textAlign: 'center',
    alignSelf: 'flex-start'
  },
  hiddenNativeInput: { display: 'none' },
  actionBtn: {
    width: '100%',
    background: '#E8416B',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer'
  }
};
