// Claude-Office :: mapeo y transporte compartido.
// Lo usan tanto office-emit.mjs (hooks por stdin: Claude Code, Codex, Kimi,
// Antigravity) como el plugin de OpenCode (in-process, sin spawn).
import { readFileSync, statSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';

const SERVER_URL = process.env.AGENT_OFFICE_URL || 'http://127.0.0.1:3334/event';
const TIMEOUT_MS = 1000;

let cachedToken;
function authToken() {
  if (cachedToken !== undefined) return cachedToken;
  try { cachedToken = readFileSync(join(homedir(), '.agent-office', 'auth-token'), 'utf8').trim(); }
  catch { cachedToken = ''; }
  return cachedToken;
}

// Fail-open siempre: si el office no esta levantado, nadie se entera.
export async function post(ev) {
  if (!ev) return;
  const token = authToken();
  try {
    await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) },
      body: JSON.stringify(ev),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {}
}

const ROLE_ALIASES = {
  debugger: 'debugger', 'code-reviewer': 'code-reviewer', 'frontend-developer': 'frontend-developer',
  'fullstack-developer': 'fullstack-developer', 'test-engineer': 'test-engineer',
  'security-auditor': 'security-auditor', 'architect-reviewer': 'architect-reviewer',
  'performance-engineer': 'performance-engineer', 'devops-engineer': 'devops-engineer',
  'database-architect': 'database-architect', 'typescript-pro': 'typescript-pro',
  'ai-engineer': 'ai-engineer', 'prompt-engineer': 'prompt-engineer',
  'general-purpose': 'general-purpose', Explore: 'Explore',
};
const ROLE_NAMES = {
  debugger: 'Debugger', 'code-reviewer': 'Reviewer', 'frontend-developer': 'Frontend',
  'fullstack-developer': 'Fullstack', 'test-engineer': 'Tester', 'security-auditor': 'Security',
  'architect-reviewer': 'Architect', 'performance-engineer': 'PerfEng', 'devops-engineer': 'DevOps',
  'database-architect': 'DBA', 'typescript-pro': 'TS Pro', 'ai-engineer': 'AI Eng',
  'prompt-engineer': 'Prompts', 'general-purpose': 'Agent', Explore: 'Explorer',
};

// Nombres de tool equivalentes entre clientes -> tool canonico de Claude.
const TOOL_ALIASES = {
  run_command: 'Bash', run_terminal_command: 'Bash', bash: 'Bash', shell: 'Bash',
  read_file: 'Read', view_file: 'Read', read: 'Read',
  write_file: 'Write', create_file: 'Write', write: 'Write',
  edit_file: 'Edit', replace_file_content: 'Edit', str_replace: 'Edit', edit: 'Edit',
  grep_search: 'Grep', search_in_files: 'Grep', grep: 'Grep',
  find_by_name: 'Glob', glob: 'Glob', list_dir: 'Glob',
  task: 'Task', agent: 'Agent', invoke_skill: 'Skill', activate_skill: 'Skill', skill: 'Skill',
};

const short = (v, n = 60) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const STATUS = {
  Read: (i) => 'reading ' + short(i.file_path || i.path || i.target_file || '', 40),
  Write: (i) => 'writing ' + short(i.file_path || i.path || '', 40),
  Edit: (i) => 'editing ' + short(i.file_path || i.path || '', 40),
  Bash: (i) => 'running ' + short(i.command || i.CommandLine || i.cmd || '', 40),
  Grep: (i) => 'searching ' + short(i.pattern || i.query || '', 30),
  Glob: (i) => 'globbing ' + short(i.pattern || i.query || '', 30),
  Skill: (i) => 'loading skill ' + short(i.skill || i.name || '', 30),
};

