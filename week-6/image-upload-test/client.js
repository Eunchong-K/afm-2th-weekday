// ============================================================
// client.js — ImageKit client-side direct upload helper
// ------------------------------------------------------------
// Exposes a single global: window.ImageKitClient
//   .getAuth()           -> fetch auth params from /auth
//   .uploadFile(file, {folder, fileName, onProgress})
//                        -> direct upload to ImageKit,
//                           returns the upload response JSON
// ============================================================

(function () {
  'use strict';

  const IMAGEKIT_UPLOAD_ENDPOINT = 'https://upload.imagekit.io/api/v1/files/upload';

  /**
   * Fetch authentication parameters from the backend.
   */
  async function getAuth() {
    const res = await fetch('/auth', { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Auth request failed: ${res.status} ${res.statusText}`);
    }
    const payload = await res.json();
    if (!payload.success) {
      throw new Error(payload.message || 'Failed to get auth params');
    }
    return payload.data; // { signature, token, expire, publicKey, urlEndpoint }
  }

  /**
   * Upload a File/Blob directly to ImageKit.
   *
   * @param {File|Blob} file
   * @param {Object}   [options]
   * @param {string}   [options.fileName]   - override file name
   * @param {string}   [options.folder]     - target folder on ImageKit
   * @param {Function} [options.onProgress] - (percent: number) => void
   * @returns {Promise<Object>} ImageKit upload response
   *   (contains .url, .fileId, .name, .thumbnailUrl, ...)
   */
  async function uploadFile(file, options = {}) {
    if (!file) throw new Error('No file provided');

    const auth = await getAuth();

    const form = new FormData();
    form.append('file', file);
    form.append('fileName', options.fileName || file.name || `upload_${Date.now()}`);
    form.append('publicKey', auth.publicKey);
    form.append('signature', auth.signature);
    form.append('token', auth.token);
    form.append('expire', String(auth.expire));
    form.append('useUniqueFileName', 'true');
    if (options.folder) form.append('folder', options.folder);

    // Use XHR to expose progress events
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', IMAGEKIT_UPLOAD_ENDPOINT, true);

      if (typeof options.onProgress === 'function') {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            options.onProgress(pct);
          }
        };
      }

      xhr.onload = () => {
        let body;
        try { body = JSON.parse(xhr.responseText); } catch (_) { body = xhr.responseText; }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body);
        } else {
          const msg = (body && body.message) || `Upload failed: ${xhr.status} ${xhr.statusText}`;
          reject(new Error(msg));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload aborted'));

      xhr.send(form);
    });
  }

  // Expose as global
  window.ImageKitClient = {
    getAuth,
    uploadFile,
  };
})();
