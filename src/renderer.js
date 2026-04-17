// ===== Состояние =====
let state = {
  folders: [],
  notes: [],
  currentFolderId: null,
  currentNoteId: null,
  searchQuery: '',
  saveTimer: null,
};

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const folderListEl = $('#folder-list');
const notesListEl = $('#notes-list');
const searchInput = $('#search-input');
const currentFolderNameEl = $('#current-folder-name');
const editorWrap = $('#editor-wrap');
const editorContent = $('#editor-content');
const editorDate = $('#editor-date');
const emptyState = $('#empty-state');

// ===== Утилиты =====
function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Вчера';
  if (diffDays < 7) {
    return d.toLocaleDateString('ru-RU', { weekday: 'long' });
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: diffDays > 365 ? 'numeric' : undefined });
}

function formatEditorDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  }) + ' г., ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function extractPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return tmp.textContent || '';
}

function splitTitleAndPreview(content) {
  const plain = extractPlainText(content).trim();
  if (!plain) return { title: '', preview: 'Нет дополнительного текста' };
  const lines = plain.split('\n').filter(l => l.trim());
  return {
    title: lines[0] || 'Без названия',
    preview: lines.slice(1).join(' ').trim() || 'Нет дополнительного текста',
  };
}

// ===== Рендеринг папок =====
async function loadFolders() {
  state.folders = await window.api.folders.list();
  renderFolders();
  if (!state.currentFolderId && state.folders.length > 0) {
    state.currentFolderId = state.folders[0].id;
  }
}

function renderFolders() {
  folderListEl.innerHTML = '';

  // "Все заметки"
  const allItem = createFolderItem({
    id: 'all',
    name: 'Все iCloud',
    icon: 'all'
  }, state.currentFolderId === 'all');
  folderListEl.appendChild(allItem);

  state.folders.forEach(f => {
    const el = createFolderItem(f, state.currentFolderId === f.id);
    folderListEl.appendChild(el);
  });
}

function createFolderItem(folder, isActive) {
  const li = document.createElement('li');
  li.className = 'folder-item' + (isActive ? ' active' : '');
  li.dataset.id = folder.id;

  const iconSvg = folder.icon === 'all'
    ? '<svg class="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M5 6H11M5 9H11M5 12H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'
    : '<svg class="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4.5C2 3.67 2.67 3 3.5 3H6.5L8 4.5H12.5C13.33 4.5 14 5.17 14 6V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" stroke="currentColor" stroke-width="1.2"/></svg>';

  const count = folder.id === 'all'
    ? state.notes.length
    : '';

  li.innerHTML = `
    ${iconSvg}
    <span class="folder-name">${escapeHtml(folder.name)}</span>
    <span class="folder-count"></span>
  `;

  li.addEventListener('click', () => selectFolder(folder.id));
  li.addEventListener('dblclick', () => {
    if (folder.id !== 'all') renameFolder(folder);
  });

  // Контекстное меню через правый клик
  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (folder.id === 'all') return;
    if (confirm(`Удалить папку "${folder.name}" и все её заметки?`)) {
      deleteFolder(folder.id);
    }
  });

  return li;
}

async function selectFolder(folderId) {
  state.currentFolderId = folderId;
  state.currentNoteId = null;
  const folder = folderId === 'all'
    ? { name: 'Все iCloud' }
    : state.folders.find(f => f.id === folderId);
  currentFolderNameEl.textContent = folder ? folder.name : 'Заметки';
  renderFolders();
  await loadNotes();
  showEmptyState();
}

async function createFolder() {
  const name = prompt('Название новой папки:', 'Новая папка');
  if (!name || !name.trim()) return;
  await window.api.folders.create(name.trim());
  await loadFolders();
}

async function renameFolder(folder) {
  const name = prompt('Переименовать папку:', folder.name);
  if (!name || !name.trim() || name === folder.name) return;
  await window.api.folders.rename(folder.id, name.trim());
  await loadFolders();
}

async function deleteFolder(id) {
  await window.api.folders.delete(id);
  if (state.currentFolderId === id) state.currentFolderId = 'all';
  await loadFolders();
  await loadNotes();
}

// ===== Рендеринг списка заметок =====
async function loadNotes() {
  if (state.searchQuery) {
    state.notes = await window.api.notes.search(state.searchQuery);
  } else {
    state.notes = await window.api.notes.list(state.currentFolderId || 'all');
  }
  renderNotes();
}

function renderNotes() {
  notesListEl.innerHTML = '';
  if (state.notes.length === 0) {
    notesListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 12px;">Нет заметок</div>';
    return;
  }
  state.notes.forEach(note => {
    const { title, preview } = splitTitleAndPreview(note.content);
    const div = document.createElement('div');
    div.className = 'note-item' + (note.id === state.currentNoteId ? ' active' : '');
    div.dataset.id = note.id;

    const pinIcon = note.pinned ? `
      <svg class="note-pin-indicator" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
        <path d="M10 2L14 6L11 7L12 11L8 7L4 11V8L7 5L6 2H10Z"/>
      </svg>
    ` : '';

    div.innerHTML = `
      ${pinIcon}
      <div class="note-title">${escapeHtml(title || 'Новая заметка')}</div>
      <div class="note-meta-row">
        <span class="note-date">${formatDate(note.updated_at)}</span>
        <span class="note-preview">${escapeHtml(preview)}</span>
      </div>
    `;

    div.addEventListener('click', () => selectNote(note.id));
    notesListEl.appendChild(div);
  });
}