export function normalize(d, phase, client = '') {
  // Antigravity: el evento no viaja en el payload, llega por --phase.
  if (d && typeof d.toolCall === 'object' && d.toolCall) {
    return {
      event: phase === 'post' ? 'PostToolUse' : 'PreToolUse',
      tool: d.toolCall.name || '',
      input: d.toolCall.args || {},
      callId: d.toolCall.id || (d.stepIdx != null ? 'step-' + d.stepIdx : ''),
      response: d.toolResult ?? d.result ?? '',
      cwd: (Array.isArray(d.workspacePaths) && d.workspacePaths[0]) || d.cwd || '',
      session: d.conversationId || '',
      client: client || 'antigravity',
      model: d.model || '',
      transcriptPath: '',
      get git() { return (this._g ??= gitInfo(this.cwd)); },
    };
  }
  // Claude Code / Codex / Kimi / Gemini comparten esquema de payload.
  // La fase la manda el wiring (--phase); hook_event_name solo se usa si falta,
  // porque cada cliente lo nombra distinto (Gemini: BeforeTool/AfterTool).
  return {
    event: phase ? (phase === 'post' ? 'PostToolUse' : 'PreToolUse')
                 : (d.hook_event_name === 'AfterTool' ? 'PostToolUse' : 'PreToolUse'),
    tool: d.tool_name || '',
    input: d.tool_input || {},
    callId: d.tool_use_id || d.tool_call_id || '',
    response: d.tool_response ?? d.tool_output ?? '',
    cwd: d.cwd || '',
    session: d.session_id || '',
    client: client || 'claude',
    // Claude Code NO manda el modelo en el payload, pero si el transcript, y ahi
    // esta. El resto de clientes puede mandarlo directo en 'model'.
    model: d.model || '',
    transcriptPath: d.transcript_path || '',
    get git() { return (this._g ??= gitInfo(this.cwd)); },
  };
}

// Proyecto + rama a partir del cwd que envia el hook. Se lee .git/HEAD a mano en
// vez de lanzar `git`: un spawn extra por tool call seria mas caro que todo lo
// demas junto. Soporta worktrees, donde .git es un ARCHIVO con "gitdir: <ruta>".
export function gitInfo(cwd) {
  if (!cwd) return {};
  let dir = resolve(cwd);
  for (let i = 0; i < 40; i++) {
    const dotgit = join(dir, '.git');
    try {
      const st = statSync(dotgit);
      let gitdir = dotgit;
      if (st.isFile()) {
        const m = /gitdir:\s*(.+)/.exec(readFileSync(dotgit, 'utf8'));
        if (!m) break;
        gitdir = resolve(dir, m[1].trim());
      }
      // Un .git sin HEAD legible NO es un repo valido (pasa con restos de
      // instalaciones): hay que seguir subiendo en vez de dar un falso positivo.
      let branch = '';
      try {
        const head = readFileSync(join(gitdir, 'HEAD'), 'utf8').trim();
        if (!head) throw new Error('empty');
        const r = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        branch = r ? r[1] : head.slice(0, 7);   // detached: SHA corto
      } catch {
        const up0 = dirname(dir);
        if (up0 === dir) break;
        dir = up0;
        continue;
      }
      // En un worktree, gitdir es <repoPrincipal>/.git/worktrees/<nombre>, asi que
      // el proyecto real se saca de ahi: da "erp/develop" en vez de "develop/develop".
      let project = basename(dir);
      let worktree = '';
      if (st.isFile()) {
        worktree = basename(dir);
        const parts = gitdir.split(String.fromCharCode(92)).join('/').split('/');
        const wi = parts.lastIndexOf('worktrees');
        if (wi >= 2 && parts[wi - 1] === '.git') project = parts[wi - 2];
      }
      return { project, branch, worktree };
    } catch {}
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return {};
}

// Etiqueta corta: proyecto/rama si hay repo; si no, la carpeta. Caer al nombre
// del cliente daba etiquetas duplicadas ("claude - claude") en cualquier
// directorio que no fuera un repo.
export const scopeLabel = (n) => {
  const g = n.git || {};
  if (g.project && g.branch) return g.project + '/' + g.branch;
  if (g.project) return g.project;
  if (n.cwd) return basename(resolve(n.cwd));
  return n.client || 'agent';
};

// Claude Code corre en varias superficies y todas mandan client=claude. La
// distincion viene por env: el hook es hijo del proceso y la hereda.
export function clientLabel(client, entrypoint) {
  if (client !== 'claude') return client || 'agent';
  const e = entrypoint || '';
  if (e === 'claude-vscode') return 'claude vscode';
  if (e.startsWith('remote')) return 'claude remote';
  return 'claude cli';
}

// 'claude-opus-5' -> 'opus-5' | 'claude-haiku-4-5-20251001' -> 'haiku-4-5'
export function shortModel(id) {
  if (!id) return '';
  return String(id)
    .replace(/\[.*?\]/g, '')          // sufijos tipo [1m]
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .trim();
}

// El modelo sale de la cola del transcript: leer el archivo entero seria caro y
// crece toda la sesion. 64 KB alcanzan de sobra para el ultimo mensaje.
export function modelFromTranscript(path, tailBytes = 64 * 1024) {
  if (!path) return '';
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, tailBytes);
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split(String.fromCharCode(10));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const d = JSON.parse(lines[i]);       // la primera linea suele venir cortada
        if (d && d.message && d.message.model) return d.message.model;
      } catch {}
    }
  } catch {}
  finally { if (fd !== undefined) { try { closeSync(fd); } catch {} } }
  return '';
}

