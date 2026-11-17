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
  --sb-vinset: 10px;
  --sb-pad-l: 14px;
  --sb-pad-r: 12px;
  /* One motion language, taken from the sidebar: things travel in from where
   * they live while coming into focus (blur scales with size and travel). */
  --ease-focus: cubic-bezier(.22, 1, .36, 1);
  --ease-exit: cubic-bezier(.64, 0, .78, 0);
  --dur-focus: .42s;
  --dur-focus-sm: .24s;
  --blur-lg: 16px;
  --blur-md: 10px;
  --blur-sm: 4px;
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
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
html, body { height: 100%; }
body {
  margin: 0;
  font: 14px/1.55 var(--font);
  font-feature-settings: var(--font-features);
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
  transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease, box-shadow .15s ease, transform .14s var(--ease-focus);
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
button.chip .lead > * { --fx-from: scale(.7); --fx-blur: 3px; animation: focus-in var(--dur-focus-sm) var(--ease-focus); }
.chip .chevron { opacity: .7; transition: transform .22s var(--ease-focus), opacity .15s ease; }
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
  --fx-from: translateY(6px);
  --fx-blur: 6px;
  animation: focus-in var(--dur-focus-sm) var(--ease-focus);
}
.menu.end { left: auto; right: 0; transform-origin: calc(100% - 18px) bottom; }
.menu.below { --fx-from: translateY(-6px); bottom: auto; top: calc(100% + 8px); transform-origin: 18px top; }
.menu.below.end { transform-origin: calc(100% - 18px) top; }
.menu-search {
  position: sticky;
  top: -6px;
  z-index: 1;
  width: 100%;
  margin: 0 0 4px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--raised);
  font-size: 13px;
}
.menu-search:focus { outline: none; border-color: var(--strong); }
.menu-empty { padding: 8px 10px; font-size: 12.5px; color: var(--faint); }
.menu.leaving { animation: focus-out .2s var(--ease-focus) forwards; }
/* The shared entrance and exit. Each user sets --fx-from (where it travels
 * from, and back to) and --fx-blur. */
@keyframes focus-in { from { opacity: 0; filter: blur(var(--fx-blur, var(--blur-md))); transform: var(--fx-from, none); } }
@keyframes focus-out { to { opacity: 0; filter: blur(var(--fx-blur, var(--blur-md))); transform: var(--fx-from, none); } }
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
.nav-toggle {
  width: 0;
  margin-right: -10px;
  opacity: 0;
  transform: scale(.6);
  visibility: hidden;
  overflow: hidden;
  transition: width var(--dur-focus) var(--ease-focus), margin var(--dur-focus) var(--ease-focus), opacity var(--dur-focus) var(--ease-focus), transform var(--dur-focus) var(--ease-focus), visibility 0s linear var(--dur-focus);
}
.app.collapsed .nav-toggle {
  width: 36px;
  margin: 0;
  opacity: 1;
  transform: none;
  visibility: visible;
  transition-delay: 0s;
}
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
  --fx-from: translateX(calc(100% + 22px));
  --fx-blur: var(--blur-md);
  animation: focus-in var(--dur-focus) var(--ease-focus);
}
.toast.leaving { animation: focus-out var(--dur-focus) var(--ease-focus) forwards; }

.sidebar {
  position: fixed;
  z-index: 20;
  top: var(--sb-vinset);
  bottom: var(--sb-vinset);
  left: var(--sb-vinset);
  width: var(--sb-w);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 30px;
  box-shadow: 0 24px 64px -28px var(--shadow);
  transition: transform var(--dur-focus) var(--ease-focus), filter var(--dur-focus) var(--ease-focus), opacity var(--dur-focus) var(--ease-focus);
}
.app.collapsed .sidebar {
  transform: translateX(calc(-100% - var(--sb-vinset) - 24px));
  filter: blur(var(--blur-lg));
  opacity: 0;
  pointer-events: none;
  transition-duration: var(--dur-focus);
  transition-delay: 0s;
}
.app.collapsed:not(.no-peek) .sidebar-edge:hover + .sidebar,
.app.collapsed:not(.no-peek) .sidebar:hover,
.app.collapsed:not(.no-peek) .sidebar:has(select:focus) {
  transform: none;
  filter: blur(0);
  opacity: 1;
  pointer-events: auto;
  transition-duration: var(--dur-focus);
  transition-delay: 0s;
}
.sidebar-resizer {
  position: fixed;
  z-index: 21;
  top: calc(var(--sb-vinset) + 30px);
  bottom: calc(var(--sb-vinset) + 30px);
  left: calc(var(--sb-vinset) + var(--sb-w) - 4px);
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  border-radius: 4px;
}
.sidebar-resizer::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 3px;
  width: 2px;
  height: 40px;
  transform: translateY(-50%);
  border-radius: 2px;
  background: var(--accent);
  opacity: 0;
  transition: opacity .15s ease;
}
.sidebar-resizer:hover::after, .sidebar-resizer:focus-visible::after, .app.resizing .sidebar-resizer::after { opacity: .5; }
.app.collapsed .sidebar-resizer { display: none; }
.app.resizing { user-select: none; }
.app.resizing .sidebar, .app.resizing .main { transition: none; }
.sidebar-head .actions { display: flex; align-items: center; }
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 12px var(--sb-pad-r) 2px calc(var(--sb-pad-l) + 10px); }
.sidebar .brand { font-family: var(--font-head); font-weight: 650; font-size: 16px; letter-spacing: -0.02em; }
.sidebar .project-picker { padding: 2px var(--sb-pad-r) 4px var(--sb-pad-l); }
.sidebar .project-picker .chip { display: flex; width: 100%; height: 32px; background: none; color: var(--muted); border-radius: var(--r-md); }
.sidebar .project-picker .chip:hover { background: var(--tint); color: var(--text); }
.sidebar .project-picker select { width: 100%; font-size: 13.5px; border-radius: var(--r-md); }
.sidebar .sessions { flex: 1; overflow-y: auto; padding: 2px var(--sb-pad-r) 2px var(--sb-pad-l); display: flex; flex-direction: column; gap: 4px; }
.sidebar .sessions {
  -webkit-mask: linear-gradient(to bottom, transparent, #000 22px, #000 calc(100% - 22px), transparent);
  mask: linear-gradient(to bottom, transparent, #000 22px, #000 calc(100% - 22px), transparent);
  padding-block: 22px;
}
.session-row {
  display: flex;
  align-items: center;
  width: 100%;
  text-align: left;
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
  position: relative;
}
.session-row:hover { background: var(--tint); color: var(--text); }
.session-row:active:not(:disabled) { transform: scale(.985); }
.session-row.open { background: var(--raised); color: var(--text); }
.session-row.enter { --fx-from: translateX(-12px); --fx-blur: var(--blur-sm); animation: focus-in var(--dur-focus) var(--ease-focus); }
.session-row.opening { animation: row-open .3s var(--ease-focus); }
.session-row.closing { animation: row-close .3s var(--ease-focus); }
@keyframes row-open { from { background-color: transparent; color: var(--muted); } }
@keyframes row-close { from { background-color: var(--raised); color: var(--text); } }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--st-done); }
.dot.running { background: var(--st-run); animation: pulse 1.4s ease-in-out infinite; }
.dot.attention { background: var(--st-need); box-shadow: 0 0 0 3px color-mix(in srgb, var(--st-need) 30%, transparent); }
.dot.stale { background: var(--faint); }
.dot.failed { background: var(--danger); }
.dot.pop { animation: dot-pop .36s var(--ease-focus); }
.dot.running.pop { animation: dot-pop .36s var(--ease-focus), pulse 1.4s ease-in-out .36s infinite; }
@keyframes dot-pop { from { opacity: .3; transform: scale(.3); } 55% { transform: scale(1.2); } }
.session-row .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.session-row .meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint); }
.session-row .meta-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-row .meta .subs { display: inline-flex; align-items: center; gap: 4px; flex: none; color: var(--muted); }
.session-row .meta .subs::before { content: "·"; color: var(--faint); margin-right: 2px; }
.session-row .meta .subs .icon { width: 11px; height: 11px; }
.session-row .meta .subs.live { color: var(--st-run); }
.session-row .meta .subs.need { color: var(--st-need); }
.session-row[data-unread="1"] .title { font-weight: 550; }
.session-row .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-item { position: relative; display: flex; flex: none; }
.session-item .session-row { padding-right: 36px; }
.session-item .row-more { position: absolute; top: calc(50% - 21px); bottom: auto; right: 0; width: 28px; height: 28px; opacity: 0; transition: opacity .15s ease, background-color .15s ease, color .15s ease; }
.session-item:hover .row-more, .session-item:focus-within .row-more, .row-more[aria-expanded=true] { opacity: 1; }
.menu.session-menu { position: fixed; bottom: auto; }
.menu-item.danger { color: var(--danger); }
@media (hover: none) { .session-item .row-more { opacity: 1; } }
.sidebar-foot { display: flex; align-items: center; justify-content: space-between; padding: 4px var(--sb-pad-r) 12px var(--sb-pad-l); }

