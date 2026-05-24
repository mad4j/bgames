/**
 * C64Screen — Commodore 64-inspired screen emulator.
 *
 * Features:
 *  - 40×25 text mode with 16-color palette
 *  - Blinking cursor with input mode
 *  - Bitmap graphics layer (320×200)
 *  - Keyboard event routing
 *  - Border / background colors
 */

'use strict';

class C64Screen {

  // ── C64 16-color palette ──────────────────────────────────────────────────
  static PALETTE = [
    '#000000', '#FFFFFF', '#9F4E44', '#6ABFC6',
    '#A057A3', '#5CAB5E', '#50459B', '#C9D487',
    '#A1683C', '#6D5412', '#CB7E75', '#626262',
    '#898989', '#9AE29B', '#887ECB', '#ADADAD',
  ];

  // ── Layout constants ──────────────────────────────────────────────────────
  static COLS   = 40;
  static ROWS   = 25;
  static CW     = 8;   // char width  (px in virtual space)
  static CH     = 8;   // char height (px in virtual space)
  static BORDER = 20;  // border width (px in virtual space)
  static SCALE  = 2;   // canvas CSS scale factor

  // ── Default C64 colors ────────────────────────────────────────────────────
  static DEF_BORDER = 14; // light blue
  static DEF_BG     = 6;  // blue
  static DEF_FG     = 1;  // white

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    const { COLS, ROWS, CW, CH, BORDER, SCALE } = C64Screen;
    const W = COLS * CW + BORDER * 2;
    const H = ROWS * CH + BORDER * 2;

    // Physical canvas size matches virtual resolution
    canvas.width  = W;
    canvas.height = H;

    // CSS size adds the 2× scale
    canvas.style.width  = W * SCALE + 'px';
    canvas.style.height = H * SCALE + 'px';