/** Modelo del agente: el que mande el cliente, o el del transcript. */
export const modelOf = (n) => shortModel(n.model || modelFromTranscript(n.transcriptPath));

// Un agente por (cliente, sesion). Sin esto, el server recibe agent_working sin
// agentId y TODAS las ventanas colapsan en un unico estado global: solo se ve la
// ultima que emitio. Con agentId, cada ventana tiene su propio avatar.
export const sessionAgentId = (n) =>
  'session-' + (n.client || 'x') + '-' + (String(n.session || 'anon').slice(0, 8) || 'anon');

export const sessionAgent = (n) => {
  const model = modelOf(n);
  const branch = n.git && n.git.branch;
  const worktree = n.git && n.git.worktree;
  // El nombre tiene que caber en la columna del chat (~300 px): proyecto/rama y
  // cliente. El modelo va en task, que se ve al pasar el mouse y en el tablero.
  return {
    id: sessionAgentId(n),
    name: scopeLabel(n) + ' · ' + clientLabel(n.client, process.env.CLAUDE_CODE_ENTRYPOINT),
    role: 'general-purpose',
    client: n.client,
    session: n.session,
    task: [
      model,
      worktree ? 'worktree ' + worktree : (branch ? 'rama ' + branch : ''),
    ].filter(Boolean).join(' · ') || 'sesion activa',
  };
};

const tag = (n) => '[' + (n.client || '?') + '@' + scopeLabel(n) + '] ';

export function toOfficeEvent(n) {
  const raw = n.tool;
  if (!raw) return null;
  const tool = TOOL_ALIASES[raw] || TOOL_ALIASES[raw.toLowerCase()] || raw;
  const isPre = n.event === 'PreToolUse';

  if (raw.startsWith('mcp__')) {
    const [server, ...rest] = raw.slice(5).split('__');
    return isPre
      ? { type: 'mcp_call', server, tool: rest.join('__'), agentId: sessionAgentId(n) }
      : { type: 'mcp_done', server, agentId: sessionAgentId(n) };
  }

  if (tool === 'Agent' || tool === 'Task') {
    const i = n.input || {};
    const sub = i.subagent_type || i.agent_type || i.agentType || '';
    const role = ROLE_ALIASES[sub] || 'general-purpose';
    const id = 'agent-' + (n.client || 'x') + '-' + (n.callId || role);
    if (isPre) {
      return {
        type: 'agent_spawned',
        agent: { id, name: (ROLE_NAMES[role] || 'Agent') + ' · ' + (n.client || '?'), role,
                 client: n.client, session: n.session,
                 task: tag(n) + short(i.description || i.prompt || 'Working on task', 70) },
      };
    }
    return { type: 'agent_completed', agentId: id, result: short(n.response || 'done', 120) };
  }

  if (!isPre) return null;
  const fn = STATUS[tool];
  return fn
    ? { type: 'agent_working', agentId: sessionAgentId(n), status: tag(n) + fn(n.input || {}),
        client: n.client, session: n.session }
    : null;
}
