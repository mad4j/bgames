# BGames — BASIC Game Studio

A **Progressive Web App** that lets you write and run BASIC programs on a Commodore 64-style screen emulator, directly in the browser — no installation needed.

## Features

| Feature | Details |
|---|---|
| **C64 Screen Emulator** | 40×25 text mode, 16-color palette, blinking cursor, scrolling |
| **Bitmap Graphics** | 320×200 pixel graphics layer — `PSET`, `LINE`, `CIRCLE`, `RECT` |
| **BASIC Interpreter** | `PRINT`, `INPUT`, `LET`, `IF/THEN/ELSE`, `GOTO`, `GOSUB/RETURN`, `FOR/NEXT`, `DATA/READ`, `DIM`, and more |
| **Sound** | SID-inspired tone generator — `SOUND freq, dur`, `BEEP` |
| **Game Library** | Save and load games via localStorage or `.bas` files |
| **PWA** | Installable, offline-capable via Service Worker |

## BASIC Statement Reference

```basic
REM comment           ' Line comment
PRINT "text"; var,    ' Output (;=no newline, ,=tab)
INPUT "prompt"; A$    ' Read user input
LET x = expr          ' Assign variable (LET optional)
IF cond THEN stmt ELSE stmt
GOTO linenum
GOSUB linenum / RETURN
FOR v=start TO end STEP s / NEXT v
DIM arr(size)
DATA val,... / READ var / RESTORE
CLS                   ' Clear screen
COLOR fg, bg, border  ' Set colors (0–15)
LOCATE row, col       ' Move cursor (1-based)
GRAPHICS 1/0          ' Enable/disable bitmap mode
PSET (x,y), color     ' Plot pixel
LINE (x1,y1)-(x2,y2), color
CIRCLE (cx,cy), r, color
RECT (x1,y1)-(x2,y2), color
SOUND freq, dur       ' Play tone (freq Hz, dur in 50ms units)
BEEP                  ' Short beep
WAIT sec              ' Pause execution
END / STOP
```

## Built-in Functions

`INT`, `ABS`, `SGN`, `SQR`, `SIN`, `COS`, `TAN`, `ATN`, `EXP`, `LOG`, `RND`,
`CHR$`, `STR$`, `VAL`, `LEN`, `ASC`, `MID$`, `LEFT$`, `RIGHT$`, `INSTR`,
`INKEY$` (reads keyboard without blocking), `SPACE$`, `MAX`, `MIN`

## Project Structure

```
index.html       — App shell (two-tab PWA layout)
css/style.css    — Professional dark theme
js/screen.js     — C64Screen class (canvas renderer, keyboard, sound)
js/basic.js      — BasicInterpreter + ExprParser classes
js/app.js        — BGamesApp controller (toolbar, tabs, load/save)
manifest.json    — PWA manifest
sw.js            — Service Worker (offline caching)
icons/           — App icons (SVG + PNG)
```

## Usage

Open `index.html` in a modern browser (or deploy to any static host).

- **Code tab** — write your BASIC program
- **▶ Run** — runs it on the C64 screen (switches to Play tab automatically)
- **■ Stop** — halts execution
- **Save** — store to browser library or download as `.bas` file
- **Load** — reload from library or open a `.bas` file from disk
