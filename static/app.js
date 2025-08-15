
// app.js - client logic (pure JS)
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const uploadBtn = document.getElementById('uploadBtn');
const refreshBtn = document.getElementById('refreshBtn');
const selectedList = document.getElementById('selectedList');
const filesList = document.getElementById('filesList');
const uploadSpeedEl = document.getElementById('uploadSpeed');
const downloadSpeedEl = document.getElementById('downloadSpeed');

let selectedFiles = [];

// Handle file input selection (multiple files/folders)
fileInput.addEventListener('change', (e) => handleSelectedFiles(Array.from(e.target.files)));

// Drag & Drop handlers
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const items = e.dataTransfer.items;
  if (items) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) {
        await traverseFileTree(entry);
      }
    }
    renderSelected();
  } else {
    handleSelectedFiles(Array.from(e.dataTransfer.files));
  }
});

// Allow clicking drop zone to open file picker
dropZone.addEventListener('click', () => fileInput.click());

function handleSelectedFiles(files) {
  selectedFiles = selectedFiles.concat(files);
  renderSelected();
}

// Recursive function to read folders
async function traverseFileTree(item, path = "") {
  return new Promise((resolve) => {
    if (item.isFile) {
      item.file((file) => {
        selectedFiles.push(file);
        resolve();
      });
    } else if (item.isDirectory) {
      const reader = item.createReader();
      reader.readEntries(async (entries) => {
        for (const entry of entries) {
          await traverseFileTree(entry, path + item.name + "/");
        }
        resolve();
      });
    }
  });
}

// Render selected file list
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

// Upload logic: sequential upload
uploadBtn.addEventListener('click', async () => {
  if (!selectedFiles.length) return alert('Select files first');
  uploadBtn.disabled = true;
  const totalStart = Date.now();
  for (let i = 0; i < selectedFiles.length; i++) {
    const f = selectedFiles[i];
    const row = selectedList.children[i];
    const bar = row.querySelector('.progress > i');
    const pctText = row.querySelector('.progress .small');
    await uploadSingleFile(f, (loaded, total) => {
      const pct = Math.round((loaded / total) * 100);
      bar.style.width = pct + '%';
      pctText.textContent = `${formatBytes(loaded)} / ${formatBytes(total)} — ${pct}%`;
    }, (speed) => {
      uploadSpeedEl.textContent = formatBytes(speed) + '/s';
    });
  }
  const totalTime = (Date.now() - totalStart) / 1000;
  console.log('All uploads done in', totalTime, 's');
  selectedFiles = [];
  renderSelected();
  uploadBtn.disabled = false;
  await fetchFiles(); // auto-refresh
});

// Upload one file
function uploadSingleFile(file, onProgress, onSpeed) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('files', file);

    let lastLoaded = 0;
    let lastTime = Date.now();

    xhr.open('POST', '/api/upload', true);

    xhr.upload.onprogress = function(e) {
      if (!e.lengthComputable) return;
      const now = Date.now();
      const dt = (now - lastTime) / 1000 || 1;
      const diff = e.loaded - lastLoaded;
      const speed = diff / dt; // bytes/sec
      lastLoaded = e.loaded; lastTime = now;
      if (typeof onSpeed === 'function') onSpeed(speed);
      if (typeof onProgress === 'function') onProgress(e.loaded, e.total);
    };

    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else reject(new Error('Upload failed: ' + xhr.status));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