.main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin-left: calc(var(--sb-vinset) + var(--sb-w) + var(--sb-inset));
  transition: margin-left var(--dur-focus) var(--ease-focus);
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
  padding: 12px max(16px, calc((100% - 812px) / 2)) 28px;
  background: linear-gradient(var(--bg) 62%, color-mix(in srgb, var(--bg) 0%, transparent));
  pointer-events: none;
}
.chat-header > * { pointer-events: auto; }
.chat-header .title-group { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; flex: 0 1 auto; min-width: 0; }
/* Toggle + title stay left (the toggle's width transition makes room for the
 * title when collapsed); the session menu is pinned right. */
.chat-header > :last-child { margin-left: auto; }
.chat-header .title-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; max-width: 100%; }
.chat-header .crumb { display: inline-flex; align-items: center; gap: 4px; max-width: min(100%, 320px); padding: 2px 6px 2px 2px; margin-left: -2px; border: none; border-radius: var(--r-md); background: none; color: var(--faint); font-size: 11.5px; line-height: 1.3; cursor: pointer; transition: color .15s, background-color .15s; }
.chat-header .crumb:hover { color: var(--text); background: var(--tint); }
.chat-header .crumb .icon { width: 12px; height: 12px; }
.chat-header .crumb-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-tag { flex: none; font-family: var(--mono); font-size: 10.5px; line-height: 1.4; padding: 0 7px; border: 1px solid var(--border); border-radius: 99px; color: var(--faint); white-space: nowrap; }
.chat-header .session-title { font-family: var(--font-head); font-weight: 400; font-size: 15px; line-height: 1.35; letter-spacing: -0.01em; flex: 0 1 auto; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.chat-header .suffix { flex: none; color: var(--faint); }
@keyframes pulse { 50% { opacity: .3; } }

.messages {
  flex: 1;
  container: chat / inline-size;
  overflow-y: auto;
  padding: calc(2 * 1.35em + 44px) max(16px, calc((100% - 812px) / 2)) 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.main[data-landing] { justify-content: center; }
.main[data-landing] .messages { flex: none; overflow: visible; padding-block: 0 20px; }
.msg { max-width: 100%; }
.messages > .enter { --fx-from: translateY(10px); --fx-blur: var(--blur-sm); animation: focus-in var(--dur-focus) var(--ease-focus); }
.messages > .msg.user.enter { --fx-from: translate(8px, 6px); }
.messages > .fade { --fx-blur: var(--blur-sm); animation: focus-in .3s var(--ease-focus); }
.msg, .msg .bubble { min-width: 0; }
.msg.user { align-self: flex-end; max-width: 82%; }
.msg.assistant, .msg.system, .msg.tool { align-self: stretch; }
.msg .bubble { white-space: normal; overflow-wrap: break-word; }
.msg.user .bubble { background: var(--user); border-radius: var(--r-lg); border-bottom-right-radius: 8px; padding: 10px 16px; }
.msg.assistant .bubble { padding: 0 2px; }
.msg.system .bubble, .msg.tool .bubble { border: 1px dashed var(--border); border-radius: var(--r-md); padding: 8px 14px; color: var(--muted); font-size: 13px; }
.msg.system.bare .bubble { border: none; padding: 0 2px; color: inherit; font-size: inherit; }
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
.md-h { font-family: var(--font-head); font-weight: 650; margin: 6px 0 8px; letter-spacing: -0.01em; }
.md-h1, .md-h2 { font-size: 1.15em; }
.msg .bubble a { color: var(--accent); text-underline-offset: 3px; }
.msg .bubble hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
.msg .meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint); margin: 5px 4px 0; }
.msg .meta .logo { width: 13px; height: 13px; background: currentColor; -webkit-mask: var(--logo) center / contain no-repeat; mask: var(--logo) center / contain no-repeat; }
.msg.user .meta { justify-content: flex-end; }
.msg .meta .copy-btn, .msg .meta .fork-btn { width: 26px; height: 26px; color: var(--faint); margin: -4px 0 -4px -6px; }
.msg.user .meta .copy-btn, .msg.user .meta .fork-btn { margin-left: 0; margin-right: -6px; }
.msg .meta .copy-btn .icon, .msg .meta .fork-btn .icon { width: 14px; height: 14px; }
.msg .meta .copy-btn:hover, .msg .meta .fork-btn:hover { color: var(--text); }
.queued-badge { align-self: center; font-size: 11.5px; color: var(--faint); white-space: nowrap; padding: 0 4px; }

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
  transition: color .2s, transform .2s var(--ease-focus);
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
  transition: transform .2s var(--ease-focus);
}
.part-row[open] summary::before { transform: rotate(45deg); }
.part-row .status { margin-left: 4px; flex: none; transition: color .2s; font-size: 10.5px; color: var(--faint); font-family: var(--mono); white-space: nowrap; }
.part-row .status.running { color: var(--accent); }
.part-row .status.failed { color: var(--danger); }
.part-row .status.error, .part-row .status.denied { color: var(--danger); }
.part-row.warn > summary { color: var(--warn); }
.part-row.error > summary { color: var(--danger); }
.part-fields { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0 0 6px; font-family: var(--mono); font-size: 11.5px; }
.part-fields dt { color: var(--faint); }
.part-fields dd { margin: 0; color: var(--muted); overflow-wrap: anywhere; }
.part-origin { margin-top: 6px; font-size: 10.5px; color: var(--faint); }
.part-origin a { color: inherit; text-underline-offset: 2px; }
.part-row .body { margin: 4px 0 0 8px; padding: 2px 0 2px 12px; border-left: 2px solid var(--border); max-height: 260px; overflow-y: auto; }
.part-row::details-content {
  block-size: 0;
  overflow-y: clip;
  opacity: 0;
  interpolate-size: allow-keywords;
  transition: block-size .25s var(--ease-focus), opacity .22s ease, content-visibility .25s allow-discrete;
}
.part-row[open]::details-content { block-size: auto; opacity: 1; }
.part-row.toggled .body { --fx-from: translateY(-4px); --fx-blur: 3px; animation: focus-in .3s var(--ease-focus); }
.part-row .body pre { margin: 0; padding: 0; border: none; border-radius: 0; background: none; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); font-size: 11.5px; line-height: 1.55; color: var(--muted); }
.part-row + :not(.part-row), :not(.part-row) + .part-row { margin-top: 10px; }
.sub-card { display: flex; flex-direction: column; gap: 2px; width: min(100%, 460px); margin: 8px 0; padding: 10px 6px 6px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--raised); font-size: 13px; line-height: 1.4; }
.sub-card.failed { border-color: color-mix(in srgb, var(--danger) 35%, var(--border)); }
.sub-top { display: flex; align-items: center; gap: 8px; padding: 0 8px 6px; font-size: 11px; color: var(--faint); }
.sub-top .sub-tag { padding: 0; border: none; font-size: 11px; color: var(--muted); }
.sub-status { margin-left: auto; font-family: var(--mono); font-size: 10.5px; white-space: nowrap; }
.sub-stage { padding: 6px 8px 2px; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--faint); }
.sub-row { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 6px 8px; border: none; border-radius: calc(var(--r-md) - 4px); background: none; color: var(--text); font: inherit; text-align: left; }
button.sub-row { cursor: pointer; transition: background-color .15s; }
button.sub-row:hover { background: var(--tint); }
.sub-row.idle { color: var(--faint); }
.sub-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-state { flex: none; font-family: var(--mono); font-size: 10.5px; color: var(--faint); white-space: nowrap; }
.sub-row .icon { flex: none; width: 14px; height: 14px; color: var(--faint); transition: transform .2s var(--ease-focus), color .15s; }
button.sub-row:hover .icon { color: var(--accent); transform: translateX(3px); }
.dot.idle { background: none; box-shadow: inset 0 0 0 1.5px var(--faint); }
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

