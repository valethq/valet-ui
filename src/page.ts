import { themeBootScript, themeCss } from "./app/themes";

const CSS = `
${themeCss()}
:root {
  --r-md: 14px;
  --r-lg: 20px;
  --r-xl: 26px;
  --st-done: #22c55e;
  --st-run: #f97316;
  --st-need: #eab308;
  --sb-w: 232px;
  --sb-inset: 12px;
  --sb-ease: cubic-bezier(.22, 1, .36, 1);
  --sb-ease-out: cubic-bezier(.64, 0, .78, 0);
  --sb-dur: .42s;
  --mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  --tint: color-mix(in srgb, var(--text) 6%, transparent);
  --tint-strong: color-mix(in srgb, var(--text) 10%, transparent);
}
@font-face {
  font-family: "Public Sans";
  src: url("/fonts/public-sans.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font: 14px/1.55 "Public Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-feature-settings: "cv11", "ss03";
  letter-spacing: -0.006em;
  -webkit-font-smoothing: antialiased;
  background: var(--bg);
  color: var(--text);
}
* { scrollbar-width: thin; scrollbar-color: var(--strong) transparent; }
::selection { background: color-mix(in srgb, var(--accent) 28%, transparent); }
button, input, select, textarea { font: inherit; color: inherit; }
button {
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 7px 14px;
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease, box-shadow .15s ease, transform .14s var(--sb-ease);
}
button:hover { background: var(--tint-strong); }
button:active:not(:disabled) { transform: scale(.96); }
button:disabled { opacity: .35; cursor: default; }
:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
input[type=text], input[type=password] {
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 10px 14px;
  transition: border-color .15s;
}
input:focus { outline: none; border-color: var(--strong); }

.icon { display: inline-flex; width: 18px; height: 18px; flex: none; }
.icon svg { width: 100%; height: 100%; }
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  flex: none;
}
.icon-btn:hover, .icon-btn[aria-expanded=true] { background: var(--tint); color: var(--text); }
.icon-btn:active:not(:disabled) { transform: scale(.9); }

.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
  height: 34px;
  border-radius: 999px;
  color: var(--muted);
  transition: background .15s, color .15s;
}
.chip:hover { background: var(--tint); color: var(--text); }
.chip select {
  -webkit-appearance: none;
  appearance: none;
  height: 100%;
  min-width: 0;
  max-width: 100%;
  background: transparent;
  border: none;
  border-radius: 999px;
  padding: 0 30px 0 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-overflow: ellipsis;
  field-sizing: content;
}
.chip.has-lead select { padding-left: 34px; }
.chip select:focus { outline: none; }
label.chip:focus-within { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent); }
.chip select:disabled { cursor: default; }
.chip select option, .chip select optgroup { background: var(--surface); color: var(--text); }
.chip .lead, .chip .chevron { display: inline-flex; flex: none; pointer-events: none; }
label.chip .lead, label.chip .chevron { position: absolute; }
label.chip .lead { left: 12px; }
label.chip .chevron { right: 11px; }
.chip .lead > * { width: 15px; height: 15px; }
button.chip .lead > * { animation: lead-in .24s var(--sb-ease); }
@keyframes lead-in { from { opacity: 0; transform: scale(.6) rotate(-20deg); } }
.chip .chevron { opacity: .7; transition: transform .22s var(--sb-ease), opacity .15s ease; }
button.chip[aria-expanded=true] .chevron { transform: rotate(180deg); opacity: 1; }
.chip .chevron .icon { width: 13px; height: 13px; }
button.chip {
  gap: 7px;
  max-width: 100%;
  padding: 0 10px 0 12px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
}
button.chip:hover:not(:disabled), button.chip[aria-expanded=true] { background: var(--tint); color: var(--text); }
button.chip:active:not(:disabled) { transform: none; }
.chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pop { position: relative; display: inline-flex; min-width: 0; }
.menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  min-width: 220px;
  max-width: min(320px, calc(100vw - 24px));
  max-height: min(420px, 60vh);
  overflow-y: auto;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: 0 18px 48px -16px var(--shadow);
  z-index: 25;
  transform-origin: 18px bottom;
  animation: menu-in .18s var(--sb-ease);
}
.menu.end { left: auto; right: 0; transform-origin: calc(100% - 18px) bottom; }
.menu.below { bottom: auto; top: calc(100% + 8px); transform-origin: 18px top; }
.menu.below.end { transform-origin: calc(100% - 18px) top; }
.menu.leaving { animation: menu-out .12s var(--sb-ease-out) forwards; }
@keyframes menu-in { from { opacity: 0; transform: translateY(4px) scale(.96); } }
@keyframes menu-out { to { opacity: 0; transform: scale(.97); } }
.leaving { pointer-events: none; }
.menu-section + .menu-section { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border); }
.menu-title { padding: 6px 10px 4px; font-size: 11.5px; color: var(--faint); }
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}
.menu-item:hover, .menu-item:focus-visible { background: var(--tint); outline: none; }
.menu-item:active:not(:disabled) { transform: none; }
.menu-lead { display: inline-flex; flex: none; }
.menu-lead .logo, .menu-lead .icon { width: 16px; height: 16px; }
.menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu-check { display: inline-flex; flex: none; color: var(--muted); visibility: hidden; }
.menu-check .icon { width: 15px; height: 15px; }
.menu-item.selected .menu-check { visibility: visible; }
.logo { display: inline-block; flex: none; width: 14px; height: 14px; background: var(--logo) center / contain no-repeat; }
.logo.mono {
  background: currentColor;
  -webkit-mask: var(--logo) center / contain no-repeat;
  mask: var(--logo) center / contain no-repeat;
}

.app { position: relative; height: 100vh; height: 100dvh; }
.chat-root { display: contents; }
.nav-toggle { display: none; }
.app.collapsed .nav-toggle { display: inline-flex; margin-left: -8px; }
.nav-backdrop { display: none; }
.sidebar-edge { display: none; position: fixed; top: 0; bottom: 0; left: 0; width: 14px; z-index: 19; }
.app.collapsed .sidebar-edge { display: block; }
.toast {
  position: fixed;
  bottom: 22px;
  right: 22px;
  max-width: min(420px, calc(100vw - 44px));
  background: color-mix(in srgb, var(--danger) 14%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  color: var(--text);
  padding: 11px 16px;
  border-radius: var(--r-md);
  box-shadow: 0 12px 32px -12px var(--shadow);
  font-size: 13px;
  z-index: 30;
  animation: toast-in .26s var(--sb-ease);
}
.toast.leaving { animation: toast-out .2s var(--sb-ease-out) forwards; }
@keyframes toast-in { from { opacity: 0; transform: translateY(10px) scale(.98); } }
@keyframes toast-out { to { opacity: 0; transform: translateX(12px); } }

.sidebar {
  position: fixed;
  z-index: 20;
  top: var(--sb-inset);
  bottom: var(--sb-inset);
  left: 0;
  width: var(--sb-w);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 30px 30px 0;
  box-shadow: 0 24px 64px -28px var(--shadow);
  transition: transform var(--sb-dur) var(--sb-ease), filter var(--sb-dur) var(--sb-ease), opacity var(--sb-dur) var(--sb-ease);
}
.app.collapsed .sidebar {
  transform: translateX(calc(-100% - 24px));
  filter: blur(16px);
  opacity: 0;
  pointer-events: none;
  transition-duration: .3s;
  transition-delay: 0s;
}
.app.collapsed:not(.no-peek) .sidebar-edge:hover + .sidebar,
.app.collapsed:not(.no-peek) .sidebar:hover,
.app.collapsed:not(.no-peek) .sidebar:has(select:focus) {
  transform: none;
  filter: blur(0);
  opacity: 1;
  pointer-events: auto;
  transition-duration: var(--sb-dur);
  transition-delay: 0s;
}
.sidebar-head .actions { display: flex; align-items: center; }
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 6px 2px 16px; }
.sidebar .brand { font-weight: 650; font-size: 16px; letter-spacing: -0.02em; }
.sidebar .project-picker { padding: 2px 6px 4px; }
.sidebar .project-picker .chip { display: flex; width: 100%; height: 32px; background: none; color: var(--muted); border-radius: var(--r-md); }
.sidebar .project-picker .chip:hover { background: var(--tint); color: var(--text); }
.sidebar .project-picker select { width: 100%; font-size: 13.5px; border-radius: var(--r-md); }
.sidebar .sessions { flex: 1; overflow-y: auto; padding: 2px 6px; display: flex; flex-direction: column; gap: 4px; }
.sidebar .sessions {
  -webkit-mask: linear-gradient(to bottom, transparent, #000 22px, #000 calc(100% - 22px), transparent);
  mask: linear-gradient(to bottom, transparent, #000 22px, #000 calc(100% - 22px), transparent);
  padding-block: 22px;
  margin-block: -22px;
}
.session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  height: calc(3 * 1.3em + 10px);
  padding: 5px 10px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  cursor: pointer;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.3;
  overflow: hidden;
  flex: none;
}
.session-row:hover { background: var(--tint); color: var(--text); }
.session-row:active:not(:disabled) { transform: scale(.985); }
.session-row.open { background: var(--raised); color: var(--text); }
.session-row.enter { animation: row-in .28s var(--sb-ease); }
.session-row.opening { animation: row-open .24s ease-out; }
.session-row.closing { animation: row-close .24s ease-out; }
@keyframes row-in { from { opacity: 0; transform: translateX(-8px); } }
@keyframes row-open { from { background-color: transparent; color: var(--muted); } }
@keyframes row-close { from { background-color: var(--raised); color: var(--text); } }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--st-done); }
.dot.running { background: var(--st-run); animation: pulse 1.4s ease-in-out infinite; }
.dot.attention { background: var(--st-need); box-shadow: 0 0 0 3px color-mix(in srgb, var(--st-need) 30%, transparent); }
.dot.stale { background: var(--faint); }
.dot.pop, .session-row .unread.pop { animation: dot-pop .36s var(--sb-ease); }
.dot.running.pop { animation: dot-pop .36s var(--sb-ease), pulse 1.4s ease-in-out .36s infinite; }
@keyframes dot-pop { from { opacity: .3; transform: scale(.3); } 55% { transform: scale(1.2); } }
.session-row .text { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.session-row .meta { font-size: 11px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-row .title {
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.session-row .unread { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.sidebar-foot { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px 6px; }

.main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin-left: calc(var(--sb-w) + var(--sb-inset));
  transition: margin-left .3s var(--sb-ease);
}
.app.collapsed .main { margin-left: 0; }
.main { position: relative; }
.chat-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: calc(2 * 1.35em + 32px);
  padding: 12px 20px 28px;
  background: linear-gradient(var(--bg) 62%, color-mix(in srgb, var(--bg) 0%, transparent));
  pointer-events: none;
}
.chat-header > * { pointer-events: auto; }
.chat-header .session-title { font-weight: 400; font-size: 15px; line-height: 1.35; letter-spacing: -0.01em; flex: 0 1 auto; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.chat-header .suffix { flex: none; color: var(--faint); }
@keyframes pulse { 50% { opacity: .3; } }

.messages {
  flex: 1;
  overflow-y: auto;
  padding: calc(2 * 1.35em + 44px) max(24px, calc((100% - 780px) / 2)) 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.msg { max-width: 100%; }
.messages > .enter { animation: msg-in .28s var(--sb-ease); }
.messages > .msg.user.enter { transform-origin: right bottom; animation-name: msg-in-user; }
.messages > .fade { animation: fade-in .2s ease-out; }
@keyframes msg-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes msg-in-user { from { opacity: 0; transform: translateY(6px) scale(.97); } }
.msg, .msg .bubble { min-width: 0; }
.msg.user { align-self: flex-end; max-width: 82%; }
.msg.assistant, .msg.system, .msg.tool { align-self: stretch; }
.msg .bubble { white-space: normal; overflow-wrap: break-word; }
.msg.user .bubble { background: var(--user); border-radius: var(--r-lg); border-bottom-right-radius: 8px; padding: 10px 16px; }
.msg.assistant .bubble { padding: 0 2px; }
.msg.system .bubble, .msg.tool .bubble { border: 1px dashed var(--border); border-radius: var(--r-md); padding: 8px 14px; color: var(--muted); font-size: 13px; }
.msg .bubble pre {
  background: var(--code);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 12px 14px;
  overflow-x: auto;
  white-space: pre;
  font-size: 12.5px;
  line-height: 1.6;
}
.msg .bubble code { font-family: var(--mono); font-size: 0.9em; }
.msg .bubble p > code, .msg .bubble code.inline { background: var(--raised); border-radius: 6px; padding: 2px 6px; }
.msg .bubble p { margin: 0 0 10px; white-space: pre-wrap; }
.msg .bubble p:last-child { margin-bottom: 0; }
.msg .bubble ul, .msg .bubble ol { margin: 0 0 10px; padding-left: 22px; }
.msg .bubble li { white-space: pre-wrap; }
.msg .bubble .md-quote {
  border-left: 3px solid var(--strong);
  padding-left: 12px;
  color: var(--muted);
  white-space: pre-wrap;
  margin: 0 0 10px;
}
.md-h { font-weight: 650; margin: 6px 0 8px; letter-spacing: -0.01em; }
.md-h1, .md-h2 { font-size: 1.15em; }
.msg .bubble a { color: var(--accent); text-underline-offset: 3px; }
.msg .bubble hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
.msg .meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint); margin: 5px 4px 0; }
.msg .meta .logo { width: 13px; height: 13px; filter: grayscale(1); opacity: .7; }
.msg.user .meta { justify-content: flex-end; }

.part-row {
  width: fit-content;
  max-width: 100%;
  margin: 0 0 2px;
  font-size: 12px;
}
.part-row[open] { margin: 2px 0 8px; }
.part-row summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  cursor: pointer;
  color: var(--faint);
  list-style: none;
  transition: color .2s, transform .2s var(--sb-ease);
}
.part-row summary > span:first-of-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.part-row summary::-webkit-details-marker { display: none; }
.part-row summary:hover { color: var(--text); transform: translateX(3px); }
.part-row summary:hover .status { color: var(--muted); }
.part-row summary::before {
  content: "";
  flex: none;
  width: 5px;
  height: 5px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform .2s var(--sb-ease);
}
.part-row[open] summary::before { transform: rotate(45deg); }
.part-row .status { margin-left: 4px; flex: none; transition: color .2s; font-size: 10.5px; color: var(--faint); font-family: var(--mono); white-space: nowrap; }
.part-row .status.running { color: var(--accent); }
.part-row .status.failed { color: var(--danger); }
.part-row .status.error, .part-row .status.denied { color: var(--danger); }
.part-row .body { margin: 4px 0 0 8px; padding: 2px 0 2px 12px; border-left: 2px solid var(--border); max-height: 260px; overflow-y: auto; }
.part-row.toggled .body { animation: body-in .22s var(--sb-ease); }
@keyframes body-in { from { opacity: 0; transform: translateY(-4px); } }
.part-row .body pre { margin: 0; padding: 0; border: none; border-radius: 0; background: none; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); font-size: 11.5px; line-height: 1.55; color: var(--muted); }
.part-row + :not(.part-row), :not(.part-row) + .part-row { margin-top: 10px; }
.part-row .trunc { color: var(--faint); }
.part-row .show-all { width: 24px; height: 24px; vertical-align: middle; margin-left: 4px; }
.part-row .show-all .icon { width: 14px; height: 14px; }
.part-notice { font-size: 12.5px; color: var(--muted); padding: 2px 4px; }
.part-notice.warn { color: var(--warn); }
.part-notice.error { color: var(--danger); }
.part-summary { font-size: 13px; color: var(--muted); border-left: 3px solid var(--strong); padding: 4px 12px; margin-bottom: 8px; }
.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--faint);
  font-size: 12px;
}
.divider::before, .divider::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
.divider span { text-align: center; padding: 3px 12px; border-radius: 999px; background: var(--raised); }

.md-table { overflow-x: auto; margin: 0 0 10px; border: 1px solid var(--border); border-radius: var(--r-md); }
.md-table table { border-collapse: collapse; font-size: 13.5px; width: 100%; }
.md-table th, .md-table td { padding: 7px 12px; text-align: left; }
.md-table thead th { background: var(--surface); border-bottom: 1px solid var(--border); font-weight: 600; }
.md-table tbody tr + tr td { border-top: 1px solid var(--border); }
.md-table .ta-c { text-align: center; }
.md-table .ta-r { text-align: right; }

.composer-wrap { padding: 4px max(16px, calc((100% - 812px) / 2)) 18px; }
.composer {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: 0 10px 40px -16px var(--shadow);
  transition: border-color .2s ease, box-shadow .25s ease;
}
.composer:focus-within {
  border-color: var(--strong);
  box-shadow: 0 10px 40px -16px var(--shadow), 0 0 0 3px color-mix(in srgb, var(--text) 5%, transparent);
}
.composer textarea {
  resize: none;
  min-height: 52px;
  max-height: 200px;
  background: transparent;
  border: none;
  outline: none;
  padding: 15px 20px 4px;
  line-height: 1.5;
}
.composer textarea::placeholder { color: var(--faint); }
.composer-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 8px; }
.composer-bar .controls { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1 1 auto; }
.composer-bar .actions { display: flex; align-items: center; gap: 6px; flex: none; }
.model-pop { flex: 0 1 auto; max-width: 260px; }
.effort-pop { flex: none; }
.context-bar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  cursor: default;
  animation: fade-in .24s ease-out;
}
.context-bar:hover, .context-bar:focus-visible { background: var(--tint); }
.context-bar:focus { outline: none; }
.context-bar .tip {
  position: absolute;
  right: -6px;
  bottom: calc(100% + 10px);
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--raised);
  box-shadow: 0 12px 32px -12px var(--shadow);
  color: var(--text);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity .12s, transform .12s;
  z-index: 5;
}
.context-bar:hover .tip, .context-bar:focus .tip { opacity: 1; transform: none; }
@property --fill { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
@property --ring { syntax: "<color>"; inherits: false; initial-value: transparent; }
.ring {
  --ring: var(--text);
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: conic-gradient(var(--ring) var(--fill), var(--strong) 0);
  transition: --fill .5s var(--sb-ease), --ring .3s ease;
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
}
.ring.warm { --ring: var(--warn); }
.ring.hot { --ring: var(--danger); }
.composer .send, .composer .stop { width: 36px; height: 36px; }
.composer .send { background: var(--accent); color: var(--on-accent); }
.composer .send:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 85%, var(--bg)); color: var(--on-accent); }
.composer .send:disabled { background: var(--raised); color: var(--faint); opacity: 1; }
.composer .send .icon { transition: transform .22s var(--sb-ease); }
.composer .send:disabled .icon { transform: translateY(2px) scale(.9); }
.composer .stop { background: var(--raised); color: var(--text); animation: pop-in .22s var(--sb-ease); }
@keyframes pop-in { from { opacity: 0; transform: scale(.7); } }
.composer .stop .icon { width: 16px; height: 16px; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, .5);
  animation: fade-in .2s ease-out;
}
.modal-backdrop.leaving { animation: fade-out .18s ease-in forwards; }
.modal-backdrop.leaving .modal { animation: modal-out .18s var(--sb-ease-out) forwards; }
@keyframes fade-in { from { opacity: 0; } }
@keyframes fade-out { to { opacity: 0; } }
@keyframes modal-in { from { opacity: 0; transform: translateY(10px) scale(.98); } }
@keyframes modal-out { to { opacity: 0; transform: translateY(6px) scale(.98); } }
.modal {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(760px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: 0 30px 80px -24px var(--shadow);
  animation: modal-in .26s var(--sb-ease);
}
.modal:focus { outline: none; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 8px 24px; }
.modal-head h2 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -0.02em; }
.modal-body { overflow-y: auto; padding: 4px 24px 24px; }
.settings-section { padding: 16px 0; }
.settings-section + .settings-section, .plugin-sections > .settings-section:first-child { border-top: 1px solid var(--border); }
.settings-section h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 12px; font-size: 13.5px; font-weight: 600; }
.settings-section .plugin-id { font-size: 11.5px; font-weight: 400; color: var(--faint); font-family: var(--mono); }
.section-desc { margin: -6px 0 14px; font-size: 13px; color: var(--muted); }
.theme-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.theme-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: transparent;
  font-size: 13px;
  text-align: left;
}
.theme-option:hover { background: var(--tint); }
.theme-option:active:not(:disabled) { transform: none; }
.theme-option[aria-checked=true] { border-color: var(--text); background: var(--tint); }
.swatch { display: inline-block; flex: none; width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--strong); }
.form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field.toggle { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
.field-label { font-size: 13px; font-weight: 500; }
.field-desc { font-size: 12px; color: var(--faint); }
.field.toggle .field-desc { margin-top: 2px; }
.input {
  width: 100%;
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 9px 13px;
  font-size: 13.5px;
  transition: border-color .15s;
}
.input:focus { outline: none; border-color: var(--strong); }
textarea.input { resize: vertical; line-height: 1.5; }
.input.mono { font-family: var(--mono); font-size: 12px; }
.chip.field-select { display: flex; width: 100%; height: 40px; background: var(--raised); border: 1px solid var(--border); border-radius: var(--r-md); color: var(--text); }
.chip.field-select select { width: 100%; font-size: 13.5px; font-weight: 400; }
.switch {
  -webkit-appearance: none;
  appearance: none;
  position: relative;
  flex: none;
  width: 38px;
  height: 22px;
  margin: 0;
  border-radius: 999px;
  background: var(--strong);
  cursor: pointer;
  transition: background .15s;
}
.switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg);
  transition: transform .15s;
}
.switch:checked { background: var(--accent); }
.switch:checked::after { transform: translateX(16px); background: var(--on-accent); }
.form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; }
.form-status { font-size: 12.5px; color: var(--muted); }
.form-status.error { color: var(--danger); }
button.primary { padding: 8px 18px; border: none; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 13px; }
button.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 85%, var(--bg)); }
.hint.error { color: var(--danger); }

.auth {
  height: 100vh;
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.auth .card {
  width: 100%;
  max-width: 360px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: 0 24px 60px -24px var(--shadow);
  padding: 32px;
  animation: modal-in .3s var(--sb-ease);
}
.auth h1 { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 6px; }
.auth .sub { color: var(--muted); font-size: 13px; margin-bottom: 22px; }
.auth label { display: block; font-size: 12.5px; color: var(--muted); margin: 14px 0 6px; }
.auth input { width: 100%; }
.auth button { width: 100%; margin-top: 22px; padding: 11px; background: var(--accent); border: none; color: var(--on-accent); font-weight: 600; }
.auth button:hover { background: color-mix(in srgb, var(--accent) 85%, var(--bg)); }
.auth .error { color: var(--danger); font-size: 13px; margin-top: 12px; min-height: 18px; }

.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--faint); }
.hint { font-size: 12px; color: var(--faint); padding: 4px 10px; }
.hint.conn { padding: 0 8px 8px; text-align: center; animation: hint-in .26s var(--sb-ease) .2s backwards; }
.hint.send-error { padding: 0 8px 8px; color: var(--danger); animation: hint-in .22s var(--sb-ease); }
@keyframes hint-in { from { opacity: 0; transform: translateY(4px); } }
::view-transition-old(root), ::view-transition-new(root) { animation-duration: .28s; animation-timing-function: ease; }

@media (max-width: 900px), (max-height: 500px) and (pointer: coarse) {
  .main, .app.collapsed .main { margin-left: 0; }
  .sidebar, .app.collapsed .sidebar {
    top: max(10px, env(safe-area-inset-top));
    bottom: max(10px, env(safe-area-inset-bottom));
    width: min(85vw, 300px);
    transform: translateX(calc(-100% - 24px));
    filter: blur(16px);
    opacity: 0;
    pointer-events: none;
    transition-timing-function: var(--sb-ease-out);
    transition-delay: 0s;
  }
  .app.nav-open .sidebar, .app.nav-open.collapsed .sidebar {
    transform: none;
    filter: blur(0);
    opacity: 1;
    pointer-events: auto;
    transition-timing-function: var(--sb-ease);
  }
  .sidebar-edge, .app.collapsed .sidebar-edge, .collapse-btn { display: none; }
  .nav-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .45);
    z-index: 19;
    display: none;
  }
  .app.nav-open .nav-backdrop { display: block; animation: fade-in .2s ease-out; }
  .nav-toggle { display: inline-flex; margin-left: -8px; }
  .chat-header { gap: 8px; padding: max(8px, env(safe-area-inset-top)) 14px 24px; }
  .messages { padding: calc(2 * 1.35em + 40px + env(safe-area-inset-top)) 14px 16px; }
  .msg.user { max-width: 90%; }
  .composer-wrap { padding: 2px 10px max(10px, env(safe-area-inset-bottom)); }
  .composer textarea { padding: 13px 16px 2px; }
  .model-pop { max-width: 46vw; }
  .context-bar { width: 38px; height: 38px; }
  .icon-btn, .composer .send, .composer .stop { width: 40px; height: 40px; }
  .chip { height: 38px; }
  .session-row { min-height: 44px; }
  .modal-backdrop { align-items: flex-end; padding: 0; }
  .modal { width: 100%; max-height: 90dvh; border-radius: var(--r-xl) var(--r-xl) 0 0; padding-bottom: env(safe-area-inset-bottom); animation-name: sheet-in; }
  .modal-backdrop.leaving .modal { animation-name: sheet-out; }
  @keyframes sheet-in { from { transform: translateY(40px); opacity: .4; } }
  @keyframes sheet-out { to { transform: translateY(40px); opacity: 0; } }
  .modal-body { padding: 4px 18px 20px; }
  .modal-head { padding-left: 18px; }
  .theme-grid { grid-template-columns: repeat(2, 1fr); }
  .part-row summary { min-height: 32px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition: none !important;
  }
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
}

@media (pointer: coarse) {
  input, select, textarea { font-size: 16px; }
  .chip select { font-size: 14px; }
}
`;

export function configScript(coreUrl: string): string {
  return `window.VALET = ${JSON.stringify({ coreUrl })};${themeBootScript}`;
}

export function indexHtml(coreUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>valet</title>
<style>${CSS}</style>
<script>${configScript(coreUrl)}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}
