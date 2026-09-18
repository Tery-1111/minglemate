import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { resizeImage } from '../utils/imageResize';

// Define 6 static grid slots for the profile layout
const TOTAL_SLOTS = [1, 2, 3, 4, 5, 6];

export default function Photos() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState({}); // Mapping layout: { 1: "url1", 2: "url2" }
  const [uploadingSlot, setUploadingSlot] = useState(null); // Tracks active loading state per slot
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    async function fetchExistingPhotos() {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        navigate('/login');
        return;
      }
      setUserId(user.id);

      // Extract existing pictures associated with this student profile
      const { data, error } = await supabase
        .from('user_photos')
        .select('slot_key, photo_url')
        .eq('user_id', user.id);

      if (!error && data) {
        // Transform the vertical database rows into a localized key-value state dictionary
        const photoMap = {};
        data.forEach(item => {
          photoMap[item.slot_key] = item.photo_url;
        });
        setPhotos(photoMap);
      }
    }
    fetchExistingPhotos();
  }, []);

// M1: read the file's leading bytes to confirm the declared type.
// offset lets WebP skip its 8-byte RIFF header.
async function sniffMagic(file, bytes, offset = 0) {
  const head = new Uint8Array(await file.slice(offset, offset + bytes.length).arrayBuffer());
  return bytes.every((b, i) => head[i] === b);
}

  const handlePhotoUpload = async (e, slotKey) => {
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

    setUploadingSlot(slotKey); // Lock down the targeted cell loader spinner
    setError(null);

    try {
      // PERF: resize + compress before upload. UI displays photos at
      // ≤300px; storing originals (3–6 MB phone shots) wasted ~20x
      // storage/bandwidth. Capped at 1200px longest edge, JPEG q0.85.
      const resized = await resizeImage(file, 1200, 0.85);

      const storageFilePath = `${userId}/${slotKey}_${Date.now()}.jpg`;

      // 🚨 AUTOMATED CLEANUP MECHANISM
      // If a photo already exists in this target slot key, strip it from the storage bucket first
      if (photos[slotKey]) {
        try {
          // Parse out the relative object file path out of the absolute public URL string
          // URL footprint format: .../storage/v1/object/public/profile_photos/USER_ID/SLOT_KEY_TIMESTAMP.jpg
          const urlParts = photos[slotKey].split('/profile_photos/');
          if (urlParts.length > 1) {
            const oldStoragePath = urlParts[1];
            // Execute absolute target object deletion from the cloud storage system
            await supabase.storage
              .from('profile_photos')
              .remove([oldStoragePath]);
            // L1: path logging removed from prod output
          }
        } catch (cleanupErr) {
          // Old-photo cleanup is best-effort; upload still proceeds.
        }
      }

      // 1. Ship new asset binary chunks up to your profile bucket
      const { error: uploadError } = await supabase.storage
        .from('profile_photos')
        .upload(storageFilePath, resized, { cacheControl: '3600', upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      // 2. Extract structural public URL tracking route location references
      const { data: { publicUrl } } = supabase.storage
        .from('profile_photos')
        .getPublicUrl(storageFilePath);

      // 3. TARGETED DATABASE UPDATE: Upsert entry referencing explicit grid coordinates
      const { error: dbError } = await supabase
        .from('user_photos')
        .upsert({
          user_id: userId,
          slot_key: slotKey,
          photo_url: publicUrl,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id, slot_key' });

      if (dbError) throw dbError;

      // 4. Update state cleanly without affecting neighboring card coordinates
      setPhotos(prev => ({
        ...prev,
        [slotKey]: publicUrl
      }));

    } catch (err) {
      setError(err.message || 'Upload failed. Please try a different image.');
      // L1: no console output in prod bundles
    } finally {
      setUploadingSlot(null); // Release interface interaction controls
    }
  };

  const handleNextStep = () => {
    // Safety check: Enforce at least a primary profile avatar inside Slot 1
    if (!photos[1]) {
      setError('Profile Slot 1 serves as your main profile card image. You must upload a photo here to continue.');
      return;
    }
    navigate('/dashboard');
  };

  return (
    <div style={styles.container}>
      <div style={styles.layoutBox}>
        <div style={styles.header}>
          <h1 style={styles.title}>Build Your Media Grid</h1>
          <p style={styles.subtitle}>Slot 1 will serve as your primary radar search discovery avatar</p>
        </div>

        {error && <div style={styles.alertError}>{error}</div>}

        {/* 6-Card Layout Grid Container mapping */}
        <div style={styles.photoGrid}>
          {TOTAL_SLOTS.map((slot) => {
            const hasPhoto = !!photos[slot];
            const isCurrentUploading = uploadingSlot === slot;

            return (
              <div key={slot} style={styles.gridCard}>
                {hasPhoto ? (
                  <img src={photos[slot]} alt={`Profile media slot ${slot}`} style={styles.previewImage} />
                ) : (
                  <div style={styles.emptyPlaceholder}>
                    <span style={styles.slotIndicator}>{slot === 1 ? '⭐ Main' : `Slot ${slot}`}</span>
                  </div>
                )}

                {isCurrentUploading && (
                  <div style={styles.overlayLoader}>
                    <span style={styles.spinnerIcon}>⏳</span>
                  </div>
                )}

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
            );
          })}
        </div>

        <button onClick={handleNextStep} style={styles.actionBtn}>
          Finalize & Save Grid
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
  header: {
    marginBottom: '24px',
    textAlign: 'center'
  },
  title: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '800',
    margin: '0 0 6px 0'
  },
  subtitle: {
    color: '#888888',
    fontSize: '14px',
    margin: 0
  },
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
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '14px',
    marginBottom: '28px'
  },
  gridCard: {
    position: 'relative',
    background: '#1a1a1a',
    border: '1px dashed #333333',
    borderRadius: '12px',
    aspectRatio: '3 / 4',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  previewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  emptyPlaceholder: {
    textAlign: 'center',
    padding: '8px'
  },
  slotIndicator: {
    color: '#555555',
    fontSize: '12px',
    fontWeight: '600'
  },
  overlayLoader: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  spinnerIcon: {
    fontSize: '20px'
  },
  uploadTriggerLabel: {
    position: 'absolute',
    bottom: '8px',
    background: 'rgba(26, 26, 26, 0.85)',
    border: '1px solid #333333',
    color: '#ffffff',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)'
  },
  hiddenNativeInput: {
    display: 'none'
  },
  actionBtn: {
    width: '100%',
    background: '#E8416B',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background 0.2s'
  }
};