.composer-wrap { position: relative; padding: 4px max(16px, calc((100% - 812px) / 2)) 18px; }
.composer-wrap::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 24px;
  z-index: 4;
  background: linear-gradient(transparent, var(--bg) 90%);
  pointer-events: none;
}
.main[data-landing] .composer-wrap::before { display: none; }
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
  --fx-from: scale(.8);
  --fx-blur: 3px;
  animation: focus-in .3s var(--ease-focus);
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
  transition: --fill .5s var(--ease-focus), --ring .3s ease;
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
}
.ring.warm { --ring: var(--warn); }
.ring.hot { --ring: var(--danger); }
.composer .send, .composer .stop { width: 36px; height: 36px; }
.composer .send { background: var(--accent); color: var(--on-accent); }
.composer .send:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 85%, var(--bg)); color: var(--on-accent); }
.composer .send:disabled { background: var(--raised); color: var(--faint); opacity: 1; }
.composer .send .icon { transition: transform .22s var(--ease-focus); }
.composer .send:disabled .icon { transform: translateY(2px) scale(.9); }
.composer .stop { --fx-from: scale(.7); --fx-blur: var(--blur-sm); background: var(--raised); color: var(--text); animation: focus-in var(--dur-focus-sm) var(--ease-focus); }
.composer .stop .icon { width: 16px; height: 16px; }
.attach-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 0; }
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  height: 40px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--raised);
  font-size: 13px;
  --fx-from: translateY(6px);
  --fx-blur: var(--blur-sm);
  animation: focus-in .3s var(--ease-focus);
}
.attach-chip.pending { opacity: .55; }
.attach-chip > .icon { width: 16px; height: 16px; flex: none; color: var(--muted); }
.attach-chip .attach-remove { width: 28px; height: 28px; flex: none; }
.attach-chip .attach-remove .icon { width: 14px; height: 14px; }
.attach-thumb { width: 28px; height: 28px; flex: none; object-fit: cover; border-radius: 6px; }
.attach-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Images come into focus once loaded; blobImage() marks cached ones loaded at once. */
.media-img { opacity: 0; filter: blur(var(--blur-md)); transition: opacity .3s var(--ease-focus), filter var(--dur-focus) var(--ease-focus), transform var(--dur-focus) var(--ease-focus); }
.media-img.loaded { opacity: 1; filter: none; }

