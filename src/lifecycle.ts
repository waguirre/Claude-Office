import type { AgentState } from './types'

// ---------------------------------------------------------------------------
// Ciclo de vida despues de terminar una tarea
// ---------------------------------------------------------------------------
// Se mantiene aparte del tick de React a proposito: es la unica parte del flujo
// con reglas de negocio de verdad, y asi se puede probar sin montar la oficina.
// Ver src/lifecycle.test.mjs.

/** Que le toca al agente ahora mismo. 'stay' = nada que hacer todavia. */
export type LifecyclePhase = 'stay' | 'leave' | 'despawn'

export function nextLifecyclePhase(input: {
  state: AgentState
  /** Cuando llego a la cafetera tras terminar (null si aun va caminando). */
  wrappingSince: number | null
  /** Cuando llego a la puerta y arranco el fundido (null si aun no llega). */
  leftAt: number | null
  now: number
  cafeteriaMs: number
  fadeMs: number
}): LifecyclePhase {
  const { state, wrappingSince, leftAt, now, cafeteriaMs, fadeMs } = input

  // Espero en la cafetera y nadie me mando trabajo nuevo: me voy.
  if (state === 'wrapping-up' && wrappingSince !== null && now - wrappingSince >= cafeteriaMs) {
    return 'leave'
  }
  // Termine el fundido en la puerta: se me puede borrar.
  if (state === 'leaving' && leftAt !== null && now - leftAt >= fadeMs) {
    return 'despawn'
  }
  return 'stay'
}
