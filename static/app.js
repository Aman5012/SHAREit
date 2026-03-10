// app.js - Updated with Passcode Authentication
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const uploadBtn = document.getElementById('uploadBtn');
const refreshBtn = document.getElementById('refreshBtn');
const selectedList = document.getElementById('selectedList');
const filesList = document.getElementById('filesList');
const uploadSpeedEl = document.getElementById('uploadSpeed');
const downloadSpeedEl = document.getElementById('downloadSpeed');

let selectedFiles = [];
let userPin = ""; // Stores the session passcode

// NEW: Unlock function to show content
// NEW: Unlock function to show content
window.unlockVault = function () {
  const inputs = document.querySelectorAll('.pin-digit');
  userPin = Array.from(inputs).map(input => input.value).join('');

  if (userPin.length !== 6) {
    alert("Please enter a 6-digit PIN");
    return;
  }

  // Test the pin by trying to fetch the files list
  fetch('/api/files', {
    headers: { 'x-passcode': userPin }
  })
    .then(res => {
      if (res.status === 200) {
        document.getElementById('lockScreen').style.display = 'none';
        document.getElementById('vaultContent').style.display = 'block';
        fetchFiles();
      } else {
        alert("Unauthorized: Invalid PIN");
        // Clear inputs on failure
        inputs.forEach(input => input.value = '');
        inputs[0].focus();
        userPin = ""; // STOP POLLING: Clear the stored PIN so background tasks don't keep checking
      }
    })
    .catch(err => {
      alert("Connection error. Check if server is running.");
      userPin = ""; // Clear pin on error too
    });
};

// PIN Input Logic
document.addEventListener('DOMContentLoaded', () => {
  const inputs = document.querySelectorAll('.pin-digit');
  const unlockBtn = document.getElementById('unlockBtn');

  if (unlockBtn) {
    unlockBtn.addEventListener('click', window.unlockVault);
  }

  inputs.forEach((input, index) => {
    // Handle input (typing)
    input.addEventListener('input', (e) => {
      // Allow only numbers
      input.value = input.value.replace(/[^0-9]/g, '');

      if (input.value.length > 1) {
        input.value = input.value.slice(0, 1);
      }

      // Auto-focus next
      if (input.value.length === 1) {
        if (index < inputs.length - 1) {
          inputs[index + 1].focus();
        } else {
          // If last digit, maybe focus unlock button?
          unlockBtn.focus();
        }
      }
    });

    // Handle special keys (Backspace, Arrows)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && input.value === '') {
        if (index > 0) {
          inputs[index - 1].focus();
        }
      } else if (e.key === 'ArrowLeft') {
        if (index > 0) inputs[index - 1].focus();
      } else if (e.key === 'ArrowRight') {
        if (index < inputs.length - 1) inputs[index + 1].focus();
      } else if (e.key === 'Enter') {
        window.unlockVault();
      }
    });

    // Handle Paste (optional but good UX)
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
      if (pasteData) {
        pasteData.split('').forEach((char, i) => {
          if (inputs[index + i]) inputs[index + i].value = char;
        });
        // Focus the next empty one or the last one
        const lastFilled = Math.min(index + pasteData.length, 5);
        inputs[lastFilled].focus();
      }
    });
  });
});

// --- Original Logic maintained below ---

fileInput.addEventListener('change', (e) => handleSelectedFiles(Array.from(e.target.files)));

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const items = e.dataTransfer.items;
  if (items) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) { await traverseFileTree(entry); }
    }
    renderSelected();
  } else {
    handleSelectedFiles(Array.from(e.dataTransfer.files));
  }
});

dropZone.addEventListener('click', () => fileInput.click());

function handleSelectedFiles(files) {
  selectedFiles = selectedFiles.concat(files);
  renderSelected();
}

async function traverseFileTree(item, path = "") {
  return new Promise((resolve) => {
    if (item.isFile) {
      item.file((file) => { selectedFiles.push(file); resolve(); });
    } else if (item.isDirectory) {
      const reader = item.createReader();
      reader.readEntries(async (entries) => {
        for (const entry of entries) { await traverseFileTree(entry, path + item.name + "/"); }
        resolve();
      });
    }
  });
}