/* A user's images: a deck dealt left to right, each card on the one before.
 * --step is how much of each card shows; hover spreads it as far as the
 * column allows, and the hovered card lifts above its neighbours. */
.deck {
  --card: 84px;
  --step: clamp(10px, calc(96px / var(--n)), 24px);
  display: flex;
  width: fit-content;
  max-width: 100%;
  margin: 0 0 6px auto;
  padding-top: 6px;
}
.deck:hover, .deck:focus-within { --step: min(calc(var(--card) + 6px), calc((80cqw - var(--card)) / max(1, var(--n) - 1))); }
.deck-card {
  position: relative;
  flex: none;
  width: var(--card);
  height: var(--card);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--strong);
  border-radius: 12px;
  background: var(--raised);
  box-shadow: -6px 0 14px -4px var(--shadow);
  cursor: zoom-in;
  transition: margin var(--dur-focus) var(--ease-focus), transform .22s var(--ease-focus), box-shadow .22s ease, border-color .15s ease;
}
.deck-card:first-child { box-shadow: none; }
.deck-card + .deck-card { margin-left: calc(var(--step) - var(--card)); }
.deck-card:hover, .deck-card:focus-visible { z-index: 2; transform: translateY(-5px); border-color: var(--accent); box-shadow: 0 12px 24px -8px var(--shadow); background: var(--raised); }
.deck-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.deck.single .deck-card { width: auto; height: auto; min-width: var(--card); min-height: var(--card); }
.deck.single .deck-card img { width: auto; max-width: min(260px, 60cqw); max-height: 180px; }
.msg.enter .deck-card { animation: card-deal .42s var(--ease-focus) backwards; animation-delay: calc(var(--i) * 45ms + 40ms); }
@keyframes card-deal { from { opacity: 0; filter: blur(6px); transform: translateX(-18px); } }

