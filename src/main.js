const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let mainWindow;
let db;

function initDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'notes.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
  `);

  // Seed default folder if empty
  const folderCount = db.prepare('SELECT COUNT(*) as c FROM folders').get().c;
  if (folderCount === 0) {
    const now = Date.now();
    db.prepare('INSERT INTO folders (name, created_at, sort_order) VALUES (?, ?, ?)').run('Заметки', now, 0);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#666666',
      height: 38
    },
    backgroundColor: '#f6f6f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Hide default menu bar
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});

// ===================== IPC =====================

ipcMain.handle('folders:list', () => {
  return db.prepare('SELECT * FROM folders ORDER BY sort_order ASC, id ASC').all();
});

ipcMain.handle('folders:create', (_, name) => {
  const now = Date.now();
  const result = db.prepare('INSERT INTO folders (name, created_at) VALUES (?, ?)').run(name, now);
  return { id: result.lastInsertRowid, name, created_at: now };
});

ipcMain.handle('folders:rename', (_, id, name) => {
  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id);
  return true;
});

ipcMain.handle('folders:delete', (_, id) => {
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  return true;
});

ipcMain.handle('notes:list', (_, folderId) => {
  if (folderId === 'all') {
    return db.prepare('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC').all();
  }
  return db.prepare('SELECT * FROM notes WHERE folder_id = ? ORDER BY pinned DESC, updated_at DESC').all(folderId);
});

ipcMain.handle('notes:search', (_, query) => {
  const q = `%${query}%`;
  return db.prepare(`
    SELECT * FROM notes
    WHERE title LIKE ? OR content LIKE ?
    ORDER BY pinned DESC, updated_at DESC
  `).all(q, q);
});

ipcMain.handle('notes:create', (_, folderId) => {
  const now = Date.now();
  const result = db.prepare(
    'INSERT INTO notes (folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(folderId, '', '', now, now);
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
});

ipcMain.handle('notes:update', (_, id, updates) => {
  const now = Date.now();
  const fields = [];
  const values = [];
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
  if (updates.pinned !== undefined) { fields.push('pinned = ?'); values.push(updates.pinned ? 1 : 0); }
  if (updates.folder_id !== undefined) { fields.push('folder_id = ?'); values.push(updates.folder_id); }
  fields.push('updated_at = ?'); values.push(now);
  values.push(id);
  db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
});

ipcMain.handle('notes:delete', (_, id) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return true;
});

ipcMain.handle('notes:export-pdf', async (_, noteId) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
  if (!note) return { success: false, error: 'Note not found' };

  const safeName = (note.title || 'Без названия').replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспорт в PDF',
    defaultPath: `${safeName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });

  if (result.canceled) return { success: false, canceled: true };

  // Create hidden window to print the note
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  });

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body { font-family: -apple-system, 'Segoe UI', sans-serif; padding: 40px; color: #1d1d1f; }
      h1 { font-size: 24px; margin-bottom: 8px; }
      .meta { color: #86868b; font-size: 12px; margin-bottom: 20px; }
      .content { font-size: 14px; line-height: 1.6; }
      ul, ol { padding-left: 24px; }
      .checklist-item { list-style: none; margin-left: -20px; }
      .checklist-item input { margin-right: 8px; }
    </style></head><body>
    <h1>${escapeHtml(note.title || 'Без названия')}</h1>
    <div class="meta">Обновлено: ${new Date(note.updated_at).toLocaleString('ru-RU')}</div>
    <div class="content">${note.content || ''}</div>
    </body></html>
  `;

  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdfData = await printWin.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { marginType: 'default' }
  });
  fs.writeFileSync(result.filePath, pdfData);
  printWin.close();

  return { success: true, path: result.filePath };
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}
