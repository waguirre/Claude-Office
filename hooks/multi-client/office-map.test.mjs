// Etiquetas de agente: proyecto/rama, cliente y modelo.
//   node hooks/multi-client/office-map.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clientLabel, shortModel, modelFromTranscript, scopeLabel, sessionAgent, normalize, toOfficeEvent } from './office-map.mjs'

// --- nombre del modelo -------------------------------------------------------
assert.equal(shortModel('claude-opus-5'), 'opus-5')
assert.equal(shortModel('claude-sonnet-5[1m]'), 'sonnet-5')
assert.equal(shortModel('claude-haiku-4-5-20251001'), 'haiku-4-5')
assert.equal(shortModel('kimi-k2'), 'kimi-k2')     // otros proveedores se dejan tal cual
assert.equal(shortModel(''), '')
assert.equal(shortModel(undefined), '')

// --- superficie de Claude Code ----------------------------------------------
assert.equal(clientLabel('claude', 'claude-vscode'), 'claude vscode')
assert.equal(clientLabel('claude', 'remote_desktop'), 'claude remote')
assert.equal(clientLabel('claude', ''), 'claude cli')
assert.equal(clientLabel('claude', undefined), 'claude cli')
assert.equal(clientLabel('kimi', 'claude-vscode'), 'kimi')   // solo aplica a claude
assert.equal(clientLabel('', ''), 'agent')

// --- fallback de scope: carpeta, nunca el nombre del cliente -----------------
// Un directorio sin repo daba "claude - claude"; ahora da el nombre de la carpeta.
assert.equal(scopeLabel({ client: 'claude', cwd: 'C:/tmp/algun-proyecto', git: {} }), 'algun-proyecto')
assert.equal(scopeLabel({ client: 'claude', git: { project: 'erp', branch: 'develop' } }), 'erp/develop')
assert.equal(scopeLabel({ client: 'claude', git: { project: 'erp' } }), 'erp')
assert.equal(scopeLabel({ client: 'opencode', git: {} }), 'opencode')   // sin cwd ni repo

// --- modelo desde la cola del transcript -------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'office-'))
const tr = join(dir, 't.jsonl')
writeFileSync(tr, [
  JSON.stringify({ type: 'user', message: { role: 'user' } }),
  JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', role: 'assistant' } }),
  JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', role: 'assistant' } }),
  '',
].join('\n'))
assert.equal(modelFromTranscript(tr), 'claude-opus-5')   // gana el ultimo
assert.equal(modelFromTranscript(join(dir, 'no-existe.jsonl')), '')
assert.equal(modelFromTranscript(''), '')

// Una primera linea cortada por leer solo la cola no debe romper la lectura.
assert.equal(modelFromTranscript(tr, 80), 'claude-opus-5')

// --- etiqueta completa -------------------------------------------------------
const n = normalize(
  { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, session_id: 'abc12345', transcript_path: tr },
  'pre', 'claude',
)
// normalize expone git como getter memorizado: se copia en vez de asignar.
const a = sessionAgent({ ...n, git: { project: 'hub-next', branch: 'master', worktree: '' } })
assert.equal(a.name, 'hub-next/master · claude cli')
assert.equal(a.task, 'opus-5 · rama master')

// Sin modelo ni rama, la tarea no queda vacia.
const n2 = normalize({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, session_id: 'x' }, 'pre', 'kimi')
assert.equal(sessionAgent(n2).task, 'sesion activa')

// --- lo que se reporta como actividad real ------------------------------------
const ev = (tool, input = {}) =>
  toOfficeEvent(normalize({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, session_id: 's' }, 'pre', 'claude'))

// Sin prefijo de scope: el nombre del agente ya lleva proyecto/rama y cliente.
assert.equal(ev('Bash', { command: 'npm test' }).status, 'running npm test')
assert.equal(ev('Read', { file_path: 'src/App.tsx' }).status, 'reading src/App.tsx')

// Antes cualquier tool fuera de las 7 mapeadas no emitia nada.
assert.equal(ev('TodoWrite').status, 'updating the task list')
assert.equal(ev('WebSearch', { query: 'vite base path' }).status, 'searching the web for vite base path')
assert.equal(ev('WebFetch', { url: 'https://docs.anthropic.com/algo/muy/largo' }).status, 'fetching docs.anthropic.com')
assert.equal(ev('AskUserQuestion').status, 'asking a question')

// Caso por defecto: una tool desconocida ya no es muda.
assert.equal(ev('AlgunaToolNueva').status, 'using AlgunaToolNueva')

// Tools de sondeo: siguen calladas para no llenar el chat.
assert.equal(ev('BashOutput'), null)
assert.equal(ev('KillShell'), null)

// El post-tool de una tool normal no genera mensaje (solo el pre).
assert.equal(
  toOfficeEvent(normalize({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {}, session_id: 's' }, 'post', 'claude')),
  null,
)

console.log('office-map: 32/32 ok')