/* Images the model presented: framed figures. */
.figures { display: flex; flex-direction: column; gap: 8px; max-width: 560px; margin: 4px 0 12px; }
.figures:last-child { margin-bottom: 0; }
.figures.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.part-figure { margin: 0; min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--panel); --fx-from: translateY(8px); --fx-blur: 6px; animation: focus-in var(--dur-focus) var(--ease-focus); transition: border-color .15s ease; }
.part-figure:hover { border-color: var(--strong); }
.fig-pic {
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 72px;
  padding: 0;
  overflow: hidden;
  border: none;
  border-radius: 0;
  background: repeating-conic-gradient(var(--raised) 0 25%, var(--panel) 0 50%) 0 0 / 16px 16px;
  cursor: zoom-in;
}
.fig-pic:hover { background: repeating-conic-gradient(var(--raised) 0 25%, var(--panel) 0 50%) 0 0 / 16px 16px; }
.fig-pic:active:not(:disabled) { transform: none; }
.fig-pic img { display: block; max-width: 100%; max-height: 360px; }
.fig-pic:hover img.loaded { transform: scale(1.012); }
.figures.grid .fig-pic img { width: 100%; height: 180px; max-height: none; object-fit: cover; object-position: top; }
.part-figure figcaption { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 6px 4px 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.part-figure .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.part-figure .dim { flex: none; font-family: var(--mono); font-size: 11px; color: var(--faint); }
.part-figure .acts { display: flex; flex: none; margin-left: auto; }
.part-figure .fig-act { width: 28px; height: 28px; color: var(--faint); }
.part-figure .fig-act .icon { width: 14px; height: 14px; }
.figures.grid .dim, .figures.grid .fig-act:not([data-save]) { display: none; }

/* Lightbox: the image grows out of its thumbnail (a FLIP in lightbox.ts). */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: blur(var(--blur-lg));
  animation: fade-in var(--dur-focus) var(--ease-focus);
}
.lightbox.leaving { animation: fade-out .34s var(--ease-focus) forwards; pointer-events: none; }
.lb-top { display: flex; align-items: center; gap: 10px; min-width: 0; padding: max(10px, env(safe-area-inset-top)) 12px 10px 20px; font-size: 13px; color: var(--muted); --fx-from: translateY(-6px); --fx-blur: var(--blur-sm); animation: focus-in var(--dur-focus) var(--ease-focus); }
.lb-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 550; }
.lb-count { flex: none; font-family: var(--mono); font-size: 11.5px; color: var(--faint); }
.lb-src { flex: none; padding: 1px 9px; border: 1px solid var(--border); border-radius: 99px; font-size: 11px; color: var(--faint); }
.lb-acts { display: flex; flex: none; gap: 4px; margin-left: auto; }
.lightbox .lb-btn { width: 34px; height: 34px; background: var(--raised); }
.lightbox .lb-btn:hover { background: color-mix(in srgb, var(--text) 14%, var(--raised)); }
.lightbox .lb-btn .icon { width: 16px; height: 16px; }
.lightbox .lb-btn.done { color: var(--ok); }
.lightbox .lb-1to1 { width: auto; padding: 0 11px; font-family: var(--mono); font-size: 11.5px; }
.lightbox .lb-1to1.on { background: var(--accent); color: var(--on-accent); }
.lightbox .lb-btn[hidden] { display: none; }
.lb-stage { position: relative; display: grid; place-items: center; min-height: 0; padding: 8px 68px; overflow: hidden; touch-action: none; }
.lb-img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 10px;
  box-shadow: 0 30px 80px -24px var(--shadow);
  opacity: 0;
  cursor: zoom-in;
  user-select: none;
  -webkit-user-drag: none;
  transition: transform .34s var(--ease-focus), opacity .3s var(--ease-focus);
}
.lb-img.loaded { opacity: 1; }
.lb-img.instant { transition: opacity .3s var(--ease-focus); }
.lightbox.zoomed .lb-img { cursor: grab; }
.lightbox.panning .lb-img { cursor: grabbing; }
.lightbox .lb-img { --fx-from: translateY(16px); --fx-blur: var(--blur-md); }
.lightbox.pop .lb-img { animation: focus-in var(--dur-focus) var(--ease-focus); }
.lightbox.leaving.pop .lb-img, .lightbox.leaving.zoomed .lb-img { animation: focus-out .34s var(--ease-focus) forwards; }
.lightbox .lb-img.from-next { --fx-from: translateX(40px); animation: focus-in var(--dur-focus) var(--ease-focus); }
.lightbox .lb-img.from-prev { --fx-from: translateX(-40px); animation: focus-in var(--dur-focus) var(--ease-focus); }
.lightbox .lb-nav { position: absolute; top: 50%; z-index: 2; width: 40px; height: 40px; margin-top: -20px; background: var(--raised); transition: opacity .3s var(--ease-focus), background-color .15s ease, color .15s ease, transform .14s var(--ease-focus); }
.lightbox .lb-nav:hover { background: color-mix(in srgb, var(--text) 14%, var(--raised)); }
.lightbox .lb-nav:disabled { opacity: 0; pointer-events: none; }
.lb-prev { left: 14px; }
.lb-next { right: 14px; }
.lb-film {
  justify-self: center;
  display: flex;
  gap: 6px;
  max-width: calc(100vw - 32px);
  margin: 6px 0 max(14px, env(safe-area-inset-bottom));
  padding: 5px;
  overflow-x: auto;
  border-radius: 14px;
  background: color-mix(in srgb, var(--raised) 85%, transparent);
  scrollbar-width: none;
  --fx-from: translateY(12px);
  --fx-blur: 6px;
  animation: focus-in var(--dur-focus) var(--ease-focus) .06s backwards;
  transition: opacity .3s var(--ease-focus), transform var(--dur-focus) var(--ease-focus), filter var(--dur-focus) var(--ease-focus);
}
.lightbox.zoomed .lb-film, .lightbox.zoomed .lb-nav { opacity: 0; pointer-events: none; }
.lightbox.zoomed .lb-film { transform: translateY(12px); filter: blur(6px); }
.lightbox .lb-thumb { flex: none; width: 52px; height: 38px; padding: 0; overflow: hidden; border: none; border-radius: 8px; background: var(--panel); opacity: .45; outline: 2px solid transparent; outline-offset: 1px; transition: opacity .15s ease, outline-color .2s ease, transform .14s var(--ease-focus); }
.lightbox .lb-thumb:hover { opacity: .8; }
.lightbox .lb-thumb.on { opacity: 1; outline-color: var(--accent); }
.lb-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.lb-source { visibility: hidden; }
.part-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  font-size: 13px;
}
button.part-file { background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
button.part-file:hover { background: var(--tint); }
.part-file .icon { width: 16px; height: 16px; flex: none; color: var(--muted); }
.part-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, .42);
  backdrop-filter: blur(6px);
  animation: fade-in var(--dur-focus) var(--ease-focus);
}
.modal-backdrop.leaving { animation: fade-out var(--dur-focus) var(--ease-focus) forwards; }
.modal-backdrop.leaving .modal { animation: focus-out var(--dur-focus) var(--ease-focus) forwards; }
@keyframes fade-in { from { opacity: 0; } }
@keyframes fade-out { to { opacity: 0; } }
.modal {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(760px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: 0 30px 80px -24px var(--shadow);
  --fx-from: translateY(18px);
  --fx-blur: 12px;
  animation: focus-in var(--dur-focus) var(--ease-focus);
}
.modal:focus { outline: none; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 8px 24px; }
.modal-head h2 { font-family: var(--font-head); margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -0.02em; }
.modal-body { overflow-y: auto; padding: 0 0 24px; }
.modal.settings-modal { width: min(720px, 100%); height: min(640px, 100%); max-height: none; }
.modal.settings-modal .modal-body { flex: 1; min-height: 0; display: flex; }
.settings-tabbed { display: flex; flex: 1; min-height: 0; width: 100%; }
.settings-tabs { display: flex; flex-direction: column; gap: 2px; flex: none; width: 176px; min-height: 0; overflow-y: auto; padding: 4px 12px 16px 16px; border-right: 1px solid var(--border); scrollbar-width: none; }
.settings-tabs::-webkit-scrollbar { display: none; }
.settings-tab {
  flex: none;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 550;
  text-align: left;
  white-space: nowrap;
}
.settings-tab:hover { background: var(--tint); color: var(--text); }
.settings-tab[aria-selected=true] { background: var(--tint-strong); color: var(--text); font-weight: 650; }
.settings-tab:focus-visible { outline-offset: -2px; }
.settings-panels { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 18px 24px 8px; }
.settings-section { padding: 0; }
.settings-section h3 { font-family: var(--font-head); display: flex; align-items: baseline; gap: 8px; margin: 0 0 12px; font-size: 13.5px; font-weight: 600; }
.settings-section .plugin-id { font-size: 11.5px; font-weight: 400; color: var(--faint); font-family: var(--mono); }
.settings-section .plugin-name { font-size: 11.5px; font-weight: 400; color: var(--faint); }
.section-desc { margin: -6px 0 14px; font-size: 13px; color: var(--muted); }
.form-actions.start { justify-content: flex-start; flex-wrap: wrap; }
.input[aria-invalid=true] { border-color: var(--danger); }
.chip.danger { color: var(--danger); }
button.chip .icon, button.primary .icon { width: 15px; height: 15px; }
button.primary { display: inline-flex; align-items: center; gap: 7px; }
.modal.settings-modal { transition: width var(--dur-focus) var(--ease-focus), height var(--dur-focus) var(--ease-focus); }
.modal.settings-modal:has(.theme-studio:not([hidden])) { width: min(1040px, 100%); height: min(740px, 100%); }
.settings-panels:has(> .theme-studio:not([hidden])) { display: flex; padding: 0; overflow: hidden; }
.theme-studio { display: grid; grid-template-columns: 304px minmax(0, 1fr); flex: 1; min-height: 0; }
.theme-studio[hidden] { display: none; }
.theme-library { min-height: 0; overflow-y: auto; padding: 14px 18px 20px 20px; border-right: 1px solid var(--border); }
.library-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.library-head h3 { margin: 0; }
.library-actions { display: flex; gap: 2px; margin-right: -8px; }
.library-actions .chip { padding: 0 11px 0 9px; }
.theme-import { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.theme-import[hidden] { display: none; }
.theme-import .form-actions { margin-top: 0; }
.theme-lists { display: flex; flex-direction: column; gap: 18px; }
.group-label { display: block; margin-bottom: 8px; font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: var(--faint); }
.theme-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px; }
.theme-tile { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 0; border: 0; border-radius: 0; background: none; color: var(--muted); font-size: 12px; text-align: center; }
.theme-tile:hover { background: none; color: var(--text); }
.theme-tile:focus-visible { outline: none; }
.theme-tile:focus-visible .tile-art { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
.theme-tile[aria-checked=true] { color: var(--text); font-weight: 600; }
.tile-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-art {
  position: relative;
  display: block;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--r-md);
  background: var(--bg);
  box-shadow: 0 0 0 1px var(--border);
  transition: box-shadow .18s ease;
}
.theme-tile:hover .tile-art { box-shadow: 0 0 0 1px var(--strong), 0 8px 18px -10px var(--shadow); }
.theme-tile[aria-checked=true] .tile-art { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text); }
.tile-art > span { position: absolute; border-radius: 999px; }
.tile-art .ta-side { inset: 0 auto 0 0; width: 28%; border-radius: 0; background: var(--panel); box-shadow: 1px 0 0 var(--border); display: flex; flex-direction: column; gap: 9%; padding: 30% 14% 0; }
.tile-art .ta-row { display: block; height: 4px; border-radius: 99px; background: var(--muted); opacity: .8; }
.tile-art .ta-row.dim { background: var(--faint); width: 70%; }
.tile-art .ta-bubble { top: 15%; right: 10%; width: 38%; height: 12%; background: var(--user); }
.tile-art .ta-line { top: 38%; left: 38%; width: 46%; height: 6%; background: var(--text); }
.tile-art .ta-line.dim { top: 50%; width: 30%; background: var(--muted); }
.tile-art .ta-composer { left: 36%; right: 9%; bottom: 10%; height: 19%; background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); }
.tile-art .ta-send { position: absolute; top: 18%; right: 6%; bottom: 18%; aspect-ratio: 1; border-radius: 50%; background: var(--accent); }

