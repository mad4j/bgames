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
60 PRINT "  Bouncing Ball"
70 PRINT "  Press any key to exit"
80 WAIT 1.5
90 GRAPHICS 1
100 COLOR 1, 6, 14
110 LET X = 160
120 LET Y = 100
130 LET DX = 3
140 LET DY = 2
150 LET K$ = ""
160 REM  Main loop — exits when any key pressed
170 WHILE K$ = ""
180   LET K$ = INKEY$
190   REM  Erase old ball
200   CIRCLE (X, Y), 8, 6
210   REM  Bounce off walls
220   IF X < 9 OR X > 311 THEN LET DX = -DX
230   IF Y < 9 OR Y > 191 THEN LET DY = -DY
240   REM  Move ball
250   LET X = X + DX
260   LET Y = Y + DY
270   REM  Draw new ball
280   CIRCLE (X, Y), 8, 7
290   WAIT 0.03
300 WEND
310 REM  Exit
320 GRAPHICS 0
330 CLS
340 PRINT
350 PRINT "  Goodbye!"
360 END
`;

// ─────────────────────────────────────────────────────────────────────────────
// Built-in sample programs
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_PROGRAMS = [
  {
    name: 'bouncing-ball.bas',
    code: DEMO_PROGRAM,
  },
  {
    name: 'star-field.bas',
    code: `10 REM  Star Field — scrolling starfield demo
20 GRAPHICS 1
30 COLOR 1, 0, 0
40 DIM SX(60), SY(60), SS(60)
50 FOR I=1 TO 60
60   LET SX(I) = INT(RND*320)
70   LET SY(I) = INT(RND*200)
80   LET SS(I) = INT(RND*3)+1
90 NEXT I
100 REM  Main loop
110 LET K$ = INKEY$
120 IF K$ <> "" THEN GOTO 300
130 FOR I=1 TO 60
140   PRESET SX(I), SY(I)
150   LET SX(I) = SX(I) - SS(I)
160   IF SX(I) < 0 THEN LET SX(I) = 319 : LET SY(I) = INT(RND*200)
170   LET C = SS(I)*5
180   PSET SX(I), SY(I), C
190 NEXT I
200 WAIT 0.02
210 GOTO 110
300 GRAPHICS 0
310 CLS
320 PRINT "  DONE!"
330 END
`,
  },
  {
    name: 'number-guess.bas',
    code: `10 REM  Guess the Number game
20 CLS
30 COLOR 1, 6, 14
40 PRINT "  *** GUESS THE NUMBER ***"
50 PRINT
60 LET SECRET = INT(RND*100)+1
70 LET TRIES = 0
80 PRINT "  I'm thinking of a number 1-100"
90 PRINT
100 INPUT "  Your guess: ", G
110 LET TRIES = TRIES + 1
120 IF G = SECRET THEN GOTO 200
130 IF G < SECRET THEN PRINT "  Too low!  Try again."
140 IF G > SECRET THEN PRINT "  Too high! Try again."
150 GOTO 100
200 PRINT
210 PRINT "  Correct! It was "; SECRET
220 PRINT "  You got it in "; TRIES; " tries!"
230 END
`,
  },
  {
    name: 'fibonacci.bas',
    code: `10 REM  Fibonacci sequence
20 CLS
30 COLOR 5, 6, 14
40 PRINT "  Fibonacci Sequence"
50 PRINT "  ─────────────────"
60 PRINT
70 LET A = 0
80 LET B = 1
90 FOR I = 1 TO 20
100   PRINT "  F("; I; ") = "; A
110   LET T = A + B
120   LET A = B
130   LET B = T
140 NEXT I
150 PRINT
160 PRINT "  Press any key..."
170 LET K$ = ""
180 WHILE K$ = ""
190   LET K$ = INKEY$
200 WEND
210 END
`,
  },
];

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
    this._seedLibrary();
    this._loadLastOrDemo();
    this._updateUI();

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  _seedLibrary() {
    // Pre-populate with sample programs only if the library is still empty
    if (this._getLibrary().length === 0) {
      const seeded = new Date().toISOString();
      const entries = SAMPLE_PROGRAMS.map(s => ({ name: s.name, code: s.code, date: seeded }));
      localStorage.setItem('bgames_library', JSON.stringify(entries));
    }
  }

  _loadLastOrDemo() {
    const saved = localStorage.getItem('bgames_current_code');
    const name  = localStorage.getItem('bgames_current_name');
    if (saved) {
      this.$editor.value = saved;
      this.currentFile   = name || 'untitled.bas';
    } else {
      this.$editor.value = DEMO_PROGRAM;
    }
    this._updateStatusBar();
  }

  _updateUI() {
    this.$filename.textContent = this.currentFile + (this.dirty ? ' •' : '');
    this.$btnStop.disabled     = !this.interpreter.running;
  }

  _updateStatusBar() {
    const txt  = this.$editor.value;
    const pos  = this.$editor.selectionStart || 0;
    let line = 1, col = 1;
    for (let i = 0; i < pos; i++) {
      if (txt[i] === '\n') { line++; col = 1; } else col++;
    }
    const totalLines = txt ? txt.split('\n').length : 1;
    const sbPos   = document.getElementById('sb-pos');
    const sbLines = document.getElementById('sb-lines');
    if (sbPos)   sbPos.textContent   = `Ln ${line}, Col ${col}`;
    if (sbLines) sbLines.textContent = `${totalLines} line${totalLines !== 1 ? 's' : ''}`;
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

    // Editor dirty tracking + status bar
    this.$editor.addEventListener('input', () => {
      this.dirty = true;
      this._updateUI();
      this._updateStatusBar();
      localStorage.setItem('bgames_current_code', this.$editor.value);
    });
    this.$editor.addEventListener('click',   () => this._updateStatusBar());
    this.$editor.addEventListener('keyup',   () => this._updateStatusBar());
    this.$editor.addEventListener('select',  () => this._updateStatusBar());

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
    this.$editor.value = '10 REM  My new game\n20 PRINT "HELLO WORLD"\n30 END\n';
    this.currentFile   = 'untitled.bas';
    this.dirty         = false;
    localStorage.removeItem('bgames_current_code');
    localStorage.removeItem('bgames_current_name');
    this._updateUI();
    this._updateStatusBar();
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
    // Global shortcuts (work regardless of active tab)
    if (e.key === 'F5') {
      e.preventDefault();
      if (!this.interpreter.running) this._actionRun();
      return;
    }
    if (e.key === 'Escape' && this.interpreter.running) {
      e.preventDefault();
      this._actionStop();
      return;
    }

    // Only route keys to C64 screen when the play tab is active
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
    this._updateStatusBar();
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
