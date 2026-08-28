#!/usr/bin/env node
// Claude-Office :: puente de hooks por stdin.
// Clientes: Claude Code, Codex, Kimi (esquema tool_name/tool_input) y
// Antigravity (esquema toolCall.name/args, la fase llega por --phase).
//
//   node office-emit.mjs --phase pre|post
//
// Nunca escribe en stdout (cero inyeccion de contexto => cero tokens de
// modelo) y siempre sale 0.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalize, toOfficeEvent, post, sessionAgent, sessionAgentId } from './office-map.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : ''; };
const phase = arg('--phase');
const client = arg('--client');
// No usar process.exit(): mata handles de fetch a medio cerrar y libuv aborta
// con "UV_HANDLE_CLOSING". Con exitCode el proceso termina solo al drenar el
// event loop, y el AbortSignal de 1s garantiza que no se quede colgado.
const bye = () => { process.exitCode = 0; };

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
try {
  const n = normalize(JSON.parse(raw), phase, client);

  // Primera vez que vemos esta sesion: darla de alta como agente propio, para que
  // cada ventana/cliente tenga su avatar. Sin agentId el server colapsa todos los
  // agent_working en un unico estado global y solo se ve la ultima ventana.
  // Marcador en disco porque cada hook es un proceso nuevo.
  const id = sessionAgentId(n);
  const dir = join(homedir(), '.agent-office', 'sessions');
  if (!existsSync(join(dir, id + '.seen'))) {
    try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, id + '.seen'), ''); } catch {}
    await post({ type: 'agent_spawned', agent: sessionAgent(n) });
  }

  await post(toOfficeEvent(n));
} catch {}
bye();
