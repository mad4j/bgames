/**
 * BasicInterpreter — BASIC interpreter for the C64-style BGames platform.
 *
 * Supported statements:
 *   REM, PRINT/?, INPUT, LET, IF..THEN..ELSE, GOTO, GOSUB, RETURN,
 *   FOR..TO..STEP, NEXT, END, STOP, CLS, COLOR, LOCATE, PSET, LINE,
 *   CIRCLE, RECT, GRAPHICS, SOUND, BEEP, WAIT, DIM, READ, DATA, RESTORE
 *
 * Supported functions:
 *   INT, ABS, SGN, SQR, RND, SIN, COS, TAN, ATN, EXP, LOG, LOG10,
 *   CHR$, STR$, VAL, LEN, ASC, MID$, LEFT$, RIGHT$, INSTR, INKEY$,
 *   TIME (returns seconds since epoch)
 */

'use strict';

class BasicInterpreter {

  constructor(screen) {
    this.screen  = screen;
    this._prog   = new Map(); // lineNum -> statementText
    this._lines  = [];        // sorted line numbers
    this._data   = [];        // DATA items
    this._running = false;
    this._stopReq = false;
    this._stopCb  = null;     // resolve for stop()
  }

  // ── Load / run / stop ─────────────────────────────────────────────────────

