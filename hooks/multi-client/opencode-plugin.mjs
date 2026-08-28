// Claude-Office :: plugin de OpenCode.
// OpenCode no usa hooks de shell sino plugins JS in-process, asi que este
// adaptador no lanza ningun proceso: mapea al vuelo y postea con fetch.
//
// Instalar: dejar este archivo (o un symlink) en ~/.config/opencode/plugin/
import { normalize, toOfficeEvent, post, sessionAgent, sessionAgentId } from './office-map.mjs';

// OpenCode entrega { tool, sessionID, callID } y los args aparte; lo traducimos
// al esquema canonico que entiende office-map.
const asPayload = (tool, args, callID, response) => ({
  hook_event_name: response === undefined ? 'PreToolUse' : 'PostToolUse',
  tool_name: tool,
  tool_input: args || {},
  tool_use_id: callID || '',
  cwd: process.cwd(),
  tool_response: response ?? '',
});

// El server ignora agent_working de un agentId que no dio de alta, asi que la
// sesion se registra en su primer tool call. En memoria basta: el plugin vive
// dentro del proceso de OpenCode (a diferencia de los hooks, que son procesos
// nuevos y usan un marcador en disco).
const seen = new Set();
async function ensureAgent(n) {
  const id = sessionAgentId(n);
  if (seen.has(id)) return;
  seen.add(id);
  await post({ type: 'agent_spawned', agent: sessionAgent(n) });
}

export const ClaudeOfficePlugin = async () => ({
  'tool.execute.before': async (input, output) => {
    try {
      const n = normalize(asPayload(input.tool, output?.args, input.callID), 'pre', 'opencode');
      n.session = input.sessionID || n.session;
      await ensureAgent(n);
      await post(toOfficeEvent(n));
    } catch {}
  },
  'tool.execute.after': async (input, output) => {
    try {
      const n = normalize(
        asPayload(input.tool, input.args, input.callID, output?.output ?? 'done'), 'post', 'opencode');
      n.session = input.sessionID || n.session;
      await post(toOfficeEvent(n));
    } catch {}
  },
});