async function selectNote(id) {
  // Сохранить текущую если была
  await flushSave();

  state.currentNoteId = id;
  const note = state.notes.find(n => n.id === id);
  if (!note) return;

  renderNotes();
  editorContent.innerHTML = note.content || '';
  editorDate.textContent = formatEditorDate(note.updated_at);
  updateEmptyState();
  updatePinButton();
  updateEditorPlaceholder();
}

function showEmptyState() {
  state.currentNoteId = null;
  editorWrap.classList.add('hidden');
  emptyState.classList.remove('hidden');
}

function updateEmptyState() {
  if (state.currentNoteId) {
    editorWrap.classList.remove('hidden');
    emptyState.classList.add('hidden');
  } else {
    editorWrap.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }
}

function updatePinButton() {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  const btn = $('#tb-pin');
  if (note && note.pinned) btn.classList.add('active');
  else btn.classList.remove('active');
}

function updateEditorPlaceholder() {
  const isEmpty = !editorContent.textContent.trim() && editorContent.innerHTML.trim() === '';
  editorContent.dataset.empty = isEmpty ? 'true' : 'false';
}

// ===== Создание новой заметки =====
async function createNote() {
  const folderId = (state.currentFolderId === 'all' || !state.currentFolderId)
    ? (state.folders[0]?.id)
    : state.currentFolderId;
  if (!folderId) {
    alert('Сначала создайте папку');
    return;
  }
  const note = await window.api.notes.create(folderId);
  await loadNotes();
  selectNote(note.id);
  setTimeout(() => editorContent.focus(), 50);
}

// ===== Удаление заметки =====
async function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  if (!confirm('Удалить эту заметку?')) return;
  await window.api.notes.delete(state.currentNoteId);
  state.currentNoteId = null;
  await loadNotes();
  showEmptyState();
}

// ===== Закрепление =====
async function togglePin() {
  if (!state.currentNoteId) return;
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (!note) return;
  await window.api.notes.update(state.currentNoteId, { pinned: !note.pinned });
  await loadNotes();
  selectNote(state.currentNoteId);
}

// ===== Автосохранение редактора =====
function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 400);
}

async function flushSave() {
  if (!state.currentNoteId) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const content = editorContent.innerHTML;
  await window.api.notes.update(state.currentNoteId, { content });
  // Обновить превью в списке без полной перерисовки (легкая оптимизация)
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (note) {
    note.content = content;
    note.updated_at = Date.now();
    renderNotes();
  }
}

// ===== Форматирование =====
function execCommand(cmd) {
  document.execCommand(cmd, false, null);
  editorContent.focus();
  scheduleSave();
}

// ===== Чек-листы =====
function insertChecklist() {
  document.execCommand('insertUnorderedList', false, null);
  // Найти только что созданный список и пометить как checklist
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    let node = sel.anchorNode;
    while (node && node.nodeName !== 'UL' && node.nodeName !== 'OL') {
      node = node.parentNode;
      if (!node || node === editorContent) break;
    }
    if (node && node.nodeName === 'UL') {
      node.classList.add('checklist');
    }
  }
  scheduleSave();
}

// Клик по чек-боксу
editorContent.addEventListener('click', (e) => {
  const li = e.target.closest('.checklist li');
  if (!li) return;
  // Проверить, что клик был по кружку (первые 22px)
  const rect = li.getBoundingClientRect();
  if (e.clientX - rect.left < 22) {
    li.classList.toggle('checked');
    scheduleSave();
  }
});

// ===== Экспорт в PDF =====
async function exportToPdf() {
  if (!state.currentNoteId) return;
  await flushSave();
  const result = await window.api.notes.exportPdf(state.currentNoteId);
  if (result.success) {
    // Лёгкое уведомление (можно расширить на toast)
    console.log('Экспортировано:', result.path);
  } else if (!result.canceled) {
    alert('Ошибка экспорта: ' + (result.error || 'неизвестная'));
  }
}

// ===== Поиск =====
searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim();
  loadNotes();
});

// ===== Редактор: ввод =====
editorContent.addEventListener('input', () => {
  scheduleSave();
  updateEditorPlaceholder();
});

editorContent.addEventListener('blur', flushSave);

// ===== Горячие клавиши =====
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'n' && !e.shiftKey) { e.preventDefault(); createNote(); }
  if (mod && e.key === 'f') { e.preventDefault(); searchInput.focus(); }
  if (mod && e.key === 'Delete') { e.preventDefault(); deleteCurrentNote(); }
  if (mod && e.key === 'b') { e.preventDefault(); execCommand('bold'); }
  if (mod && e.key === 'i') { e.preventDefault(); execCommand('italic'); }
  if (mod && e.key === 'u') { e.preventDefault(); execCommand('underline'); }
});

// ===== Обработчики кнопок тулбара =====
document.querySelectorAll('[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => execCommand(btn.dataset.cmd));
});
$('#tb-new').addEventListener('click', createNote);
$('#tb-delete').addEventListener('click', deleteCurrentNote);
$('#tb-pin').addEventListener('click', togglePin);
$('#tb-checklist').addEventListener('click', insertChecklist);
$('#tb-export').addEventListener('click', exportToPdf);
$('#new-folder-btn').addEventListener('click', createFolder);

// ===== Утилита =====
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

// ===== Инициализация =====
(async function init() {
  await loadFolders();
  await loadNotes();
  showEmptyState();
})();
