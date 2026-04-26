/**
 * app.js — BGames application controller
 *
 * Responsibilities:
 *  - Tab switching (Play / Code)
 *  - Toolbar actions: New, Load, Save, Run, Stop
 *  - Keyboard routing to C64Screen
 *  - LocalStorage game library
 *  - File I/O (load .bas file, save .bas file)
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Sample BASIC program shown on first load
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_PROGRAM = `10 REM  BGames Demo — Bouncing Ball
20 CLS
30 COLOR 5, 6, 14
40 PRINT "  *** BGAMES DEMO ***"
50 PRINT
60 PRINT "  BOUNCING BALL DEMO"
70 PRINT "  PRESS ANY KEY TO EXIT"
80 PRINT
90 WAIT 1
100 GRAPHICS 1
110 COLOR 1, 6, 14
120 LET X = 160
130 LET Y = 100
140 LET DX = 3
150 LET DY = 2
200 REM  Main loop
210 LET K$ = INKEY$
220 IF K$ <> "" THEN GOTO 400
230 REM  Erase old ball
240 CIRCLE (X, Y), 8, 6
250 REM  Move ball
260 LET X = X + DX
270 LET Y = Y + DY
280 REM  Bounce off walls
290 IF X < 8 OR X > 312 THEN LET DX = -DX
300 IF Y < 8 OR Y > 192 THEN LET DY = -DY
310 LET X = X + DX
320 LET Y = Y + DY
330 REM  Draw new ball
340 CIRCLE (X, Y), 8, 7
350 WAIT 0.03
360 GOTO 210
400 REM  Exit
410 GRAPHICS 0
420 CLS
430 PRINT
440 PRINT "  BYE!"
450 END
`;

// ─────────────────────────────────────────────────────────────────────────────
// BGamesApp
// ─────────────────────────────────────────────────────────────────────────────

class BGamesApp {

  constructor() {
    // ── DOM refs ────────────────────────────────────────────────────────────
    this.$canvas   = document.getElementById('c64-canvas');
    this.$editor   = document.getElementById('basic-editor');
    this.$filename = document.getElementById('tb-filename');
    this.$btnRun   = document.getElementById('btn-run');
    this.$btnStop  = document.getElementById('btn-stop');
    this.$fileIn   = document.getElementById('file-input');
    this.$modal    = document.getElementById('modal-overlay');

    // ── Core objects ────────────────────────────────────────────────────────
    this.screen      = new C64Screen(this.$canvas);
    this.interpreter = new BasicInterpreter(this.screen);

    // ── App state ───────────────────────────────────────────────────────────
    this.currentFile = 'untitled.bas';
    this.dirty       = false;

    this._bindEvents();
    this._loadLastOrDemo();
    this._updateUI();

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  _loadLastOrDemo() {
    const saved = localStorage.getItem('bgames_current_code');
    const name  = localStorage.getItem('bgames_current_name');
    if (saved) {
      this.$editor.value = saved;
      this.currentFile   = name || 'untitled.bas';
    } else {
      this.$editor.value = DEMO_PROGRAM;
    }
  }

  _updateUI() {
    this.$filename.textContent = this.currentFile + (this.dirty ? ' •' : '');
    this.$btnStop.disabled     = !this.interpreter.running;
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
    });

    // Toolbar buttons
    document.getElementById('btn-new') .addEventListener('click', () => this._actionNew());
    document.getElementById('btn-load').addEventListener('click', () => this._actionLoad());
    document.getElementById('btn-save').addEventListener('click', () => this._actionSave());
    this.$btnRun .addEventListener('click', () => this._actionRun());
    this.$btnStop.addEventListener('click', () => this._actionStop());

    // File input (load from disk)
    this.$fileIn.addEventListener('change', e => this._handleFileLoad(e));

    // Keyboard → C64 screen
    document.addEventListener('keydown', e => this._onKeyDown(e));

    // Editor dirty tracking
    this.$editor.addEventListener('input', () => {
      this.dirty = true;
      this._updateUI();
      localStorage.setItem('bgames_current_code', this.$editor.value);
    });

    // Modal close
    document.querySelector('.modal-close').addEventListener('click', () => this._closeModal());
    this.$modal.addEventListener('click', e => {
      if (e.target === this.$modal) this._closeModal();
    });
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  _switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === name)
    );
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === `tab-${name}`)
    );
    if (name === 'play') this.$canvas.focus();
    else                 this.$editor.focus();
  }

  // ── Toolbar actions ───────────────────────────────────────────────────────

  _actionNew() {
    if (this.dirty && !confirm('Discard unsaved changes?')) return;
    this.$editor.value = '10 REM My new game\n20 PRINT "HELLO WORLD"\n30 END\n';
    this.currentFile   = 'untitled.bas';
    this.dirty         = false;
    localStorage.removeItem('bgames_current_code');
    localStorage.removeItem('bgames_current_name');
    this._updateUI();
    this._switchTab('code');
  }

  _actionLoad() {
    this._showLoadModal();
  }

  _actionSave() {
    this._showSaveModal();
  }

  async _actionRun() {
    if (this.interpreter.running) return;

    const code = this.$editor.value;
    this.interpreter.load(code);

    this._switchTab('play');
    this.screen.clear();
    this.screen.setFg(C64Screen.DEF_FG);
    this.screen.setBg(C64Screen.DEF_BG);
    this.screen.setBorder(C64Screen.DEF_BORDER);
    this.screen.setGraphics(false);

    this.$btnStop.disabled = false;
    this.$btnRun.disabled  = true;

    try {
      await this.interpreter.run();
    } finally {
      this.$btnStop.disabled = true;
      this.$btnRun.disabled  = false;
    }
  }

  _actionStop() {
    this.interpreter.stop();
    this.$btnStop.disabled = true;
    this.$btnRun.disabled  = false;
  }

  // ── Keyboard routing ──────────────────────────────────────────────────────

  _onKeyDown(e) {
    // Only route keys when the play tab is active
    const playActive = document.getElementById('tab-play').classList.contains('active');
    if (!playActive) return;

    // Let the browser handle special shortcuts
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    e.preventDefault();
    this.screen.onKeyDown(e.key, e.key.length === 1 ? e.key : '');
  }

  // ── File loading from disk ─────────────────────────────────────────────────

  _handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      this.$editor.value = ev.target.result;
      this.currentFile   = file.name;
      this.dirty         = false;
      localStorage.setItem('bgames_current_code', ev.target.result);
      localStorage.setItem('bgames_current_name', file.name);
      this._updateUI();
      this._switchTab('code');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── LocalStorage game library ─────────────────────────────────────────────

  _getLibrary() {
    try { return JSON.parse(localStorage.getItem('bgames_library') || '[]'); }
    catch (_) { return []; }
  }

  _saveToLibrary(name, code) {
    const lib  = this._getLibrary();
    const idx  = lib.findIndex(g => g.name === name);
    const entry = { name, code, date: new Date().toISOString() };
    if (idx >= 0) lib[idx] = entry; else lib.push(entry);
    localStorage.setItem('bgames_library', JSON.stringify(lib));
  }

  _deleteFromLibrary(name) {
    const lib = this._getLibrary().filter(g => g.name !== name);
    localStorage.setItem('bgames_library', JSON.stringify(lib));
  }

  // ── Load modal ────────────────────────────────────────────────────────────

  _showLoadModal() {
    const lib   = this._getLibrary();
    const title = document.getElementById('modal-title');
    const body  = document.getElementById('modal-body');
    const foot  = document.getElementById('modal-foot');

    title.textContent = 'Load Game';

    if (lib.length === 0) {
      body.innerHTML = `<p class="game-list-empty">No saved games yet.<br>Save a game first, or load from file.</p>`;
    } else {
      const ul = document.createElement('ul');
      ul.className = 'game-list';
      lib.forEach(g => {
        const li  = document.createElement('li');
        const d   = new Date(g.date);
        const ds  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        li.innerHTML = `
          <span class="gl-icon">🎮</span>
          <span class="gl-info">
            <div class="gl-name">${this._esc(g.name)}</div>
            <div class="gl-date">${ds}</div>
          </span>
          <button class="gl-del" title="Delete" data-name="${this._esc(g.name)}">🗑</button>`;
        li.querySelector('.gl-info').addEventListener('click', () => {
          this._loadGame(g.name, g.code);
          this._closeModal();
        });
        li.querySelector('.gl-del').addEventListener('click', e => {
          e.stopPropagation();
          if (confirm(`Delete "${g.name}"?`)) {
            this._deleteFromLibrary(g.name);
            this._showLoadModal();
          }
        });
        ul.appendChild(li);
      });
      body.innerHTML = '';
      body.appendChild(ul);
    }

    foot.innerHTML = `
      <button class="btn" id="modal-load-file">📂 Load from file…</button>
      <button class="btn" id="modal-close-btn">Cancel</button>`;
    foot.querySelector('#modal-load-file').addEventListener('click', () => {
      this._closeModal();
      this.$fileIn.click();
    });
    foot.querySelector('#modal-close-btn').addEventListener('click', () => this._closeModal());

    this._openModal();
  }

  _loadGame(name, code) {
    this.$editor.value = code;
    this.currentFile   = name;
    this.dirty         = false;
    localStorage.setItem('bgames_current_code', code);
    localStorage.setItem('bgames_current_name', name);
    this._updateUI();
    this._switchTab('code');
  }

  // ── Save modal ────────────────────────────────────────────────────────────

  _showSaveModal() {
    const title = document.getElementById('modal-title');
    const body  = document.getElementById('modal-body');
    const foot  = document.getElementById('modal-foot');

    title.textContent = 'Save Game';

    body.innerHTML = `
      <div class="form-group">
        <label for="save-name">Game name</label>
        <input type="text" id="save-name" value="${this._esc(this.currentFile)}" maxlength="64" autocomplete="off">
      </div>`;

    foot.innerHTML = `
      <button class="btn btn-primary" id="modal-save-local">💾 Save to library</button>
      <button class="btn" id="modal-save-file">📥 Download .bas file</button>
      <button class="btn" id="modal-cancel-btn">Cancel</button>`;

    const nameInput = body.querySelector('#save-name');

    foot.querySelector('#modal-save-local').addEventListener('click', () => {
      const name = nameInput.value.trim() || 'untitled.bas';
      this._saveToLibrary(name, this.$editor.value);
      this.currentFile = name;
      this.dirty       = false;
      localStorage.setItem('bgames_current_name', name);
      this._updateUI();
      this._closeModal();
    });

    foot.querySelector('#modal-save-file').addEventListener('click', () => {
      const name = nameInput.value.trim() || 'untitled.bas';
      this._downloadFile(name, this.$editor.value);
      this.currentFile = name;
      this.dirty       = false;
      this._updateUI();
      this._closeModal();
    });

    foot.querySelector('#modal-cancel-btn').addEventListener('click', () => this._closeModal());

    this._openModal();
    setTimeout(() => nameInput.select(), 50);
  }

  _downloadFile(name, content) {
    const a    = document.createElement('a');
    const blob = new Blob([content], { type: 'text/plain' });
    a.href     = URL.createObjectURL(blob);
    a.download = name.endsWith('.bas') ? name : name + '.bas';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────

  _openModal()  { this.$modal.classList.remove('hidden'); }
  _closeModal() { this.$modal.classList.add('hidden'); }

  _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  window.app = new BGamesApp();
});
