const CSS = `
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font: 14.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: #0f1216;
  color: #d6dae1;
}
button, input, select, textarea { font: inherit; color: inherit; }
button {
  background: #1d232c;
  border: 1px solid #2b333f;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
}
button:hover { background: #242c37; }
button:disabled { opacity: 0.5; cursor: default; }
select, input[type=text], input[type=password] {
  background: #161b22;
  border: 1px solid #2b333f;
  border-radius: 6px;
  padding: 6px 8px;
}

.app { display: grid; grid-template-columns: 264px 1fr; height: 100vh; height: 100dvh; }
.chat-root { display: contents; }
.nav-toggle { display: none; }
.nav-backdrop { display: none; }
.toast {
  position: fixed;
  bottom: 18px;
  right: 18px;
  background: #3a2226;
  border: 1px solid #563038;
  color: #e8c9c9;
  padding: 9px 14px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 10;
}

.sidebar {
  border-right: 1px solid #21262e;
  background: #0c0f13;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.sidebar .project-picker { padding: 12px; border-bottom: 1px solid #21262e; }
.sidebar .project-picker select { width: 100%; }
.sidebar .sessions { flex: 1; overflow-y: auto; padding: 8px; }
.session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 7px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: #c3c9d1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-row:hover { background: #181d25; }
.session-row.open { background: #1d242e; color: #eef1f5; }
.session-row .dot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: #3a4150; }
.session-row .title { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.session-row .suffix { flex: none; color: #6f7885; }
.session-row .unread { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent, #7aa2f7); }
.sidebar .new-session { margin: 8px; }
.sidebar .logout { margin: 0 8px 8px; font-size: 12.5px; color: #8a94a1; background: transparent; }
.sidebar .logout:hover { background: #181d25; }

.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.chat-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #21262e;
  background: #0c0f13;
}
.chat-header .session-title { font-weight: 600; font-size: 15px; flex: 1; min-width: 8em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-header .suffix { flex: none; color: #8a94a1; }
.chat-header .model-picker { max-width: 260px; }
.context-bar { width: 140px; }
.context-bar .track { height: 5px; border-radius: 3px; background: #222933; overflow: hidden; }
.context-bar .fill { height: 100%; background: var(--accent, #7aa2f7); transition: width 0.3s; }
.context-bar .label { font-size: 11px; color: #8a94a1; margin-top: 3px; text-align: right; }

.messages { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.msg { max-width: 78%; }
.msg, .msg .bubble { min-width: 0; }
.msg.user { align-self: flex-end; }
.msg.assistant, .msg.system, .msg.tool { align-self: flex-start; }
.msg .bubble {
  border-radius: 10px;
  padding: 9px 13px;
  white-space: normal;
  overflow-wrap: break-word;
}
.msg.user .bubble { background: #26354d; }
.msg.assistant .bubble { background: #1a2028; border: 1px solid #232b36; }
.msg.system .bubble, .msg.tool .bubble { background: transparent; border: 1px dashed #2b333f; color: #98a1ad; font-size: 13px; }
.msg .bubble pre {
  background: #0a0d11;
  border: 1px solid #232b36;
  border-radius: 6px;
  padding: 9px 11px;
  overflow-x: auto;
  white-space: pre;
  font-size: 13px;
}
.msg .bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
.msg .bubble p > code, .msg .bubble code.inline { background: #222933; border-radius: 4px; padding: 1px 5px; }
.msg .bubble p { margin: 0 0 8px; white-space: pre-wrap; }
.msg .bubble p:last-child { margin-bottom: 0; }
.msg .bubble ul, .msg .bubble ol { margin: 0 0 8px; padding-left: 20px; }
.msg .bubble li { white-space: pre-wrap; }
.msg .bubble .md-quote {
  border-left: 2px solid #3a4150;
  padding-left: 10px;
  color: #a9b2bf;
  white-space: pre-wrap;
  margin: 0 0 8px;
}
.md-h { font-weight: 600; margin: 4px 0 6px; }
.md-h1, .md-h2 { font-size: 1.12em; }
.msg .bubble a { color: var(--accent, #7aa2f7); }
.msg .bubble hr { border: none; border-top: 1px solid #2b333f; margin: 8px 0; }
.msg .meta { font-size: 11px; color: #6f7885; margin: 3px 4px 0; }
.msg.user .meta { text-align: right; }

.part-row {
  margin: 0 0 6px;
  border: 1px solid #232b36;
  border-radius: 8px;
  background: #141922;
  font-size: 13px;
}
.part-row summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  color: #a9b2bf;
  list-style: none;
}
.part-row summary::before { content: "\\25B8"; font-size: 10px; color: #59636f; }
.part-row[open] summary::before { content: "\\25BE"; }
.part-row .status { margin-left: auto; font-size: 11px; color: #6f7885; }
.part-row .status.running { color: var(--accent, #7aa2f7); }
.part-row .status.error, .part-row .status.denied { color: #d97a7a; }
.part-row .body { border-top: 1px solid #232b36; padding: 8px 11px; max-height: 320px; overflow-y: auto; }
.part-row .body pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; color: #b6bfca; }
.part-row .trunc { color: #6f7885; }
.part-row .show-all { font-size: 11px; padding: 1px 8px; margin-left: 8px; }
.part-notice { font-size: 12.5px; color: #98a1ad; padding: 2px 4px; }
.part-notice.warn { color: #cfa75f; }
.part-notice.error { color: #d97a7a; }
.part-summary { font-size: 13px; color: #a9b2bf; border-left: 2px solid #3a4150; padding: 4px 10px; margin-bottom: 6px; }

.composer { border-top: 1px solid #21262e; padding: 12px 16px; display: flex; gap: 10px; align-items: flex-end; background: #0c0f13; }
.composer textarea {
  flex: 1;
  resize: none;
  min-height: 42px;
  max-height: 180px;
  background: #161b22;
  border: 1px solid #2b333f;
  border-radius: 8px;
  padding: 9px 11px;
}
.composer textarea:focus, select:focus, input:focus { outline: 1px solid var(--accent, #7aa2f7); }
.composer .send { background: var(--accent, #7aa2f7); border-color: transparent; color: #0c0f13; font-weight: 600; }
.composer .stop { background: #3a2226; border-color: #563038; color: #e0a3a3; }

.auth {
  height: 100vh;
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.auth .card {
  width: 320px;
  background: #141922;
  border: 1px solid #232b36;
  border-radius: 12px;
  padding: 26px;
}
.auth h1 { font-size: 17px; margin: 0 0 6px; }
.auth .sub { color: #8a94a1; font-size: 13px; margin-bottom: 18px; }
.auth label { display: block; font-size: 12.5px; color: #a9b2bf; margin: 12px 0 4px; }
.auth input { width: 100%; }
.auth button { width: 100%; margin-top: 18px; padding: 8px; background: var(--accent, #7aa2f7); border: none; color: #0c0f13; font-weight: 600; }
.auth .error { color: #d97a7a; font-size: 13px; margin-top: 12px; min-height: 18px; }

.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #59636f; }
.hint { font-size: 12px; color: #59636f; padding: 4px 10px; }
.hint.conn { padding: 6px 16px 0; }

@media (max-width: 900px), (max-height: 500px) and (pointer: coarse) {
  .app { grid-template-columns: 1fr; }
  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(85vw, 300px);
    z-index: 20;
    transform: translateX(-100%);
    transition: transform .2s;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .app.nav-open .sidebar { transform: none; }
  .nav-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.5);
    z-index: 19;
    display: none;
  }
  .app.nav-open .nav-backdrop { display: block; }
  .nav-toggle { display: inline-flex; }
  .chat-header { flex-wrap: wrap; padding-top: max(10px, env(safe-area-inset-top)); }
  .chat-header .session-title { flex: 1 1 0; min-width: 0; }
  .chat-header .model-picker, .chat-header .effort-picker { max-width: 100%; min-width: 0; flex: 1 1 auto; }
  .context-bar { width: 80px; }
  .msg { max-width: 92%; }
  .messages { padding: 12px; }
  .composer { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  button, select, .session-row, .part-row summary { min-height: 44px; }
  input, select, textarea { font-size: 16px; }
}
`;

export function configScript(coreUrl: string): string {
  return `window.VALET = ${JSON.stringify({ coreUrl })};`;
}

export function indexHtml(coreUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>valet</title>
<style>${CSS}</style>
</head>
<body>
<div id="root"></div>
<script>${configScript(coreUrl)}</script>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}
