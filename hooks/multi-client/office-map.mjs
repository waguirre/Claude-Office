// Claude-Office :: mapeo y transporte compartido.
// Lo usan tanto office-emit.mjs (hooks por stdin: Claude Code, Codex, Kimi,
// Antigravity) como el plugin de OpenCode (in-process, sin spawn).
import { readFileSync, statSync } from 'node:fs';
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

// Etiqueta corta: proyecto/rama si hay repo, si no el cliente a secas.
export const scopeLabel = (n) => {
  const g = n.git || {};
  if (g.project && g.branch) return g.project + '/' + g.branch;
  if (g.project) return g.project;
  return n.client || 'agent';
};

// Un agente por (cliente, sesion). Sin esto, el server recibe agent_working sin
// agentId y TODAS las ventanas colapsan en un unico estado global: solo se ve la
// ultima que emitio. Con agentId, cada ventana tiene su propio avatar.
export const sessionAgentId = (n) =>
  'session-' + (n.client || 'x') + '-' + (String(n.session || 'anon').slice(0, 8) || 'anon');

export const sessionAgent = (n) => ({
  id: sessionAgentId(n),
  name: scopeLabel(n) + ' · ' + (n.client || 'agent'),
  role: 'general-purpose',
  client: n.client,
  session: n.session,
  task: (n.git && n.git.branch ? 'rama ' + n.git.branch : 'sesion activa'),
});

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