    this._initState();
    this._buildFontCache();
    this._startRenderLoop();
    this.clear();
  }

  _initState() {
    const { COLS, ROWS } = C64Screen;

    this.borderColor = C64Screen.DEF_BORDER;
    this.bgColor     = C64Screen.DEF_BG;
    this.fgColor     = C64Screen.DEF_FG;

    this.cx = 0;  // cursor column
    this.cy = 0;  // cursor row

    // Text buffer: array of ROWS × COLS cells { ch, fg, bg }
    this.text = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => this._blankCell())
    );

    // Bitmap layer (320×200): pixel fg color index, 0 = transparent
    this.pixels     = new Uint8Array(320 * 200);
    this.pixelColor = new Uint8Array(320 * 200);
    this.graphicsMode = false;

    // Cursor blink state
    this._blinkTick    = 0;
    this._cursorOn     = true;

    // Input state
    this.inputMode     = false;
    this._inputBuf     = '';
    this._inputCb      = null;

    // Key buffer for INKEY$
    this._keyBuf = [];

    // External key listeners (array of functions)
    this._keyListeners = [];
  }

  _blankCell() {
    return { ch: ' ', fg: C64Screen.DEF_FG, bg: C64Screen.DEF_BG };
  }

  // ── Font cache (8×8 monospace glyphs) ────────────────────────────────────

  _buildFontCache() {
    // Render each printable ASCII character into a small offscreen canvas
    // and store the resulting ImageData for fast blitting.
    const tmp  = document.createElement('canvas');
    tmp.width  = 8;
    tmp.height = 8;
    const tc = tmp.getContext('2d');

    this._glyphs = {};

    for (let code = 32; code < 128; code++) {
      tc.clearRect(0, 0, 8, 8);
      tc.fillStyle = '#fff';
      tc.font = '8px "Courier New", "Lucida Console", monospace';
      tc.textBaseline = 'top';
      tc.fillText(String.fromCharCode(code), 0, 0);
      this._glyphs[code] = tc.getImageData(0, 0, 8, 8);
    }

    // Solid block — used for cursor
    const solid = tc.createImageData(8, 8);
    for (let i = 0; i < solid.data.length; i += 4) {
      solid.data[i]     = 255;
      solid.data[i + 1] = 255;
      solid.data[i + 2] = 255;
      solid.data[i + 3] = 255;
    }
    this._glyphs[0] = solid; // cursor glyph
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _startRenderLoop() {
    const BLINK_FRAMES = 30; // blink period
    let frame = 0;

    const loop = () => {
      frame++;
      if (frame >= BLINK_FRAMES) {
        frame = 0;
        this._cursorOn = !this._cursorOn;
      }
      this._render();
      this._rafId = requestAnimationFrame(loop);
    };

    this._rafId = requestAnimationFrame(loop);
  }

  stopRender() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  _render() {
    const ctx = this.ctx;
    const { COLS, ROWS, CW, CH, BORDER } = C64Screen;
    const pal = C64Screen.PALETTE;

    // ── Border
    ctx.fillStyle = pal[this.borderColor];
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // ── Background
    ctx.fillStyle = pal[this.bgColor];
    ctx.fillRect(BORDER, BORDER, COLS * CW, ROWS * CH);

    if (this.graphicsMode) {
      this._renderBitmap();
    } else {
      this._renderText();
    }
  }

  _renderText() {
    const ctx = this.ctx;
    const { COLS, ROWS, CW, CH, BORDER } = C64Screen;
    const pal = C64Screen.PALETTE;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell  = this.text[row][col];
        const px    = BORDER + col * CW;
        const py    = BORDER + row * CH;
        const isCur = this.inputMode && this._cursorOn
                      && col === this.cx && row === this.cy;

        const bgCol = isCur ? pal[cell.fg]  : pal[cell.bg];
        const fgCol = isCur ? pal[cell.bg]  : pal[cell.fg];

        // Cell background
        ctx.fillStyle = bgCol;
        ctx.fillRect(px, py, CW, CH);

        // Glyph
        const code  = isCur ? 0 : (cell.ch.charCodeAt(0) || 32);
        const glyph = this._glyphs[code] || this._glyphs[63];
        if (glyph) this._blitGlyph(glyph, px, py, fgCol);
      }
    }
  }

  _blitGlyph(glyph, dx, dy, color) {
    // Parse CSS color string to RGB once per render cycle using a tiny cache
    if (!this._colorCache) this._colorCache = {};
    if (!this._colorCache[color]) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      this._colorCache[color] = [r, g, b];
    }
    const [r, g, b] = this._colorCache[color];

    // Build a tinted copy of the glyph
    const out = this.ctx.createImageData(8, 8);
    for (let i = 0; i < 64; i++) {
      const a = glyph.data[i * 4 + 3];
      if (a > 64) {
        out.data[i * 4]     = r;
        out.data[i * 4 + 1] = g;
        out.data[i * 4 + 2] = b;
        out.data[i * 4 + 3] = 255;
      }
    }
    this.ctx.putImageData(out, dx, dy);
  }

  _renderBitmap() {
    const { BORDER } = C64Screen;
    const ctx = this.ctx;
    const pal = C64Screen.PALETTE;

    const img = ctx.createImageData(320, 200);
    for (let i = 0; i < 320 * 200; i++) {
      if (this.pixels[i]) {
        const hex = pal[this.pixelColor[i]];
        img.data[i * 4]     = parseInt(hex.slice(1, 3), 16);
        img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
        img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
        img.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, BORDER, BORDER);
  }

  // ── Public API — Text ─────────────────────────────────────────────────────

  clear() {
    const { COLS, ROWS } = C64Screen;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        this.text[r][c] = { ch: ' ', fg: this.fgColor, bg: this.bgColor };
    this.cx = 0;
    this.cy = 0;
    this.pixels.fill(0);
    this.pixelColor.fill(0);
  }

  print(str) {
    for (const ch of String(str)) {
      if (ch === '\n') { this._newline(); continue; }
      if (ch === '\r') { this.cx = 0; continue; }
      if (this.cx >= C64Screen.COLS) this._newline();
      this.text[this.cy][this.cx] = { ch, fg: this.fgColor, bg: this.bgColor };
      this.cx++;
    }
  }

  println(str = '') {
    this.print(str);
    this._newline();
  }

  _newline() {
    this.cx = 0;
    this.cy++;
    if (this.cy >= C64Screen.ROWS) {
      this._scrollUp();
      this.cy = C64Screen.ROWS - 1;
    }
  }

  _scrollUp() {
    this.text.shift();
    this.text.push(
      Array.from({ length: C64Screen.COLS }, () =>
        ({ ch: ' ', fg: this.fgColor, bg: this.bgColor })
      )
    );
  }

  locate(row, col) {
    this.cx = Math.max(0, Math.min(col, C64Screen.COLS - 1));
    this.cy = Math.max(0, Math.min(row, C64Screen.ROWS - 1));
  }

  // ── Public API — Colors ───────────────────────────────────────────────────

  setFg(c)     { this.fgColor     = c & 15; }
  setBg(c)     { this.bgColor     = c & 15; this._render(); }
  setBorder(c) { this.borderColor = c & 15; }

  // ── Public API — Input ────────────────────────────────────────────────────

  setInputMode(v) { this.inputMode = v; }

  /** Prompt then call cb(string) when Enter is pressed. */
  readLine(prompt, cb) {
    if (prompt) this.print(prompt);
    this.inputMode = true;
    this._inputBuf = '';
    this._inputCb  = cb;
  }

  /** Called by app.js for every keydown event. */
  onKeyDown(key, char) {
    // Notify listeners registered via addKeyListener
    for (const fn of this._keyListeners) fn(key, char);

    if (this.inputMode && this._inputCb) {
      if (key === 'Enter') {
        const result = this._inputBuf;
        this._inputBuf = '';
        this.inputMode = false;
        this._newline();
        const cb = this._inputCb;
        this._inputCb = null;
        cb(result);
      } else if (key === 'Backspace') {
        if (this._inputBuf.length > 0) {
          this._inputBuf = this._inputBuf.slice(0, -1);
          if (this.cx > 0) this.cx--;
          this.text[this.cy][this.cx] = { ch: ' ', fg: this.fgColor, bg: this.bgColor };
        }
      } else if (char && char.length === 1) {
        this._inputBuf += char;
        this.print(char);
      }
    } else {
      // Accumulate in INKEY$ buffer (max 32)
      this._keyBuf.push(char || key);
      if (this._keyBuf.length > 32) this._keyBuf.shift();
    }
  }

  addKeyListener(fn)    { this._keyListeners.push(fn); }
  removeKeyListener(fn) { this._keyListeners = this._keyListeners.filter(f => f !== fn); }

  /** Read one character from the INKEY$ buffer. */
  inkey() { return this._keyBuf.shift() || ''; }

  // ── Public API — Graphics ─────────────────────────────────────────────────

  setGraphics(on) {
    if (on && !this.graphicsMode) {
      // Clear bitmap only when first entering graphics mode
      this.pixels.fill(0);
      this.pixelColor.fill(0);
    }
    this.graphicsMode = on;
  }

  pset(x, y, color) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= 320 || y < 0 || y >= 200) return;
    const i = y * 320 + x;
    this.pixels[i]     = 1;
    this.pixelColor[i] = (color !== undefined ? color : this.fgColor) & 15;
  }

  preset(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= 320 || y < 0 || y >= 200) return;
    this.pixels[y * 320 + x] = 0;
  }

  line(x1, y1, x2, y2, color) {
    // Bresenham
    let dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
    let dy = Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      this.pset(x1, y1, color);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x1 += sx; }
      if (e2 <  dx) { err += dx; y1 += sy; }
    }
  }

  circle(cx, cy, r, color) {
    // Midpoint circle
    let x = r, y = 0, err = 0;
    while (x >= y) {
      this.pset(cx + x, cy + y, color); this.pset(cx + y, cy + x, color);
      this.pset(cx - y, cy + x, color); this.pset(cx - x, cy + y, color);
      this.pset(cx - x, cy - y, color); this.pset(cx - y, cy - x, color);
      this.pset(cx + y, cy - x, color); this.pset(cx + x, cy - y, color);
      y++;
      err += 2 * y + 1;
      if (2 * (err - x) + 1 > 0) { x--; err += 1 - 2 * x; }
    }
  }

  fillRect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        this.pset(x + dx, y + dy, color);
  }

  // ── Sound ─────────────────────────────────────────────────────────────────

  beep(freq = 440, durationMs = 200, wave = 'square') {
    try {
      const ac  = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ac.createOscillator();
      const env = ac.createGain();
      osc.connect(env);
      env.connect(ac.destination);
      osc.type             = wave;
      osc.frequency.value  = freq;
      env.gain.setValueAtTime(0.12, ac.currentTime);
      env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + durationMs / 1000);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + durationMs / 1000 + 0.05);
    } catch (_) { /* audio unavailable */ }
  }
}
