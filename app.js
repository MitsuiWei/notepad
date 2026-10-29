/* 記事本 — 筆記儲存在 GitHub 私人倉庫 notes/notes.json，透過 GitHub API 讀寫 */
(() => {
  'use strict';
  const CFG = { owner: 'MitsuiWei', repo: 'notepad-notes', path: 'notes/notes.json', branch: 'main' };
  const LS = { token: 'np.token', cache: 'np.cache', dirty: 'np.dirty', current: 'np.current' };
  const $ = (id) => document.getElementById(id);
  const el = {
    app: document.querySelector('.app'), list: $('noteList'), search: $('search'), newBtn: $('newBtn'),
    title: $('title'), body: $('body'), preview: $('preview'), previewBtn: $('previewBtn'),
    deleteBtn: $('deleteBtn'), backBtn: $('backBtn'), meta: $('meta'), count: $('count'), empty: $('empty'),
    status: $('status'), statusText: $('statusText'), settings: $('settings'), settingsBtn: $('settingsBtn'),
    token: $('token'), testBtn: $('testBtn'), testResult: $('testResult'), clearTokenBtn: $('clearTokenBtn'),
    saveTokenBtn: $('saveTokenBtn'),
  };
  const state = {
    notes: [], sha: null, currentId: null, token: '', dirty: false, deletedIds: [],
    previewing: false, pushTimer: null, pushing: false, pushQueued: false,
  };

  // ---------- helpers ----------
  const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => new Date().toISOString();
  const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('zh-TW', { hour12: false }); };
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const b64enc = (str) => {
    const bytes = new TextEncoder().encode(str); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64dec = (b64) => {
    const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };
  const setStatus = (cls, text) => { el.status.className = 'status ' + cls; el.statusText.textContent = text; };
  const apiUrl = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' + CFG.path;
  const headers = (tok) => ({ Authorization: 'Bearer ' + (tok || state.token), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const byUpdated = (a, b) => (b.updated > a.updated ? 1 : -1);
  const sorted = () => [...state.notes].sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || byUpdated(a, b));
  const current = () => state.notes.find((n) => n.id === state.currentId) || null;
  // 舊資料沒有 order 欄位時，依更新時間補上（手動排序的起點）
  function ensureOrder() {
    if (state.notes.every((n) => typeof n.order === 'number')) return false;
    [...state.notes].sort(byUpdated).forEach((n, i) => { n.order = i; });
    return true;
  }

  // ---------- local cache ----------
  function saveLocal() {
    lsSet(LS.cache, JSON.stringify({ notes: state.notes, sha: state.sha, deletedIds: state.deletedIds }));
    lsSet(LS.dirty, state.dirty ? '1' : '0');
  }
  function loadLocal() {
    try {
      const c = JSON.parse(lsGet(LS.cache, 'null'));
      if (c && Array.isArray(c.notes)) { state.notes = c.notes; state.sha = c.sha || null; state.deletedIds = c.deletedIds || []; }
    } catch (e) { /* ignore */ }
    state.dirty = lsGet(LS.dirty, '0') === '1';
    state.token = lsGet(LS.token, '');
    state.currentId = lsGet(LS.current, null);
    if (ensureOrder()) { state.dirty = true; saveLocal(); }
  }

  // ---------- GitHub sync ----------
  async function fetchRemote() {
    const r = await fetch(apiUrl + '?ref=' + CFG.branch + '&t=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (r.status === 404) return { sha: null, notes: [] };
    if (!r.ok) throw new Error('GitHub 讀取失敗 (' + r.status + ')');
    const j = await r.json();
    let notes = [];
    try { notes = JSON.parse(b64dec(j.content) || '[]'); } catch (e) { notes = []; }
    if (!Array.isArray(notes)) notes = [];
    return { sha: j.sha, notes };
  }
  async function pullRemote() {
    if (!state.token) return;
    setStatus('busy', '從 GitHub 載入…');
    const remote = await fetchRemote();
    state.sha = remote.sha;
    if (state.dirty) {
      // 本機有未同步變更：依 updated 較新者合併，刪除的筆記不再復活，然後推回去
      const map = new Map(remote.notes.map((n) => [n.id, n]));
      for (const n of state.notes) { const r0 = map.get(n.id); if (!r0 || n.updated >= r0.updated) map.set(n.id, n); }
      for (const id of state.deletedIds) map.delete(id);
      state.notes = [...map.values()];
      saveLocal();
      await pushRemote();
    } else {
      state.notes = remote.notes;
      saveLocal();
      if (ensureOrder()) schedulePush(500);
    }
  }
  async function pushRemote(retry = true) {
    if (!state.token) { state.dirty = true; saveLocal(); setStatus('warn', '未連接 GitHub，僅存於本機'); return; }
    if (state.pushing) { state.pushQueued = true; return; }
    state.pushing = true;
    setStatus('busy', '同步到 GitHub…');
    try {
      const body = {
        message: '更新筆記 ' + new Date().toLocaleString('zh-TW', { hour12: false }),
        content: b64enc(JSON.stringify(state.notes, null, 2) + '\n'),
        branch: CFG.branch,
      };
      if (state.sha) body.sha = state.sha;
      const r = await fetch(apiUrl, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 409 || r.status === 422) {
        if (!retry) throw new Error('版本衝突 (' + r.status + ')，請重新整理');
        const g = await fetchRemote().catch(() => ({ sha: null }));
        state.sha = g.sha;
        state.pushing = false;
        return pushRemote(false);
      }
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('GitHub 寫入失敗 (' + r.status + ') ' + t.slice(0, 120)); }
      const j = await r.json();
      state.sha = j.content.sha;
      state.dirty = false; state.deletedIds = [];
      saveLocal();
      setStatus('ok', '已同步 ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    } catch (e) {
      state.dirty = true; saveLocal();
      setStatus('err', e.message || '同步失敗');
      console.error(e);
    } finally {
      state.pushing = false;
      if (state.pushQueued) { state.pushQueued = false; schedulePush(300); }
    }
  }
  function schedulePush(delay = 1500) {
    state.dirty = true; saveLocal();
    if (!state.token) { setStatus('warn', '未連接 GitHub，僅存於本機'); return; }
    setStatus('busy', '等待同步…');
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(pushRemote, delay);
  }
  async function testToken(tok) {
    const r = await fetch('https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo, { headers: headers(tok) });
    if (!r.ok) throw new Error(r.status === 401 ? 'Token 無效' : r.status === 404 ? '找不到倉庫，或 Token 沒有此倉庫的權限' : '錯誤 ' + r.status);
    const j = await r.json();
    if (!j.permissions || !j.permissions.push) throw new Error('Token 沒有寫入權限（Contents 需設為 Read and write）');
    return true;
  }

  // ---------- rendering ----------
  function renderList() {
    const q = el.search.value.trim().toLowerCase();
    const items = sorted().filter((n) => !q || (n.title + '\n' + n.body).toLowerCase().includes(q));
    el.list.classList.toggle('filtered', !!q);
    el.list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li'); li.className = 'none';
      li.textContent = q ? '沒有符合的筆記' : '還沒有筆記，按「＋ 新增」開始';
      el.list.appendChild(li); return;
    }
    for (const n of items) {
      const li = document.createElement('li');
      li.dataset.id = n.id;
      if (n.id === state.currentId) li.classList.add('active');
      const snippet = (n.body || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      li.innerHTML = '<span class="h" title="拖曳排序">⋮⋮</span><span class="c"><span class="t">' + esc(n.title || '（無標題）') + '</span><span class="s">' + esc(fmt(n.updated)) + (snippet ? ' · ' + esc(snippet) : '') + '</span></span>';
      li.addEventListener('click', () => { if (!state.suppressClick) open(n.id); });
      el.list.appendChild(li);
    }
  }
  function renderEditor() {
    const n = current();
    if (!n) { el.empty.classList.remove('hidden'); el.app.classList.remove('show-editor'); return; }
    el.empty.classList.add('hidden');
    if (document.activeElement !== el.title) el.title.value = n.title;
    if (document.activeElement !== el.body) el.body.value = n.body;
    el.meta.textContent = '建立 ' + fmt(n.created) + ' · 更新 ' + fmt(n.updated);
    el.count.textContent = n.body.length + ' 字';
    if (state.previewing) el.preview.innerHTML = md(n.body);
  }
  function open(id) {
    state.currentId = id; lsSet(LS.current, id);
    el.app.classList.add('show-editor');
    renderList(); renderEditor();
    if (window.innerWidth > 720) el.body.focus();
  }

  // ---------- 簡易 Markdown ----------
  function md(src) {
    const lines = esc(src).split('\n'); const out = [];
    let inCode = false, inList = null, inQuote = false;
    const inline = (s) => s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    const closeList = () => { if (inList) { out.push('</' + inList + '>'); inList = null; } };
    const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };
    for (const raw of lines) {
      if (/^```/.test(raw)) { closeList(); closeQuote(); out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue; }
      if (inCode) { out.push(raw); continue; }
      let m;
      if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) { closeList(); closeQuote(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(raw)) { closeList(); closeQuote(); out.push('<hr>'); continue; }
      if ((m = raw.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/))) {
        closeQuote(); if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
        out.push('<li><input type="checkbox" disabled ' + (m[1] !== ' ' ? 'checked' : '') + '>' + inline(m[2]) + '</li>'); continue;
      }
      if ((m = raw.match(/^\s*[-*+]\s+(.*)$/))) { closeQuote(); if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if ((m = raw.match(/^\s*\d+[.)]\s+(.*)$/))) { closeQuote(); if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if ((m = raw.match(/^&gt;\s?(.*)$/))) { closeList(); if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push('<p>' + inline(m[1]) + '</p>'); continue; }
      closeList(); closeQuote();
      if (raw.trim() === '') { out.push(''); continue; }
      out.push('<p>' + inline(raw) + '</p>');
    }
    if (inCode) out.push('</code></pre>');
    closeList(); closeQuote();
    return out.join('\n');
  }

  // ---------- actions ----------
  function createNote() {
    const minOrder = state.notes.length ? Math.min(...state.notes.map((x) => x.order ?? 0)) : 1;
    const n = { id: uid(), title: '', body: '', created: now(), updated: now(), order: minOrder - 1 };
    state.notes.push(n);
    open(n.id);
    el.title.focus();
    schedulePush();
  }
  function editCurrent(patch) {
    const n = current(); if (!n) return;
    Object.assign(n, patch, { updated: now() });
    renderList(); renderEditor();
    schedulePush();
  }
  function deleteCurrent() {
    const n = current(); if (!n) return;
    if (!confirm('確定刪除「' + (n.title || '（無標題）') + '」？')) return;
    state.notes = state.notes.filter((x) => x.id !== n.id);
    state.deletedIds.push(n.id);
    state.currentId = null; lsDel(LS.current);
    renderList(); renderEditor();
    schedulePush(300);
  }
  function togglePreview(force) {
    state.previewing = typeof force === 'boolean' ? force : !state.previewing;
    el.previewBtn.classList.toggle('on', state.previewing);
    el.body.classList.toggle('hidden', state.previewing);
    el.preview.classList.toggle('hidden', !state.previewing);
    renderEditor();
  }

  // ---------- 拖曳排序（Pointer Events；拖曳項目浮起跟隨指標，其他項目以 FLIP 動畫讓位） ----------
  let drag = null;
  const listItems = () => [...el.list.querySelectorAll('li[data-id]')];
  function positionDragged(clientY) {
    // 用 offsetTop 取得排版位置（不受 transform 動畫影響）
    const layoutTop = el.list.getBoundingClientRect().top + drag.li.offsetTop - el.list.scrollTop;
    drag.ty = clientY - drag.grabOffset - layoutTop;
    drag.li.style.transform = 'translateY(' + drag.ty + 'px) scale(1.03)';
  }
  function reorderDom(clientY) {
    const others = listItems().filter((x) => x !== drag.li);
    const visualCenter = clientY - drag.grabOffset + drag.h / 2;
    let target = null;
    for (const it of others) { const r = it.getBoundingClientRect(); if (visualCenter < r.top + r.height / 2) { target = it; break; } }
    const nextNow = drag.li.nextElementSibling;
    if (target === nextNow || (target === null && nextNow === null)) return; // 位置沒變
    // FLIP：記錄 First（目前視覺位置）
    const first = new Map(others.map((it) => [it, it.getBoundingClientRect().top]));
    if (target) el.list.insertBefore(drag.li, target); else el.list.appendChild(drag.li);
    for (const it of others) { it.style.transition = 'none'; it.style.transform = ''; }
    const moving = [];
    for (const it of others) {
      const d = first.get(it) - it.getBoundingClientRect().top;
      if (Math.abs(d) > 0.5) { it.style.transform = 'translateY(' + d + 'px)'; moving.push(it); }
    }
    void el.list.offsetHeight; // 強制 reflow，讓 Invert 生效
    for (const it of others) it.style.transition = '';
    for (const it of moving) it.style.transform = '';
  }
  el.list.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.h'); if (!h) return;
    if (el.search.value.trim()) return; // 搜尋中不允許排序
    const li = h.closest('li[data-id]'); if (!li) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    drag = { li, startY: e.clientY, grabOffset: e.clientY - r.top, h: r.height, ty: 0, moved: false, pointerId: e.pointerId };
    try { li.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  el.list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.startY) < 4) return;
      drag.moved = true;
      drag.li.classList.add('dragging', 'lifting');   // 浮起：放大 + 陰影
      setTimeout(() => { if (drag && drag.li) drag.li.classList.remove('lifting'); }, 140);
    }
    const lr = el.list.getBoundingClientRect();
    if (e.clientY < lr.top + 36) el.list.scrollTop -= 10; else if (e.clientY > lr.bottom - 36) el.list.scrollTop += 10;
    positionDragged(e.clientY);
    reorderDom(e.clientY);
    positionDragged(e.clientY); // DOM 換位後排版位置改變，重算位移讓它留在指標下
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    state.suppressClick = true; setTimeout(() => { state.suppressClick = false; }, 0);
    listItems().forEach((li, i) => { const n = state.notes.find((x) => x.id === li.dataset.id); if (n) n.order = i; });
    // 落下：滑回定位、縮回原大小，動畫結束後重繪清單
    d.li.classList.remove('lifting'); d.li.classList.add('settling');
    d.li.style.transform = 'translateY(0) scale(1)';
    setTimeout(() => {
      d.li.classList.remove('dragging', 'settling'); d.li.style.transform = '';
      for (const it of listItems()) { it.style.transform = ''; it.style.transition = ''; }
      renderList();
    }, 200);
    schedulePush();
  };
  el.list.addEventListener('pointerup', endDrag);
  el.list.addEventListener('pointercancel', endDrag);

  // ---------- 字體 / 字級 / 顏色（存在此瀏覽器） ----------
  const FONTS = {
    system: '',
    'noto-sans': '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
    'noto-serif': '"Noto Serif TC", "Songti TC", "PMingLiU", serif',
    maru: '"Zen Maru Gothic", "Noto Sans TC", sans-serif',
    wenkai: '"LXGW WenKai TC", "Noto Serif TC", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans TC", monospace',
  };
  const STYLE_DEFAULT = { font: 'system', size: 16, color: '' };
  const styleEl = { btn: $('styleBtn'), panel: $('stylePanel'), font: $('fontSel'), size: $('sizeRange'), sizeVal: $('sizeVal'), swatches: $('swatches'), pick: $('colorPick'), reset: $('styleReset') };
  let noteStyle = { ...STYLE_DEFAULT };
  try { noteStyle = { ...STYLE_DEFAULT, ...JSON.parse(lsGet('np.style', '{}')) }; } catch (e) { /* ignore */ }
  function applyStyle() {
    const root = document.documentElement.style;
    if (FONTS[noteStyle.font]) root.setProperty('--note-font', FONTS[noteStyle.font]); else root.removeProperty('--note-font');
    root.setProperty('--note-size', noteStyle.size + 'px');
    if (noteStyle.color) root.setProperty('--note-color', noteStyle.color); else root.removeProperty('--note-color');
    styleEl.font.value = noteStyle.font in FONTS ? noteStyle.font : 'system';
    styleEl.size.value = noteStyle.size; styleEl.sizeVal.textContent = noteStyle.size;
    for (const b of styleEl.swatches.querySelectorAll('.sw')) b.classList.toggle('on', b.dataset.color === noteStyle.color);
    if (noteStyle.color) styleEl.pick.value = noteStyle.color;
    lsSet('np.style', JSON.stringify(noteStyle));
  }
  styleEl.btn.addEventListener('click', (e) => { e.stopPropagation(); styleEl.panel.classList.toggle('hidden'); styleEl.btn.classList.toggle('on', !styleEl.panel.classList.contains('hidden')); });
  styleEl.panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { styleEl.panel.classList.add('hidden'); styleEl.btn.classList.remove('on'); });
  styleEl.font.addEventListener('change', () => { noteStyle.font = styleEl.font.value; applyStyle(); });
  styleEl.size.addEventListener('input', () => { noteStyle.size = Number(styleEl.size.value); applyStyle(); });
  styleEl.swatches.addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (!b) return; noteStyle.color = b.dataset.color; applyStyle(); });
  styleEl.pick.addEventListener('input', () => { noteStyle.color = styleEl.pick.value; applyStyle(); });
  styleEl.reset.addEventListener('click', () => { noteStyle = { ...STYLE_DEFAULT }; applyStyle(); });
  applyStyle();

  // ---------- events ----------
  el.newBtn.addEventListener('click', createNote);
  el.search.addEventListener('input', renderList);
  el.title.addEventListener('input', () => editCurrent({ title: el.title.value }));
  el.body.addEventListener('input', () => editCurrent({ body: el.body.value }));
  el.body.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = el.body.selectionStart, t = el.body.selectionEnd;
      el.body.setRangeText('  ', s, t, 'end');
      editCurrent({ body: el.body.value });
    }
  });
  el.deleteBtn.addEventListener('click', deleteCurrent);
  el.previewBtn.addEventListener('click', () => togglePreview());
  el.backBtn.addEventListener('click', () => { el.app.classList.remove('show-editor'); });
  el.settingsBtn.addEventListener('click', () => { el.token.value = state.token; el.testResult.textContent = ''; el.settings.returnValue = ''; el.settings.showModal(); });
  el.testBtn.addEventListener('click', async () => {
    el.testResult.textContent = '測試中…';
    try { await testToken(el.token.value.trim()); el.testResult.textContent = '✅ 連線成功，具寫入權限'; }
    catch (e) { el.testResult.textContent = '❌ ' + e.message; }
  });
  el.clearTokenBtn.addEventListener('click', () => { el.token.value = ''; });
  el.settings.addEventListener('cancel', () => { el.settings.returnValue = 'cancel'; });
  el.settings.addEventListener('close', async () => {
    if (el.settings.returnValue === 'cancel') return;
    const tok = el.token.value.trim();
    if (tok === state.token) return;
    state.token = tok;
    if (tok) lsSet(LS.token, tok); else lsDel(LS.token);
    await boot(false);
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); clearTimeout(state.pushTimer); pushRemote(); }
    if (k === 'e') { e.preventDefault(); togglePreview(); }
  });
  window.addEventListener('beforeunload', (e) => { if (state.dirty && state.token) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('online', () => { if (state.dirty) schedulePush(500); });

  // ---------- boot ----------
  async function boot(first) {
    if (first) loadLocal();
    $('repoName').textContent = CFG.owner + '/' + CFG.repo;
    $('repoName2').textContent = CFG.owner + '/' + CFG.repo;
    renderList(); renderEditor();
    if (!state.token) { setStatus('warn', '未連接 GitHub（點 ⚙️ 設定 Token）'); return; }
    try {
      await pullRemote();
      if (state.currentId && !current()) state.currentId = null;
      renderList(); renderEditor();
      if (!state.dirty) setStatus('ok', '已同步');
    } catch (e) {
      console.error(e);
      setStatus('err', e.message);
    }
  }
  boot(true);
})();