  load(code) {
    this._prog.clear();
    for (const raw of code.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(\d+)\s+([\s\S]*)/);
      if (m) this._prog.set(parseInt(m[1], 10), m[2].trimEnd());
    }
    this._lines = [...this._prog.keys()].sort((a, b) => a - b);
    this._collectData();
  }

  _collectData() {
    this._data = [];
    for (const n of this._lines) {
      const s = this._prog.get(n);
      if (/^DATA\b/i.test(s)) {
        this._data.push(...this._parseDataItems(s.slice(s.indexOf(' ') + 1)));
      }
    }
  }

  _parseDataItems(str) {
    const items = [];
    let cur = '', inStr = false;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '"') { inStr = !inStr; cur += c; }
      else if (c === ',' && !inStr) { items.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    if (cur.trim()) items.push(cur.trim());
    return items;
  }

  async run() {
    if (this._running) return;
    this._running = true;
    this._stopReq = false;

    // Runtime state
    this._vars     = new Map();  // name(lowercase) -> value
    this._arrays   = new Map();  // name -> flat object { key: value }
    this._gosubStk = [];         // array of return-to indices
    this._forStk   = [];         // array of { varName, limit, step, nextIdx }
    this._dataPtr  = 0;
    this._idx      = 0;          // current index into this._lines

    await this._runLoop();
    this._running = false;
    this.screen.setInputMode(false);
  }

  stop() {
    this._stopReq = true;
    this._running = false;
    // Abort any pending readLine
    if (this.screen._inputCb) {
      const cb = this.screen._inputCb;
      this.screen._inputCb  = null;
      this.screen.inputMode = false;
      cb('');
    }
  }

  get running() { return this._running; }

  // ── Main execution loop ───────────────────────────────────────────────────

  async _runLoop() {
    let yieldCounter = 0;

    while (this._running && !this._stopReq && this._idx < this._lines.length) {
      const lineNum = this._lines[this._idx];
      const stmt    = this._prog.get(lineNum);

      this._nextLine = null; // GOTO/GOSUB will set this

      try {
        await this._execLine(lineNum, stmt);
      } catch (e) {
        if (e && e._basic === 'END') break;
        if (e && e._basic === 'STOP') { this.screen.println('BREAK'); break; }
        const msg = (e && e.message) ? e.message : String(e);
        this.screen.println(`?${msg} ERROR IN ${lineNum}`);
        break;
      }

      if (!this._running || this._stopReq) break;

      if (this._nextLine !== null) {
        const ni = this._lines.indexOf(this._nextLine);
        if (ni === -1) {
          this.screen.println(`?UNDEF'D STATEMENT ERROR IN ${lineNum}`);
          break;
        }
        this._idx = ni;
      } else {
        this._idx++;
      }

      // Yield every N steps to keep UI responsive
      if (++yieldCounter >= 200) {
        yieldCounter = 0;
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  // ── Line / statement dispatch ─────────────────────────────────────────────

  async _execLine(lineNum, text) {
    for (const raw of this._splitMulti(text)) {
      const s = raw.trim();
      if (!s) continue;
      if (this._nextLine !== null) return; // GOTO already triggered
      await this._execStmt(lineNum, s);
      if (!this._running || this._stopReq) return;
    }
  }

  /** Split on ':' but respect strings. */
  _splitMulti(text) {
    const parts = []; let cur = '', inQ = false;
    for (const c of text) {
      if (c === '"') inQ = !inQ;
      if (c === ':' && !inQ) { parts.push(cur); cur = ''; }
      else cur += c;
    }
    parts.push(cur);
    return parts;
  }

  async _execStmt(lineNum, s) {
    const u = s.toUpperCase();

    // ── REM / comment ──────────────────────────────────────────────────────
    if (u.startsWith("REM") || s.startsWith("'")) return;

    // ── DATA (already collected) ───────────────────────────────────────────
    if (u.startsWith('DATA')) return;

    // ── END / STOP ─────────────────────────────────────────────────────────
    if (u === 'END')  throw { _basic: 'END' };
    if (u === 'STOP') throw { _basic: 'STOP' };

    // ── CLS ────────────────────────────────────────────────────────────────
    if (u === 'CLS' || u === 'CLEAR') { this.screen.clear(); return; }

    // ── PRINT / ? ─────────────────────────────────────────────────────────
    if (u.startsWith('PRINT') || s.startsWith('?')) {
      await this._stmtPrint(s); return;
    }

    // ── INPUT ─────────────────────────────────────────────────────────────
    if (u.startsWith('INPUT')) { await this._stmtInput(s); return; }

    // ── LET (optional keyword) ────────────────────────────────────────────
    if (u.startsWith('LET ')) { this._stmtAssign(s.slice(4).trim()); return; }

    // ── Assignment (no LET) ───────────────────────────────────────────────
    if (/^[A-Za-z_][A-Za-z0-9_.]*[$%]?\s*(\(|=)/.test(s) && !u.startsWith('IF')) {
      const eqIdx = this._findEq(s);
      if (eqIdx > 0) { this._stmtAssign(s); return; }
    }

    // ── IF..THEN..ELSE ────────────────────────────────────────────────────
    if (u.startsWith('IF ') || u.startsWith('IF(')) {
      await this._stmtIf(lineNum, s); return;
    }

    // ── GOTO ──────────────────────────────────────────────────────────────
    if (u.startsWith('GOTO ') || u.startsWith('GO TO ')) {
      this._nextLine = parseInt(s.replace(/^GO\s*TO\s+/i, ''));
      return;
    }

    // ── GOSUB ─────────────────────────────────────────────────────────────
    if (u.startsWith('GOSUB ') || u.startsWith('GO SUB ')) {
      const target = parseInt(s.replace(/^GO\s*SUB\s+/i, ''));
      // Store the line number to return to (line after GOSUB), or null if last line
      const retLine = this._idx + 1 < this._lines.length ? this._lines[this._idx + 1] : null;
      this._gosubStk.push(retLine);
      this._nextLine = target;
      return;
    }

    // ── RETURN ────────────────────────────────────────────────────────────
    if (u === 'RETURN') {
      if (!this._gosubStk.length) throw new Error('RETURN WITHOUT GOSUB');
      const retLine = this._gosubStk.pop();
      if (retLine === null) {
        // GOSUB was the last line; RETURN ends execution
        throw { _basic: 'END' };
      }
      this._nextLine = retLine;
      return;
    }

    // ── FOR ───────────────────────────────────────────────────────────────
    if (u.startsWith('FOR ')) { this._stmtFor(s); return; }

    // ── NEXT ─────────────────────────────────────────────────────────────
    if (u.startsWith('NEXT')) { this._stmtNext(s); return; }

    // ── DIM ───────────────────────────────────────────────────────────────
    if (u.startsWith('DIM ')) { this._stmtDim(s.slice(4).trim()); return; }

    // ── READ ─────────────────────────────────────────────────────────────
    if (u.startsWith('READ ')) { this._stmtRead(s.slice(5).trim()); return; }

    // ── RESTORE ──────────────────────────────────────────────────────────
    if (u === 'RESTORE') { this._dataPtr = 0; return; }

    // ── COLOR ─────────────────────────────────────────────────────────────
    if (u.startsWith('COLOR ')) {
      const parts = this._splitArgs(s.slice(6).trim());
      if (parts[0]) this.screen.setFg(this._evalNum(parts[0]));
      if (parts[1]) this.screen.setBg(this._evalNum(parts[1]));
      if (parts[2]) this.screen.setBorder(this._evalNum(parts[2]));
      return;
    }

    // ── LOCATE ────────────────────────────────────────────────────────────
    if (u.startsWith('LOCATE ')) {
      const parts = this._splitArgs(s.slice(7).trim());
      const row = parts[0] ? this._evalNum(parts[0]) - 1 : this.screen.cy;
      const col = parts[1] ? this._evalNum(parts[1]) - 1 : this.screen.cx;
      this.screen.locate(row, col);
      return;
    }

    // ── GRAPHICS (enable/disable bitmap mode) ─────────────────────────────
    if (u.startsWith('GRAPHICS')) {
      const v = s.slice(8).trim();
      this.screen.setGraphics(v === '' || this._evalNum(v) !== 0);
      return;
    }

    // ── PSET ─────────────────────────────────────────────────────────────
    if (u.startsWith('PSET ') || u.startsWith('PSET(')) {
      const m = this._matchCoord2(s.slice(4).trim());
      if (m) {
        const c = m.extra ? this._evalNum(m.extra) : undefined;
        this.screen.setGraphics(true);
        this.screen.pset(this._evalNum(m.x1), this._evalNum(m.y1), c);
      }
      return;
    }

    // ── PRESET ────────────────────────────────────────────────────────────
    if (u.startsWith('PRESET ') || u.startsWith('PRESET(')) {
      const m = this._matchCoord2(s.slice(6).trim());
      if (m) this.screen.preset(this._evalNum(m.x1), this._evalNum(m.y1));
      return;
    }

    // ── LINE ─────────────────────────────────────────────────────────────
    if (u.startsWith('LINE ') || u.startsWith('LINE(')) {
      const m = this._matchCoord4(s.slice(4).trim());
      if (m) {
        const c = m.extra ? this._evalNum(m.extra) : undefined;
        this.screen.setGraphics(true);
        this.screen.line(
          this._evalNum(m.x1), this._evalNum(m.y1),
          this._evalNum(m.x2), this._evalNum(m.y2),
          c
        );
      }
      return;
    }

    // ── CIRCLE ───────────────────────────────────────────────────────────
    if (u.startsWith('CIRCLE ') || u.startsWith('CIRCLE(')) {
      const rest = s.slice(u.startsWith('CIRCLE(') ? 6 : 7).trim();
      const m    = this._matchCoord2(rest);
      if (m && m.extra) {
        const radius = this._evalNum(m.extra.split(',')[0]);
        const c      = m.extra.split(',')[1] ? this._evalNum(m.extra.split(',')[1]) : undefined;
        this.screen.setGraphics(true);
        this.screen.circle(this._evalNum(m.x1), this._evalNum(m.y1), radius, c);
      }
      return;
    }

    // ── RECT ─────────────────────────────────────────────────────────────
    if (u.startsWith('RECT ') || u.startsWith('RECT(')) {
      const m = this._matchCoord4(s.slice(4).trim());
      if (m) {
        const c = m.extra ? this._evalNum(m.extra) : undefined;
        this.screen.setGraphics(true);
        const x1 = this._evalNum(m.x1), y1 = this._evalNum(m.y1);
        const x2 = this._evalNum(m.x2), y2 = this._evalNum(m.y2);
        this.screen.fillRect(Math.min(x1,x2), Math.min(y1,y2),
                             Math.abs(x2-x1)+1, Math.abs(y2-y1)+1, c);
      }
      return;
    }

    // ── SOUND ────────────────────────────────────────────────────────────
    if (u.startsWith('SOUND ')) {
      const parts = this._splitArgs(s.slice(6).trim());
      const freq  = parts[0] ? this._evalNum(parts[0]) : 440;
      const dur   = parts[1] ? this._evalNum(parts[1]) * 50 : 200;
      const wave  = parts[2] ? String(this._eval(parts[2])) : 'square';
      this.screen.beep(freq, dur, wave);
      return;
    }

    // ── BEEP ─────────────────────────────────────────────────────────────
    if (u === 'BEEP') { this.screen.beep(); return; }

    // ── WAIT ─────────────────────────────────────────────────────────────
    if (u.startsWith('WAIT ')) {
      const sec = this._evalNum(s.slice(5).trim());
      await new Promise(r => setTimeout(r, sec * 1000));
      return;
    }

    // ── Unknown ───────────────────────────────────────────────────────────
    throw new Error(`SYNTAX`);
  }

  // ── PRINT ─────────────────────────────────────────────────────────────────

  async _stmtPrint(s) {
    // Strip keyword
    let rest = s.replace(/^PRINT\s?/i, '').replace(/^\?\s?/, '');

    if (!rest.trim()) { this.screen.println(); return; }

    const tokens  = this._tokenizePrint(rest);
    let   newline = true;

    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === ';') { newline = false; }
      else if (t === ',') {
        // advance to next 10-col tab stop
        const col  = this.screen.cx;
        const next = Math.ceil((col + 1) / 10) * 10;
        out += ' '.repeat(Math.max(1, next - col));
        newline = false;
      } else {
        out   += String(this._eval(t));
        newline = true;
      }
    }

    if (newline) this.screen.println(out);
    else         this.screen.print(out);
  }

  _tokenizePrint(expr) {
    const tokens = []; let cur = '', inQ = false, depth = 0;
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (c === '"') { inQ = !inQ; cur += c; continue; }
      if (!inQ) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if ((c === ';' || c === ',') && depth === 0) {
          if (cur.trim()) tokens.push(cur.trim());
          tokens.push(c);
          cur = '';
          continue;
        }
      }
      cur += c;
    }
    if (cur.trim()) tokens.push(cur.trim());
    return tokens;
  }

  // ── INPUT ─────────────────────────────────────────────────────────────────

  async _stmtInput(s) {
    let rest = s.replace(/^INPUT\s+/i, '');
    let prompt = '? ';

    // Optional prompt string
    const pm = rest.match(/^"([^"]*)"[;,]\s*([\s\S]+)/);
    if (pm) { prompt = pm[1] + '? '; rest = pm[2]; }

    const varNames = this._splitArgs(rest).map(v => v.trim());

    for (let i = 0; i < varNames.length; i++) {
      const p = i === 0 ? prompt : '?? ';
      const val = await new Promise(resolve => {
        this.screen.readLine(p, resolve);
      });
      if (this._stopReq || !this._running) return;
      this._setVar(varNames[i].toLowerCase(), val);
    }
  }

  // ── Assignment ────────────────────────────────────────────────────────────

  _stmtAssign(s) {
    // Identify first '=' that is not part of <=, >=, <>
    const eqIdx = this._findEq(s);
    if (eqIdx < 1) throw new Error('SYNTAX');
    const lhs = s.slice(0, eqIdx).trim();
    const rhs = s.slice(eqIdx + 1).trim();
    const val = this._eval(rhs);

    // Array element?
    const am = lhs.match(/^([A-Za-z_][A-Za-z0-9_]*[$%]?)\((.+)\)$/);
    if (am) {
      const name = am[1].toLowerCase();
      const idxs = this._splitArgs(am[2]).map(e => Math.floor(this._evalNum(e)));
      const key  = idxs.join(',');
      if (!this._arrays.has(name)) this._arrays.set(name, {});
      this._arrays.get(name)[key] = val;
    } else {
      this._setVar(lhs.toLowerCase(), val);
    }
  }

  _findEq(s) {
    let inQ = false, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (!inQ) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (depth === 0 && c === '=' && s[i - 1] !== '<' && s[i - 1] !== '>' && s[i + 1] !== '>') return i;
      }
    }
    return -1;
  }

  _setVar(name, rawVal) {
    const isStr = name.endsWith('$');
    const val   = isStr ? String(rawVal) : (isNaN(Number(rawVal)) ? 0 : Number(rawVal));
    this._vars.set(name, val);
  }

  // ── IF..THEN..ELSE ────────────────────────────────────────────────────────

  async _stmtIf(lineNum, s) {
    const u = s.toUpperCase();

    // Find THEN outside strings/parens
    let thenIdx = -1, elseIdx = -1;
    let inQ = false, depth = 0;
    for (let i = 3; i < u.length - 4; i++) {
      if (s[i] === '"') inQ = !inQ;
      if (!inQ) {
        if (s[i] === '(') depth++;
        if (s[i] === ')') depth--;
        if (depth === 0) {
          if (thenIdx === -1 && u.slice(i, i + 5) === ' THEN') thenIdx = i;
          if (thenIdx !== -1 && u.slice(i, i + 5) === ' ELSE') { elseIdx = i; break; }
        }
      }
    }

    if (thenIdx === -1) throw new Error('SYNTAX');

    const cond     = s.slice(s.match(/^IF\s*/i)[0].length, thenIdx).trim();
    const thenPart = (elseIdx > -1 ? s.slice(thenIdx + 5, elseIdx) : s.slice(thenIdx + 5)).trim();
    const elsePart = elseIdx > -1 ? s.slice(elseIdx + 5).trim() : null;

    const ok = this._evalBool(cond);

    const branch = async (part) => {
      if (!part) return;
      if (/^\d+$/.test(part)) { this._nextLine = parseInt(part); }
      else                    { await this._execLine(lineNum, part); }
    };

    if (ok) await branch(thenPart);
    else    await branch(elsePart);
  }

  // ── FOR..NEXT ────────────────────────────────────────────────────────────

  _stmtFor(s) {
    const m = s.match(/^FOR\s+([A-Za-z_][A-Za-z0-9_]*[$%]?)\s*=\s*([\s\S]+?)\s+TO\s+([\s\S]+?)(?:\s+STEP\s+([\s\S]+))?$/i);
    if (!m) throw new Error('SYNTAX');
    const varName = m[1].toLowerCase();
    const start   = this._evalNum(m[2]);
    const limit   = this._evalNum(m[3]);
    const step    = m[4] ? this._evalNum(m[4]) : 1;

    this._vars.set(varName, start);
    // Store the body line number (first line after FOR); null if FOR is last line
    const bodyLine = this._idx + 1 < this._lines.length ? this._lines[this._idx + 1] : null;
    this._forStk.push({ varName, limit, step, bodyLine });
  }

  _stmtNext(s) {
    const name = s.replace(/^NEXT\s*/i, '').trim().toLowerCase();

    // Find the matching FOR entry
    let entry = null, entryPos = -1;
    for (let i = this._forStk.length - 1; i >= 0; i--) {
      if (!name || this._forStk[i].varName === name) {
        entry = this._forStk[i]; entryPos = i; break;
      }
    }
    if (!entry) throw new Error('NEXT WITHOUT FOR');

    entry.varName && this._vars.set(entry.varName,
      (this._vars.get(entry.varName) || 0) + entry.step);

    const val  = this._vars.get(entry.varName) || 0;
    const done = entry.step >= 0 ? val > entry.limit : val < entry.limit;

    if (!done) {
      // Jump to body (line after FOR); if bodyLine is null the loop body is missing
      if (entry.bodyLine === null) throw new Error('FOR WITHOUT BODY');
      this._nextLine = entry.bodyLine;
    } else {
      this._forStk.splice(entryPos, 1);
    }
  }

  // ── DIM ───────────────────────────────────────────────────────────────────

  _stmtDim(s) {
    const m = s.match(/([A-Za-z_][A-Za-z0-9_]*[$%]?)\(([^)]+)\)/g);
    if (!m) throw new Error('SYNTAX');
    for (const decl of m) {
      const dm = decl.match(/^([A-Za-z_][A-Za-z0-9_]*[$%]?)\(([^)]+)\)$/);
      if (!dm) continue;
      const name = dm[1].toLowerCase();
      this._arrays.set(name, {});
    }
  }

  // ── READ ─────────────────────────────────────────────────────────────────

  _stmtRead(s) {
    for (const v of this._splitArgs(s)) {
      if (this._dataPtr >= this._data.length) throw new Error('OUT OF DATA');
      const raw = this._data[this._dataPtr++];
      const name = v.trim().toLowerCase();
      this._setVar(name, name.endsWith('$') ? raw.replace(/^"(.*)"$/, '$1') : parseFloat(raw) || 0);
    }
  }

  // ── Helper: coordinate parsing ────────────────────────────────────────────

  /** Parse "(x,y)" with optional ", extra" after closing paren */
  _matchCoord2(s) {
    const m = s.match(/^\(([^,)]+),([^)]+)\)\s*(?:,\s*([\s\S]+))?$/);
    if (!m) return null;
    return { x1: m[1], y1: m[2], extra: m[3] || null };
  }

  /** Parse "(x1,y1)-(x2,y2)" with optional ", extra" */
  _matchCoord4(s) {
    const m = s.match(/^\(([^,)]+),([^)]+)\)-\(([^,)]+),([^)]+)\)\s*(?:,\s*([\s\S]+))?$/);
    if (!m) return null;
    return { x1: m[1], y1: m[2], x2: m[3], y2: m[4], extra: m[5] || null };
  }

  // ── Helper: split comma-separated args (respecting parens/strings) ────────

  _splitArgs(s) {
    const parts = []; let cur = '', inQ = false, depth = 0;
    for (const c of s) {
      if (c === '"') inQ = !inQ;
      if (!inQ) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
      }
      cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  // ── Expression evaluator ──────────────────────────────────────────────────

  _eval(expr) {
    return new ExprParser(expr.trim(), this._vars, this._arrays, this.screen).parse();
  }

  _evalNum(expr)  { return Number(this._eval(expr)) || 0; }
  _evalBool(expr) { const v = this._eval(expr); return v !== 0 && v !== '' && v !== false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExprParser — recursive-descent expression evaluator
// ─────────────────────────────────────────────────────────────────────────────

class ExprParser {
  constructor(src, vars, arrays, screen) {
    this._src    = src;
    this._pos    = 0;
    this._vars   = vars;
    this._arrays = arrays;
    this._screen = screen;
  }

  parse() { const v = this._parseOr(); this._skipWs(); return v; }

  // ── Logical ──────────────────────────────────────────────────────────────
  _parseOr() {
    let v = this._parseAnd();
    while (this._matchKw('OR')) {
      const r = this._parseAnd();
      v = (v !== 0 && v !== '') || (r !== 0 && r !== '') ? -1 : 0;
    }
    return v;
  }

  _parseAnd() {
    let v = this._parseNot();
    while (this._matchKw('AND')) {
      const r = this._parseNot();
      v = (v !== 0 && v !== '') && (r !== 0 && r !== '') ? -1 : 0;
    }
    return v;
  }

  _parseNot() {
    if (this._matchKw('NOT')) {
      const v = this._parseNot();
      return (v === 0 || v === '') ? -1 : 0;
    }
    return this._parseCmp();
  }

  // ── Comparison ────────────────────────────────────────────────────────────
  _parseCmp() {
    let v = this._parseAdd();
    for (;;) {
      if (this._match('<>'))      { const r = this._parseAdd(); v = v !== r ? -1 : 0; }
      else if (this._match('<=')) { const r = this._parseAdd(); v = v <= r  ? -1 : 0; }
      else if (this._match('>=')) { const r = this._parseAdd(); v = v >= r  ? -1 : 0; }
      else if (this._match('<'))  { const r = this._parseAdd(); v = v <  r  ? -1 : 0; }
      else if (this._match('>'))  { const r = this._parseAdd(); v = v >  r  ? -1 : 0; }
      else if (this._peekEq())    { this._pos++; const r = this._parseAdd(); v = v === r ? -1 : 0; }
      else break;
    }
    return v;
  }

  /** Peek '=' only if it isn't '==' - used for comparison */
  _peekEq() {
    this._skipWs();
    return this._src[this._pos] === '=' && this._src[this._pos + 1] !== '=';
  }

  // ── Arithmetic ────────────────────────────────────────────────────────────
  _parseAdd() {
    let v = this._parseMul();
    for (;;) {
      if (this._match('+')) {
        const r = this._parseMul();
        v = (typeof v === 'string' || typeof r === 'string')
            ? String(v) + String(r)
            : v + r;
      } else if (this._matchMinus()) {
        v = v - this._parseMul();
      } else break;
    }
    return v;
  }

  _matchMinus() {
    this._skipWs();
    // Don't eat '-' that is followed by a digit if we're in unary position — but here
    // we only call _matchMinus in a binary context so it's safe.
    if (this._src[this._pos] === '-') { this._pos++; return true; }
    return false;
  }

  _parseMul() {
    let v = this._parsePow();
    for (;;) {
      if (this._match('*'))      { v = v * this._parsePow(); }
      else if (this._match('/')) {
        const r = this._parsePow();
        if (r === 0) throw new Error('DIVISION BY ZERO');
        v = v / r;
      }
      else if (this._match('\\')) { v = Math.trunc(v / this._parsePow()); }
      else if (this._matchKw('MOD')) { v = v % this._parsePow(); }
      else break;
    }
    return v;
  }

  _parsePow() {
    let v = this._parseUnary();
    if (this._match('^')) v = Math.pow(v, this._parsePow()); // right-associative
    return v;
  }

  _parseUnary() {
    this._skipWs();
    if (this._src[this._pos] === '-') { this._pos++; return -this._parseUnary(); }
    if (this._src[this._pos] === '+') { this._pos++; return  this._parseUnary(); }
    return this._parseAtom();
  }

  // ── Atom ──────────────────────────────────────────────────────────────────
  _parseAtom() {
    this._skipWs();
    const c = this._src[this._pos];

    // String literal
    if (c === '"') {
      this._pos++;
      let s = '';
      while (this._pos < this._src.length && this._src[this._pos] !== '"') s += this._src[this._pos++];
      if (this._src[this._pos] === '"') this._pos++;
      return s;
    }

    // Parenthesised expression
    if (c === '(') {
      this._pos++;
      const v = this._parseOr();
      this._skipWs();
      if (this._src[this._pos] === ')') this._pos++;
      return v;
    }

    // Number
    if (c >= '0' && c <= '9' || (c === '.' && this._src[this._pos + 1] >= '0')) {
      return this._parseNumber();
    }

    // Identifier / function / variable
    if (this._isAlpha(c)) {
      return this._parseIdent();
    }

    throw new Error(`SYNTAX near "${this._src.slice(this._pos, this._pos + 10)}"`);
  }

  _parseNumber() {
    let s = '';
    while (this._pos < this._src.length && /[0-9.eE+\-]/.test(this._src[this._pos])) {
      // Don't greedily eat '+'/'-' unless preceded by 'e'/'E'
      const prev = s[s.length - 1];
      const cc = this._src[this._pos];
      if ((cc === '+' || cc === '-') && prev !== 'e' && prev !== 'E') break;
      s += this._src[this._pos++];
    }
    return parseFloat(s);
  }

  _parseIdent() {
    let name = '';
    while (this._pos < this._src.length && /[A-Za-z0-9_$%.]/.test(this._src[this._pos]))
      name += this._src[this._pos++];

    const upper = name.toUpperCase();

    // Check for function call
    this._skipWs();
    if (this._src[this._pos] === '(') {
      return this._callFunction(upper, name);
    }

    // Built-in no-arg pseudo-variables
    if (upper === 'RND')   return Math.random();
    if (upper === 'TIME' || upper === 'TIMER') return Date.now() / 1000;
    if (upper === 'INKEY$') return this._screen ? this._screen.inkey() : '';
    if (upper === 'PI')    return Math.PI;
    if (upper === 'TRUE')  return -1;
    if (upper === 'FALSE') return 0;

    // Variable lookup
    const lname = name.toLowerCase();
    if (this._vars.has(lname)) return this._vars.get(lname);
    return name.toLowerCase().endsWith('$') ? '' : 0;
  }

  _callFunction(upper, rawName) {
    this._pos++; // consume '('
    const args = this._parseArgList();
    this._skipWs();
    if (this._src[this._pos] === ')') this._pos++;

    const g = (i) => args[i] !== undefined ? args[i] : 0;
    const gs = (i) => String(args[i] !== undefined ? args[i] : '');

    switch (upper) {
      case 'INT':    return Math.floor(g(0));
      case 'FIX':    return Math.trunc(g(0));
      case 'ABS':    return Math.abs(g(0));
      case 'SGN':    return Math.sign(g(0));
      case 'SQR':    return Math.sqrt(g(0));
      case 'SIN':    return Math.sin(g(0));
      case 'COS':    return Math.cos(g(0));
      case 'TAN':    return Math.tan(g(0));
      case 'ATN':    return Math.atan(g(0));
      case 'EXP':    return Math.exp(g(0));
      case 'LOG':    return Math.log(g(0));
      case 'LOG10':  return Math.log10(g(0));
      case 'RND':    return Math.random();
      case 'CHR$':   return String.fromCharCode(g(0));
      case 'STR$':   return String(g(0));
      case 'VAL':    return parseFloat(gs(0)) || 0;
      case 'LEN':    return gs(0).length;
      case 'ASC':    return (gs(0).charCodeAt(0)) || 0;
      case 'MID$': {
        const s2 = gs(0), st = Math.max(1, g(1)) - 1;
        const ln = args[2] !== undefined ? g(2) : undefined;
        return ln !== undefined ? s2.substring(st, st + ln) : s2.slice(st);
      }
      case 'LEFT$':  return gs(0).slice(0, g(1));
      case 'RIGHT$': return gs(0).slice(-Math.max(1, g(1)));
      case 'INSTR': {
        const base = args.length >= 3 ? g(0) - 1 : 0;
        const hay  = args.length >= 3 ? gs(1)     : gs(0);
        const ndl  = args.length >= 3 ? gs(2)     : gs(1);
        return hay.indexOf(ndl, base) + 1;
      }
      case 'SPACE$': return ' '.repeat(Math.max(0, g(0)));
      case 'STRING$': return gs(1).charAt(0).repeat(Math.max(0, g(0)));
      case 'MAX':    return Math.max(...args.map(Number));
      case 'MIN':    return Math.min(...args.map(Number));
      default: {
        // Array access
        const lname = rawName.toLowerCase();
        if (this._arrays && this._arrays.has(lname)) {
          const key = args.map(a => Math.floor(Number(a))).join(',');
          const val = this._arrays.get(lname)[key];
          return val !== undefined ? val : (lname.endsWith('$') ? '' : 0);
        }
        throw new Error(`UNDEFINED FUNCTION '${upper}'`);
      }
    }
  }

  _parseArgList() {
    const args = [];
    this._skipWs();
    if (this._src[this._pos] === ')') return args;
    args.push(this._parseOr());
    this._skipWs();
    while (this._src[this._pos] === ',') {
      this._pos++;
      args.push(this._parseOr());
      this._skipWs();
    }
    return args;
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  _skipWs() { while (this._pos < this._src.length && this._src[this._pos] === ' ') this._pos++; }

  _match(tok) {
    this._skipWs();
    if (this._src.startsWith(tok, this._pos)) {
      this._pos += tok.length; return true;
    }
    return false;
  }

  _matchKw(kw) {
    this._skipWs();
    const end = this._pos + kw.length;
    if (this._src.slice(this._pos, end).toUpperCase() !== kw) return false;
    const after = this._src[end];
    if (after && /[A-Za-z0-9_$]/.test(after)) return false;
    this._pos = end;
    return true;
  }

  _isAlpha(c) { return /[A-Za-z_]/.test(c); }
}