.theme-pane-slot { min-width: 0; min-height: 0; overflow-y: auto; }
.theme-pane { display: flex; flex-direction: column; gap: 18px; padding: 14px 24px 24px; }
.theme-pane > * { flex-shrink: 0; }
.pane-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; }
.pane-title { display: flex; flex-direction: column; min-width: 0; }
.pane-title h3 { margin: 0; font-family: var(--font-head); font-size: 17px; font-weight: 650; letter-spacing: -0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane-sub { font-size: 12px; color: var(--faint); }
input.pane-name { flex: 1; min-width: 0; margin-left: -10px; padding: 6px 10px; border-color: transparent; border-radius: 10px; background: transparent; font-family: var(--font-head); font-size: 17px; font-weight: 650; letter-spacing: -0.02em; }
input.pane-name:hover { background: var(--tint); }
input.pane-name:focus { background: var(--raised); border-color: var(--strong); }
.segmented { display: inline-flex; flex: none; padding: 3px; border-radius: 999px; background: var(--raised); box-shadow: inset 0 0 0 1px var(--border); }
.segmented button { padding: 5px 13px; border: 0; background: transparent; color: var(--muted); font-size: 12.5px; font-weight: 550; }
.segmented button:hover { background: var(--tint); color: var(--text); }
.segmented button[aria-checked=true] { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px var(--shadow), 0 0 0 1px var(--border); }
.pane-stick { position: relative; top: -14px; z-index: 1; display: flex; flex-direction: column; gap: 10px; margin: -14px -24px 0; padding: 14px 24px 12px; background: linear-gradient(var(--surface) 88%, transparent); }
.pane-hint { margin: -8px 0 0; }
@media (min-height: 820px) { .pane-stick { position: sticky; } }

.theme-preview {
  display: grid;
  grid-template-columns: 30% minmax(0, 1fr);
  height: 232px;
  overflow: hidden;
  border-radius: var(--r-lg);
  background: var(--bg);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--border), 0 18px 40px -26px var(--shadow);
  font: 12.5px/1.45 var(--font);
  color-scheme: inherit;
  user-select: none;
}
.theme-preview [data-key] { transition: outline-color .12s ease; outline: 1.5px solid transparent; outline-offset: 1px; }
.theme-preview.editable [data-key] { cursor: pointer; }
.theme-preview [data-key]:hover:not(:has([data-key]:hover)) { outline-color: color-mix(in srgb, var(--text) 45%, transparent); }
.theme-preview [data-key].picked { outline: 1.5px dashed var(--text); }
.tp-side { display: flex; flex-direction: column; gap: 3px; padding: 14px 10px; background: var(--panel); box-shadow: 1px 0 0 var(--border); color: var(--muted); }
.tp-brand { align-self: flex-start; margin: 0 6px 10px; font-family: var(--font-head); font-weight: 650; color: var(--text); }
.tp-row { padding: 5px 8px; border-radius: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-row.on { background: var(--raised); color: var(--text); }
.tp-row:last-child { color: var(--faint); }
.tp-main { display: flex; flex-direction: column; min-width: 0; padding: 14px 16px 12px; background: var(--bg); }
.tp-user { align-self: flex-end; max-width: 80%; padding: 6px 12px; border-radius: 14px; background: var(--user); }
.tp-reply { margin: 10px 0 0; align-self: flex-start; }
.tp-sub { margin: 0; align-self: flex-start; color: var(--muted); }
.tp-code { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 2px 10px; white-space: nowrap; margin-top: 8px; padding: 7px 10px; border-radius: 10px; background: var(--code); box-shadow: inset 0 0 0 1px var(--border); font: 11.5px/1.4 var(--mono); }
.tp-status { display: flex; gap: 8px; }
.tp-status [data-key=ok] { color: var(--ok); }
.tp-status [data-key=warn] { color: var(--warn); }
.tp-status [data-key=danger] { color: var(--danger); }
.tp-composer { display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding: 5px 5px 5px 14px; border-radius: 999px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--strong); }
.tp-ph { color: var(--faint); }
.tp-send { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); }
.tp-arrow { display: inline-flex; color: var(--on-accent); }
.tp-arrow .icon { width: 14px; height: 14px; }