// Fetch files list
async function fetchFiles() {
  filesList.innerHTML = 'Loading...';
  try {
    const res = await fetch('/api/files');
    const json = await res.json();
    renderFiles(json.files || []);
  } catch (e) {
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
        <a class="download-btn" href="/api/files/${encodeURIComponent(f.id)}/download">Download</a>
      </div>`;
    filesList.appendChild(el);
  });

  // Attach preview event listeners
  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      previewFile(btn.dataset.id, btn.dataset.name);
    });
  });
}



function previewFile(fileId, fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const previewArea = document.getElementById('previewArea');
  const previewModal = document.getElementById('previewModal');

  // Show modal & loading placeholder
  previewArea.innerHTML = `<div class="preview-loading">Loading preview…</div>`;
  previewModal.style.display = 'flex';

  const fileUrl = `/api/files/${encodeURIComponent(fileId)}/download`;

  // Helper to show plain fallback
  const showFallback = () => {
    previewArea.innerHTML = `<div class="small">No preview available for this file type. <a href="${fileUrl}" target="_blank">Download</a></div>`;
  };

  // IMAGE
  if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) {
    const img = document.createElement('img');
    img.className = 'preview-media';
    img.alt = fileName;
    img.src = fileUrl;
    // remove loading when loaded, or show error
    img.onload = () => {};
    img.onerror = () => { previewArea.innerHTML = '<div class="small">Failed to load image preview.</div>'; };
    previewArea.innerHTML = ''; // clear loading
    previewArea.appendChild(img);
    return;
  }

  // VIDEO
  if (['mp4','webm','ogg'].includes(ext)) {
    const video = document.createElement('video');
    video.className = 'preview-media';
    video.controls = true;
    video.playsInline = true;
    const src = document.createElement('source');
    src.src = fileUrl;
    src.type = `video/${ext}`;
    video.appendChild(src);
    video.onloadedmetadata = () => { /* metadata loaded */ };
    video.onerror = () => { previewArea.innerHTML = '<div class="small">Failed to load video preview.</div>'; };
    previewArea.innerHTML = '';
    previewArea.appendChild(video);
    return;
  }

  // AUDIO
  if (['mp3','wav','ogg'].includes(ext)) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.width = '100%';
    const src = document.createElement('source');
    src.src = fileUrl;
    src.type = `audio/${ext}`;
    audio.appendChild(src);
    audio.onerror = () => { previewArea.innerHTML = '<div class="small">Failed to load audio preview.</div>'; };
    previewArea.innerHTML = '';
    previewArea.appendChild(audio);
    return;
  }

  // PDF
  if (ext === 'pdf') {
    const iframe = document.createElement('iframe');
    iframe.className = 'preview-iframe';
    iframe.src = fileUrl;
    iframe.onload = () => {previewArea.innerHTML = ''; };
    iframe.onerror = () => { previewArea.innerHTML = '<div class="small">Failed to load PDF preview.</div>'; };
    previewArea.innerHTML = '<div>Download to open</div>';
    previewArea.appendChild(iframe);
    return;
  }

  // TEXT / CODE
  if (['txt','log','json','js','py','css','html','md','csv'].includes(ext)) {
    fetch(fileUrl)
      .then(r => {
        if (!r.ok) throw new Error('Network response was not ok');
        return r.text();
      })
      .then(text => {
        const pre = document.createElement('pre');
        pre.className = 'preview-text';
        pre.textContent = text; // safe
        previewArea.innerHTML = '';
        previewArea.appendChild(pre);
      })
      .catch(() => {
        previewArea.innerHTML = `<div class="small">Unable to load preview. <a href="${fileUrl}" target="_blank">Download</a></div>`;
      });
    return;
  }

  //fallback
  showFallback();

}



// Close modal on click
document.getElementById('previewModal').addEventListener('click', (e) => {
  const modal = document.getElementById('previewModal');
  if (e.target !== modal) {
    return;
  }
  e.target.style.display = 'none';
});


// show a friendly fallback in the preview area
function showFallback(fileUrl) {
  const previewArea = document.getElementById('previewArea');
  // keep it safe: fileUrl should be trusted or sanitized
  previewArea.innerHTML = `
    <div class="small">
      No preview available for this file type.
      <a href="${fileUrl}" target="_blank" rel="noopener">Download</a>
    </div>`;
}





// Poll dir stats
let lastTotal = 0, lastTs = Date.now();
async function pollDirStats() {
  try {
    const r = await fetch('/api/dir-stats');
    const js = await r.json();
    const now = Date.now();
    const dt = (now - lastTs) / 1000 || 1;
    const diff = js.totalBytes - lastTotal;
    const speed = diff / dt;
    downloadSpeedEl.textContent = formatBytes(speed) + '/s';
    lastTotal = js.totalBytes; lastTs = now;
  } catch (e) {
    // ignore
  }
}

// Helpers
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatBytes(bytes){
  if (bytes === 0) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0; let n = Math.abs(bytes);
  while(n >= 1024 && i < units.length-1){ n /= 1024; i++; }
  const sign = bytes < 0 ? '-' : '';
  return sign + n.toFixed(2) + ' ' + units[i];
}

// Init
refreshBtn.addEventListener('click', fetchFiles);
fetchFiles();
setInterval(pollDirStats, 1000);
renderSelected();

document.addEventListener("DOMContentLoaded", () => {
  fetch("/connection-info")
    .then((res) => res.json())
    .then((data) => {
      document.getElementById("qrCode").src = data.qrImage;
      document.getElementById("ipLink").textContent = data.link;
      document.getElementById("ipLink").href = data.link;
    })
    .catch((err) => console.error("Failed to load connection info:", err));
});

