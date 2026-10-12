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
  }

  function showPlayer(rel, title) {
    const host = $('#videoHost');
    host.innerHTML = '';
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.autoplay = true;
    host.appendChild(video);
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
      // Safari native HLS
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