.color-inspector { display: grid; grid-template-columns: auto minmax(0, 1fr) 128px; align-items: center; gap: 12px; padding: 8px 8px 8px 8px; border-radius: var(--r-md); background: var(--raised); box-shadow: inset 0 0 0 1px var(--border); }
.ci-swatch { position: relative; display: block; width: 36px; height: 36px; cursor: pointer; }
.ci-chip { display: block; width: 100%; height: 100%; border-radius: 10px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent); }
.ci-picker { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; opacity: 0; cursor: pointer; }
.ci-picker:disabled { cursor: default; }
.ci-text { display: flex; flex-direction: column; min-width: 0; }
.ci-name { font-size: 13px; font-weight: 600; }
.ci-desc { font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.input.ci-hex { padding: 7px 10px; background: var(--surface); }

.swatch-group { display: flex; flex-direction: column; }
.swatch-row { display: grid; grid-template-columns: repeat(auto-fill, 66px); gap: 12px 10px; }
.swatch-row.big { grid-template-columns: repeat(3, 84px) auto; }
.swatch-tile { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 0; border: 0; border-radius: 0; background: none; color: var(--muted); font-size: 11.5px; text-align: center; }
.swatch-tile:hover { background: none; color: var(--text); }
.swatch-tile:focus-visible { outline: none; }
.swatch-chip { display: block; aspect-ratio: 1; border-radius: 12px; background: var(--c); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 16%, transparent); transition: box-shadow .15s ease, transform .15s var(--ease-focus); }
.swatch-tile:hover .swatch-chip { transform: translateY(-1px); }
.swatch-tile:focus-visible .swatch-chip { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
.swatch-tile[aria-pressed=true] { color: var(--text); font-weight: 600; }
.swatch-tile[aria-pressed=true] .swatch-chip { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 16%, transparent), 0 0 0 2px var(--surface), 0 0 0 4px var(--text); }
.swatch-tile.big .swatch-chip { border-radius: var(--r-md); }
.swatch-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.derive { display: flex; align-items: center; justify-content: flex-start; padding-left: 6px; }
.derive .chip { height: auto; min-height: 34px; padding: 8px 12px; border-radius: var(--r-md); box-shadow: inset 0 0 0 1px var(--border); white-space: normal; text-align: left; line-height: 1.3; }
.font-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.font-fields .field-select { position: relative; }
.font-fields .field-select .chevron { position: absolute; right: 12px; top: 50%; translate: 0 -50%; }
.swatch-group > .field-desc { margin: 8px 0 0; }
.theme-pane .form-actions { margin-top: 0; padding-top: 14px; border-top: 1px solid var(--border); }
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
.blocks { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
.blocks[hidden] { display: none; }
.tone-normal { --tone: var(--accent); }
.tone-good { --tone: var(--st-done); }
.tone-warning { --tone: var(--st-need); }
.tone-critical { --tone: var(--danger); }
.blk-text { margin: 0; font-size: 13px; color: var(--muted); }
.blk-text.tone-good, .blk-text.tone-warning, .blk-text.tone-critical { color: var(--tone); }
.blk-badge { align-self: flex-start; display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; color: var(--tone); background: color-mix(in srgb, var(--tone) 14%, transparent); }
.blk-stat { display: flex; flex-direction: column; gap: 2px; }
.stat-label, .stat-caption { font-size: 12px; color: var(--faint); }
.stat-value { font-size: 22px; font-weight: 650; }
.blk-meter { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; background: var(--raised); border: 1px solid var(--border); border-radius: var(--r-lg); }
.meter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 13px; }
.meter-label { font-weight: 600; }
.meter-status { font-size: 12px; color: var(--faint); }
.meter-display { font-size: 24px; font-weight: 700; letter-spacing: -.01em; }
.meter-caption { font-size: 12px; color: var(--faint); }
.meter-bar { position: relative; height: 14px; margin-top: 6px; border-radius: 7px; overflow: hidden; background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--tone) 22%, transparent) 0 1px, transparent 1px 5px); }
.meter-fill { height: 100%; border-radius: 7px; background: color-mix(in srgb, var(--tone) 45%, var(--raised)); transition: width .4s var(--ease-focus); }
.meter-marker { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text); }
.blk-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.blk-table th { text-align: left; font-weight: 600; font-size: 12px; color: var(--faint); }
.blk-table th, .blk-table td { padding: 7px 10px 7px 0; border-bottom: 1px solid var(--border); }
.blk-action { display: inline-flex; align-items: center; gap: 10px; }
.blk-button { padding: 7px 14px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--raised); color: var(--text); font-size: 13px; }
.blk-button:hover:not(:disabled) { border-color: var(--strong); }
.blk-button.tone-critical { color: var(--danger); }
.blk-error { font-size: 12.5px; color: var(--danger); }
.blk-group { display: flex; flex-direction: column; gap: 12px; }
.blk-group.row { flex-direction: row; flex-wrap: wrap; align-items: flex-start; gap: 16px; }
.blk-group > h4 { margin: 0; width: 100%; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.blk-group.row > .blk-meter, .blk-group.row > .blk-stat { flex: 1 1 200px; }
.blk-unknown { margin: 0; padding: 10px 12px; overflow-x: auto; font-family: var(--mono); font-size: 12px; background: var(--raised); border: 1px solid var(--border); border-radius: var(--r-md); }

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
  --fx-from: translateY(18px);
  --fx-blur: 12px;
  animation: focus-in var(--dur-focus) var(--ease-focus);
}
.auth h1 { font-family: var(--font-head); font-size: 20px; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 6px; }
.auth .sub { color: var(--muted); font-size: 13px; margin-bottom: 22px; }
.auth label { display: block; font-size: 12.5px; color: var(--muted); margin: 14px 0 6px; }
.auth input { width: 100%; }
.auth button { width: 100%; margin-top: 22px; padding: 11px; background: var(--accent); border: none; color: var(--on-accent); font-weight: 600; }
.auth button:hover { background: color-mix(in srgb, var(--accent) 85%, var(--bg)); }
.auth .error { color: var(--danger); font-size: 13px; margin-top: 12px; min-height: 18px; }