function renderSelected() {
  selectedList.innerHTML = '';
  if (!selectedFiles.length) {
    selectedList.innerHTML = `<div class="small muted">No files selected</div>`;
    return;
  }
  selectedFiles.forEach((f, idx) => {
    const row = document.createElement('div'); row.className = 'file-row';
    const meta = document.createElement('div'); meta.className = 'file-meta';
    meta.innerHTML = `<div class="file-name">${escapeHtml(f.name)}</div><div class="small">${formatBytes(f.size)}</div>`;
    const right = document.createElement('div'); right.style.minWidth = '180px';
    const progress = document.createElement('div'); progress.className = 'progress';
    progress.innerHTML = `<i style="width:0%"></i><div class="small" style="margin-top:6px">0%</div>`;
    right.appendChild(progress);
    row.appendChild(meta); row.appendChild(right);
    selectedList.appendChild(row);
  });
}

// Queue Management
const CONCURRENCY = 3;

uploadBtn.addEventListener('click', async () => {
  if (!selectedFiles.length) return alert('Select files first');
  uploadBtn.disabled = true;

  const queue = [...selectedFiles];
  const totalFiles = queue.length;
  let activeUploads = 0;
  let completed = 0;

  // Map files to their row indices for progress bars
  const fileIndices = new Map();
  selectedFiles.forEach((f, i) => fileIndices.set(f, i));

  const runQueue = async () => {
    // While there are files left or active uploads
    return new Promise((resolve) => {
      const next = () => {
        if (queue.length === 0 && activeUploads === 0) {
          resolve();
          return;
        }

        while (queue.length > 0 && activeUploads < CONCURRENCY) {
          const f = queue.shift();
          activeUploads++;
          const idx = fileIndices.get(f);
          const row = selectedList.children[idx];
          const bar = row.querySelector('.progress > i');
          const pctText = row.querySelector('.progress .small');

          pctText.textContent = "Hashing..."; // Indicate hashing phase

          // Calculate Hash First
          calculateHash(f).then(hash => {
            pctText.textContent = "Uploading...";
            return uploadSingleFile(f, hash, (loaded, total) => {
              const pct = Math.round((loaded / total) * 100);
              bar.style.width = pct + '%';
              pctText.textContent = `${formatBytes(loaded)} / ${formatBytes(total)} — ${pct}%`;
            }, (speed) => {
              // Update global speed (simplified for parallel)
              uploadSpeedEl.textContent = formatBytes(speed) + '/s';
            });
          }).then(res => {
            // Success
            bar.style.backgroundColor = res.verified ? '#4caf50' : '#ff9800'; // Green if verified
            pctText.textContent = res.verified ? "Done (Verified)" : "Done (Unverified)";
          }).catch(err => {
            bar.style.backgroundColor = '#f44336';
            pctText.textContent = `Failed: ${err.message}`;
          }).finally(() => {
            activeUploads--;
            completed++;
            next();
          });
        }
      };
      next();
    });
  };

  await runQueue();

  console.log('All uploads done');
  selectedFiles = [];
  // Keep list to show status, maybe clear on next selection
  uploadBtn.disabled = false;
  await fetchFiles();
});

// SHA-256 Hash Function
async function calculateHash(file) {
  // Graceful fallback for non-secure contexts (HTTP) where crypto.subtle is undefined
  if (!window.crypto || !window.crypto.subtle) {
    console.warn("Crypto API not available (requires HTTPS). Skipping client-side hash.");
    return null;
  }
  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    console.error("Hashing failed:", e);
    return null;
  }
}

