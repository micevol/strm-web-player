'use strict';
/* Main player app logic */

(() => {
  const $ = (sel) => document.querySelector(sel);
  const treeEl = $('#tree');
  const gridEl = $('#grid');
  const dirTitle = $('#dirTitle');
  const revBadge = $('#revBadge');
  const libState = $('#libState');

  let tree = null; // full tree from server
  let currentPath = ''; // relative dir currently browsed ('' = root)
  let playingSrc = null;
  let hls = null;

  // subtitle + resume state
  let subTracks = []; // {label, el}
  let resumeTarget = null; // seconds to seek to on load
  let resumePending = false;

  /* ---------- auth guard ---------- */
  async function ensureAuth() {
    try {
      const r = await fetch('/api/auth/me');
      if (r.ok) {
        const { user } = await r.json();
        $('#username').textContent = user.username;
        $('#avatar').textContent = (user.username[0] || '?').toUpperCase();
        return true;
      }
      window.location.replace('/login.html');
      return false;
    } catch (e) {
      window.location.replace('/login.html');
      return false;
    }
  }
  $('#logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  /* ---------- helpers ---------- */
  const esc = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function encodeRelPath(rel) {
    return rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  }
  function extName(rel) {
    const seg = rel.split('/').pop() || '';
    const i = seg.lastIndexOf('.');
    return i > -1 ? seg.slice(i + 1).toLowerCase() : '';
  }

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- tree ---------- */
  function findNode(node, relPath) {
    if (!node) return null;
    if (node.path === relPath) return node;
    if (node.children) {
      for (const c of node.children) {
        const found = findNode(c, relPath);
        if (found) return found;
      }
    }
    return null;
  }

  function activeTreePath(node) {
    if (node.path === currentPath) return true;
    if (node.children) return node.children.some((c) => activeTreePath(c));
    return false;
  }

  function renderTree(node, depth = 0) {
    if (!node) return '';
    if (node.type === 'file') {
      const active = node.path === currentPath;
      return `<div class="t-node" data-file="${esc(node.path)}">
          <div class="t-row ${active ? 'active' : ''}" data-role="file" data-path="${esc(node.path)}">
            <span class="t-icon">🎬</span>
            <span class="t-label">${esc(node.name)}</span>
          </div>
        </div>`;
    }
    const hasActive = activeTreePath(node);
    const open = node.path === '' || hasActive || node.path === currentPath;
    const kids = (node.children || [])
      .map((c) => renderTree(c, depth + 1))
      .join('');
    return `<div class="t-node" data-dir="${esc(node.path)}">
        <div class="t-row ${open ? '' : ''}" data-role="dir" data-path="${esc(node.path)}">
          <span class="t-caret ${open ? 'open' : ''}">▸</span>
          <span class="t-icon">📁</span>
          <span class="t-label">${esc(node.name || '影视库')}</span>
        </div>
        ${open ? `<div class="t-children">${kids}</div>` : ''}
      </div>`;
  }

  treeEl.addEventListener('click', (e) => {
    const row = e.target.closest('.t-row');
    if (!row) return;
    const role = row.dataset.role;
    if (role === 'dir') {
      navigateDir(row.dataset.path);
    } else if (role === 'file') {
      playFile(row.dataset.path);
    }
  });

  /* ---------- browse / grid ---------- */
  async function navigateDir(rel) {
    currentPath = rel || '';
    renderGrid();
  }

  function currentDirNode() {
    return currentPath === '' ? tree : findNode(tree, currentPath);
  }

  function breadcrumb() {
    if (!currentPath) return '全部影片';
    const parts = currentPath.split('/');
    return parts.join(' / ');
  }

  function renderGrid() {
    const node = currentDirNode();
    const dirTitle2 = breadcrumb();
    dirTitle.textContent = dirTitle2;
    renderTree(tree); // keep tree highlights in sync
    if (!node) return (gridEl.innerHTML = '<div class="empty">目录为空或不存在</div>');
    const items = node.children || [];
    if (!items.length)
      return (gridEl.innerHTML = '<div class="empty">当前目录暂无内容</div>');
    const html = items
      .map((it) => {
        if (it.type === 'dir') {
          return `<div class="media-card" data-dir="${esc(it.path)}">
              <div class="thumb" style="color:var(--accent);">📁</div>
              <div class="name">${esc(it.name)}</div>
              <div class="path">目录 · ${it.children?.length || 0} 项</div>
            </div>`;
        }
        const ext = it.ext || '';
        return `<div class="media-card" data-file="${esc(it.path)}">
            <div class="thumb">🎬</div>
            <div class="name">${esc(it.name)}</div>
            <div class="path">${ext.toUpperCase()} · STRM</div>
          </div>`;
      })
      .join('');
    gridEl.innerHTML = html;
  }

  gridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.media-card');
    if (!card) return;
    if (card.dataset.dir !== undefined) navigateDir(card.dataset.dir);
    else if (card.dataset.file) playFile(card.dataset.file);
  });

  /* ---------- player ---------- */
  function stopPlayer() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    const host = $('#videoHost');
    host.innerHTML = '';
    subTracks = [];
    resumeTarget = null;
    resumePending = false;
    $('#subMenu').innerHTML = '';
    $('#subTools').style.display = 'none';
  }

  /* ---------- subtitle helpers ---------- */
  function toVttText(text, ext) {
    let t = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!/^WEBVTT/.test(t)) t = 'WEBVTT\n' + t;
    return t;
  }

  function clearSubMenu() {
    $('#subMenu').innerHTML = '';
  }

  function addTrackLabel(item) {
    const div = document.createElement('div');
    div.className = 'sub-item' + (item.live ? ' active' : '');
    div.dataset.idx = item.idx;
    div.innerHTML = '<span class="sub-flag">' + (item.local ? '本地上传' : (item.lang || 'sidecar')) + '</span><span>' + esc(item.label) + '</span>';
    $('#subMenu').appendChild(div);
  }

  function refreshSubMenu(video) {
    clearSubMenu();
    const none = $('#subMenu');
    const off = document.createElement('div');
    off.className = 'sub-item' + (subTracks.length === 0 || !subTracks.some((t) => t.el.track && t.el.track.mode === 'showing') ? ' active' : '');
    off.dataset.idx = -1;
    off.innerHTML = '<span class="sub-flag">-</span><span>关闭字幕</span>';
    none.appendChild(off);
    subTracks.forEach((t, i) => {
      const live = t.el.track && t.el.track.mode === 'showing';
      addTrackLabel({ idx: i, label: t.label, local: t.local, lang: t.lang, live });
    });
  }

  function initSubMenu(video) {
    const btn = $('#subMenuBtn');
    const menu = $('#subMenu');
    btn.onclick = (ev) => {
      ev.stopPropagation();
      menu.classList.toggle('open');
      refreshSubMenu(video);
    };
    document.addEventListener('click', (ev) => {
      if (!menu.contains(ev.target)) menu.classList.remove('open');
    });
    menu.onclick = (ev) => {
      const it = ev.target.closest('.sub-item');
      if (!it) return;
      const idx = parseInt(it.dataset.idx, 10);
      selectSubtitle(video, idx);
      menu.classList.remove('open');
    };
    $('#subFile').onchange = (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (['srt', 'vtt', 'ass', 'ssa', 'smi'].indexOf(ext) === -1) {
        toast('不支持的字幕格式：' + ext, true);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = toVttText(String(reader.result || ''), ext);
        const blob = new Blob([text], { type: 'text/vtt' });
        const url = URL.createObjectURL(blob);
        const t = document.createElement('track');
        t.kind = 'subtitles';
        t.label = f.name;
        t.default = true;
        video.appendChild(t);
        t.track.mode = 'showing';
        subTracks.push({ label: f.name, el: t, local: true });
        refreshSubMenu(video);
        toast('已加载本地字幕：' + f.name);
      };
      reader.readAsText(f);
      ev.target.value = '';
    };
    $('#subFile').onclick = (ev) => ev.stopPropagation();
  }

  function selectSubtitle(video, idx) {
    if (idx === -1) {
      subTracks.forEach((t) => { if (t.el.track) t.el.track.mode = 'disabled'; });
    } else if (subTracks[idx]) {
      subTracks.forEach((t) => { if (t.el.track) t.el.track.mode = 'disabled'; });
      const t = subTracks[idx];
      if (t.el.track) t.el.track.mode = 'showing';
      else t.el.addEventListener('load', () => (t.el.track.mode = 'showing'));
    }
    refreshSubMenu(video);
  }

  /* ---------- resume memory ---------- */
  function saveProgress(rel, time) {
    if (!rel) return;
    try {
      fetch('/api/progress', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: rel, time: Math.max(0, Math.round(time || 0)) }),
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function clearProgress(rel) {
    if (!rel) return;
    try {
      fetch('/api/progress', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: rel }),
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(ss) : m + ':' + pad(ss);
  }

  function fetchResume(rel, video) {
    resumeTarget = null;
    resumePending = false;
    fetch('/api/progress?path=' + encodeURIComponent(rel))
      .then((r) => r.json())
      .then((d) => {
        if (d.item && d.item.time > 15) {
          resumeTarget = d.item.time;
          resumePending = true;
          const seek = () => {
            const dur = (video.duration && isFinite(video.duration)) ? video.duration : Infinity;
            if (resumePending && isFinite(dur) && resumeTarget < dur - 5) {
              try { video.currentTime = resumeTarget; toast('已续播至 ' + fmtTime(resumeTarget)); } catch (e) {}
            }
            resumePending = false;
          };
          if (video.readyState >= 1) seek();
          else video.addEventListener('loadedmetadata', seek, { once: true });
        }
      })
      .catch(() => {});
  }

  function bindProgressSave(video, rel) {
    let lastSave = 0;
    $('#resumeBar') && ($('#resumeBar').onclick = () => {
      if (resumeTarget && rel === playingSrc) {
        try { video.currentTime = resumeTarget; } catch (e) {}
      }
    });
    video.addEventListener('timeupdate', () => {
      if (!video.seekable || video.seeking) return;
      const now = video.currentTime;
      if (now - lastSave >= 5) { lastSave = now; saveProgress(rel, now); }
      // tell server periodically even when seeking via UI
    });
    video.addEventListener('pause', () => saveProgress(rel, video.currentTime));
    video.addEventListener('ended', () => {
      clearProgress(rel);
      toast('播放完成，进度已清除');
    });
    window.addEventListener('beforeunload', () => saveProgress(rel, video.currentTime), { once: false });
  }

  function showPlayer(rel, title) {
    const host = $('#videoHost');
    host.innerHTML = '';
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.autoplay = true;
    host.appendChild(video);
    subTracks = [];
    resumeTarget = null;
    resumePending = false;
    $('#subMenu').innerHTML = '';
    $('#subTools').style.display = 'flex';
    bindProgressSave(video, rel);
    fetchResume(rel, video);
    return video;
  }

  function playFile(rel) {
    if (playingSrc === rel) return;
    stopPlayer();
    $('#browseView').style.display = 'none';
    $('#playerView').style.display = 'block';
    const node = findNode(tree, rel);
    const title = (node && node.name) || rel.split('/').pop();
    $('#playTitle').textContent = title;
    $('#playPath').textContent = rel;
    $('#playerSectionTitle').textContent = '正在播放 · ' + (node?.name || '');

    const ext = extName(rel);
    const src = '/api/stream/' + encodeRelPath(rel);
    const video = showPlayer(rel, title);
    initSubMenu(video);
    // auto-load sidecar subtitles from same dir
    if (node && node.subtitles && node.subtitles.length) {
      node.subtitles.forEach((s) => {
        const t = document.createElement('track');
        t.kind = 'subtitles';
        t.label = (s.name || '').replace(/\.[^.]+$/, '');
        t.srclang = 'und';
        t.src = '/api/subtitle/' + encodeRelPath(s.path || rel);
        video.appendChild(t);
        subTracks.push({ label: t.label, el: t, local: false, lang: 'sidecar' });
      });
    }
    refreshSubMenu(video);

    video.src = src;
    playingSrc = rel;

    // prefer HLS.js for m3u8 streams
    const isM3U8 = ext === 'm3u8' || ext === 'strm';
    if (window.Hls && Hls.isSupported()) {
      video.removeAttribute('src');
      hls = new Hls({ maxBufferLength: 40 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (data.fatal) {
          toast('HLS 播放出错：' + (data.details || 'Unknown'), true);
          stopPlayer();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    }

    window.scrollTo(0, 0);
  }

  /* ---------- SSE live update ---------- */
  function connectSSE() {
    if (!window.EventSource) return;
    const es = new EventSource('/api/events');
    es.addEventListener('open', () => (libState.textContent = '实时同步'));
    es.onerror = () => (libState.textContent = '重连中…');
    es.addEventListener('message', (e) => {
      try {
        const { revision } = JSON.parse(e.data);
        revBadge.textContent = 'rev ' + revision;
        if (revision === undefined) return;
      } catch (err) { /* heartbeat */ }
    });
  }

  /* ---------- boot ---------- */
  async function boot() {
    const ok = await ensureAuth();
    if (!ok) return;
    try {
      const r = await fetch('/api/browse');
      const data = await r.json();
      tree = data.tree;
      revBadge.textContent = 'rev ' + (tree.revision || 0);
      renderGrid();
      if (typeof window.EventSource === 'function') connectSSE();
    } catch (e) {
      gridEl.innerHTML = '<div class="empty">加载影视库失败，请刷新重试</div>';
    }

    // refresh on updates: re-fetch tree then re-render (keeps current browsing)
    setInterval(async () => {
      try {
        const r = await fetch('/api/browse');
        const data = await r.json();
        tree = data.tree;
        revBadge.textContent = 'rev ' + (tree.revision || 0);
        renderTree(tree);
        renderNodeOnly();
        if (typeof window.EventSource !== 'function') resize();
      } catch (e) { /* transient */ }
    }, 15000);

    function renderNodeOnly() {
      const node = currentDirNode();
      if (node) {
        // refresh grid content in place without disturbing player
        renderGridSafe();
      }
    }
    window._renderNodeOnly = renderNodeOnly;
  }

  function renderGridSafe() {
    // lightweight: only re-render grid if no item is playing from a hidden path
    renderGrid();
  }

  window.addEventListener('resize', () => {});
  boot();
})();