.landing {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 400;
  letter-spacing: -0.02em;
  color: var(--muted);
  text-align: center;
  --fx-blur: var(--blur-md);
  animation: focus-in .6s var(--ease-focus);
}
.loading { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; animation: fade-in .3s .2s backwards; }
.loading span { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); animation: loading-dot 1.1s ease-in-out infinite; }
.loading span:nth-child(2) { animation-delay: .15s; }
.loading span:nth-child(3) { animation-delay: .3s; }
@keyframes loading-dot { 0%, 70%, 100% { opacity: .3; transform: scale(.75); } 35% { opacity: 1; transform: scale(1); } }
.loading.older { flex: none; min-height: 28px; animation-delay: 0s; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--faint); }
.hint { font-size: 12px; color: var(--faint); padding: 4px 10px; }
.hint.conn, .hint.send-error { --fx-from: translateY(4px); --fx-blur: 3px; }
.hint.conn { padding: 0 8px 8px; text-align: center; animation: focus-in .3s var(--ease-focus) .2s backwards; }
.hint.send-error { padding: 0 8px 8px; color: var(--danger); animation: focus-in .3s var(--ease-focus); }
/* Theme swap: the old theme defocuses as the new one resolves. */
::view-transition-old(root) { animation: vt-out var(--dur-focus) var(--ease-focus) both; }
::view-transition-new(root) { animation: vt-in var(--dur-focus) var(--ease-focus) both; }
@keyframes vt-out { to { opacity: 0; filter: blur(6px); } }
@keyframes vt-in { from { opacity: 0; filter: blur(6px); } }

@media (max-width: 900px), (max-height: 500px) and (pointer: coarse) {
  .main, .app.collapsed .main { margin-left: 0; }
  .sidebar, .app.collapsed .sidebar {
    top: max(10px, env(safe-area-inset-top));
    bottom: max(10px, env(safe-area-inset-bottom));
    left: max(10px, env(safe-area-inset-left));
    width: min(85vw, 300px);
    transform: translateX(calc(-100% - 24px));
    filter: blur(var(--blur-lg));
    opacity: 0;
    pointer-events: none;
    transition: transform .6s var(--ease-focus), filter .6s var(--ease-focus), opacity .8s ease-in-out;
    transition-delay: 0s;
  }
  .app.nav-open .sidebar, .app.nav-open.collapsed .sidebar {
    transform: none;
    filter: blur(0);
    opacity: 1;
    pointer-events: auto;
    transition-timing-function: var(--ease-focus);
  }
  .sidebar-edge, .app.collapsed .sidebar-edge, .sidebar-resizer, .collapse-btn { display: none; }
  .nav-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .45);
    z-index: 19;
    display: none;
  }
  .app.nav-open .nav-backdrop { display: block; animation: fade-in var(--dur-focus) var(--ease-focus); }
  .app .nav-toggle, .app.collapsed .nav-toggle { width: 40px; margin: 0 0 0 -8px; opacity: 1; transform: none; visibility: visible; transition: none; }
  .chat-header { gap: 8px; justify-content: space-between; padding: max(8px, env(safe-area-inset-top)) max(16px, calc((100% - 812px) / 2)) 24px; }
  .chat-header .session-title { display: block; white-space: nowrap; text-overflow: ellipsis; }
  .messages { padding: calc(2 * 1.35em + 40px + env(safe-area-inset-top)) max(16px, calc((100% - 812px) / 2)) 16px; }
  .msg.user { max-width: 90%; }
  .lb-stage { padding: 8px 12px; }
  .lightbox .lb-nav, .lb-src { display: none; }
  .deck:hover, .deck:focus-within { --step: min(calc(var(--card) + 6px), calc((88cqw - var(--card)) / max(1, var(--n) - 1))); }
  .composer-wrap { padding: 2px max(16px, calc((100% - 812px) / 2)) max(14px, env(safe-area-inset-bottom)); }
  .composer textarea { padding: 13px 16px 2px; }
  .model-pop { max-width: 46vw; }
  .context-bar { width: 38px; height: 38px; }
  .icon-btn, .composer .send, .composer .stop { width: 40px; height: 40px; }
  .chip { height: 38px; }
  .session-row { min-height: 44px; }
  .modal-backdrop { align-items: flex-end; padding: 0; }
  .modal { width: 100%; max-height: 90dvh; border-radius: var(--r-xl) var(--r-xl) 0 0; padding-bottom: env(safe-area-inset-bottom); --fx-from: translateY(56px); }
  .modal-body { padding: 0 0 20px; }
  .settings-tabbed { flex-direction: column; }
  .settings-tabs { flex-direction: row; width: auto; padding: 0 18px; border-right: none; border-bottom: 1px solid var(--border); overflow-x: auto; overflow-y: hidden; }
  .settings-tab { padding: 8px 12px; }
  .settings-panels { padding: 16px 18px 0; }
  .modal.settings-modal { height: 90dvh; }
  .modal.settings-modal .modal-body { display: block; }
  .settings-tabbed { display: block; }
  .settings-panels { overflow-y: visible; }
  .modal-head { padding-left: 18px; }
  .modal.settings-modal:has(.theme-studio:not([hidden])) { width: 100%; height: 90dvh; }
  .settings-panels:has(> .theme-studio:not([hidden])) { display: block; padding: 16px 0 0; overflow: visible; }
  .theme-studio { display: block; }
  .theme-library { overflow: visible; padding: 0 18px; border-right: none; }
  .library-head { margin-bottom: 6px; }
  .theme-lists { gap: 12px; }
  .theme-grid { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 76px; gap: 10px; margin: 0 -18px; padding: 4px 18px 6px; overflow-x: auto; scroll-snap-type: x proximity; scroll-padding-inline: 18px; scrollbar-width: none; }
  .theme-grid::-webkit-scrollbar { display: none; }
  .theme-tile { scroll-snap-align: start; }
  .theme-pane-slot { overflow: visible; margin-top: 16px; border-top: 1px solid var(--border); }
  .theme-pane { padding: 14px 18px 8px; }
  .pane-stick { top: 0; margin: 0 -18px; padding: 6px 18px 10px; }
  .theme-preview { height: 196px; font-size: 12px; }
  .color-inspector { grid-template-columns: auto minmax(0, 1fr) 112px; }
  .pane-stick { position: sticky; }
  .swatch-row { grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); }
  .swatch-row.big { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .derive { grid-column: 1 / -1; padding-left: 0; }
  .font-fields { grid-template-columns: 1fr; }
  .part-row summary { min-height: 32px; }
  .sub-row { min-height: 40px; }
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

export const bootScript = themeBootScript;

export function indexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>valet</title>
<style>${CSS}</style>
<script>${bootScript}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}