function uploadSingleFile(file, hash, onProgress, onSpeed) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('files', file);

    let lastLoaded = 0; let lastTime = Date.now();
    xhr.open('POST', '/api/upload', true);

    // UPDATED: Attach passcode and hash to upload
    xhr.setRequestHeader('x-passcode', userPin);
    if (hash) xhr.setRequestHeader('x-file-hash', hash);

    xhr.upload.onprogress = function (e) {
      if (!e.lengthComputable) return;
      const now = Date.now();
      const dt = (now - lastTime) / 1000 || 1;
      const speed = (e.loaded - lastLoaded) / dt;
      lastLoaded = e.loaded; lastTime = now;
      if (typeof onSpeed === 'function') onSpeed(speed);
      if (typeof onProgress === 'function') onProgress(e.loaded, e.total);
    };

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        let res;
        try { res = JSON.parse(xhr.responseText); } catch (e) { res = {}; }
        const info = res.results ? res.results[0] : {};
        if (info.error) {
          reject(new Error(info.error));
        } else {
          resolve(info);
        }
      }
      else {
        // Try to parse error response
        let msg = 'Upload failed';
        try {
          const errJson = JSON.parse(xhr.responseText);
          if (errJson.error) msg = errJson.error;
        } catch (e) { }
        reject(new Error(`${msg} (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

async function fetchFiles() {
  if (!userPin) return; // Wait for login
  filesList.innerHTML = 'Loading...';
  try {
    const res = await fetch('/api/files', {
      headers: { 'x-passcode': userPin }
    });
    if (res.status !== 200) throw new Error("Auth Failed");
    const json = await res.json();
    renderFiles(json.files || []);
  } catch (e) {
    // If auth failed, maybe kick to lock screen?
    if (e.message === "Auth Failed") {
      document.getElementById('lockScreen').style.display = 'block';
      document.getElementById('vaultContent').style.display = 'none';
    }
    filesList.innerHTML = 'Failed to fetch files';
  }
}

function renderFiles(list) {
  filesList.innerHTML = '';
  if (!list.length) {
    filesList.innerHTML = '<div class="small muted">No files uploaded</div>';
    return;
  }
  list.forEach(f => {
    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML = `
      <div>
        <div style="font-weight:600">${escapeHtml(f.name)}</div>
        <div class="small muted">${formatBytes(f.size)}</div>
      </div>
      <div>
        <button class="preview-btn" data-id="${encodeURIComponent(f.id)}" data-name="${escapeHtml(f.name)}">Preview</button>
        <a class="download-btn" href="/api/files/${encodeURIComponent(f.id)}/download?pin=${encodeURIComponent(userPin)}">Download</a>
      </div>`;
    filesList.appendChild(el);
  });

  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', () => { previewFile(btn.dataset.id, btn.dataset.name); });
  });
}

function previewFile(fileId, fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const previewArea = document.getElementById('previewArea');
  const previewModal = document.getElementById('previewModal');
  previewArea.innerHTML = `<div class="preview-loading">Loading preview…</div>`;
  previewModal.style.display = 'flex';

  // Pass pin in query for preview downloads
  const fileUrl = `/api/files/${encodeURIComponent(fileId)}/download?pin=${encodeURIComponent(userPin)}`;

  const showFallback = () => {
    previewArea.innerHTML = `<div class="small">No preview available. <a href="${fileUrl}" target="_blank">Download</a></div>`;
  };

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    const img = document.createElement('img');
    img.className = 'preview-media';
    img.src = fileUrl;
    img.onload = () => { previewArea.innerHTML = ''; previewArea.appendChild(img); };
    return;
  }

  if (['mp4', 'webm', 'ogg'].includes(ext)) {
    const video = document.createElement('video');
    video.className = 'preview-media'; video.controls = true;
    const src = document.createElement('source'); src.src = fileUrl;
    video.appendChild(src);
    previewArea.innerHTML = ''; previewArea.appendChild(video);
    return;
  }

  if (ext === 'pdf') {
    const iframe = document.createElement('iframe');
    iframe.className = 'preview-iframe'; iframe.src = fileUrl;
    previewArea.innerHTML = ''; previewArea.appendChild(iframe);
    return;
  }

  if (['txt', 'log', 'json', 'js', 'py', 'css', 'html', 'md'].includes(ext)) {
    fetch(fileUrl).then(r => r.text()).then(text => {
      const pre = document.createElement('pre'); pre.className = 'preview-text';
      pre.textContent = text; previewArea.innerHTML = ''; previewArea.appendChild(pre);
    });
    return;
  }
  showFallback();
}

document.getElementById('previewModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('previewModal')) e.target.style.display = 'none';
});


async function pollDirStats() {
  if (!userPin) return;
  try {
    const r = await fetch('/api/dir-stats', { headers: { 'x-passcode': userPin } });

    if (r.status === 403) {
      // Blocked!
      userPin = ""; // Stop polling
      alert("You have been temporarily blocked due to too many failed attempts.");
      return;
    }

    if (r.status !== 200) return;

    const js = await r.json();
    const now = Date.now();
    const dt = (now - lastTs) / 1000 || 1;
    downloadSpeedEl.textContent = formatBytes((js.totalBytes - lastTotal) / dt) + '/s';
    lastTotal = js.totalBytes; lastTs = now;
  } catch (e) { }
}

function escapeHtml(s) { return (s + '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = Math.abs(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (bytes < 0 ? '-' : '') + n.toFixed(2) + ' ' + units[i];
}

refreshBtn.addEventListener('click', fetchFiles);
setInterval(pollDirStats, 1000);

document.addEventListener("DOMContentLoaded", () => {
  fetch("/connection-info").then(res => res.json()).then(data => {
    document.getElementById("qrCode").src = data.qrImage;
    document.getElementById("ipLink").textContent = data.link;
    document.getElementById("ipLink").href = data.link;
  });
});