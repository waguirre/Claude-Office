// Comprueba el ciclo de vida post-tarea sin montar la oficina.
//   node src/lifecycle.test.mjs
import assert from 'node:assert/strict'
import { nextLifecyclePhase } from './lifecycle.ts'

const CAFETERIA_MS = 45_000
const FADE_MS = 600
const base = { wrappingSince: null, leftAt: null, now: 0, cafeteriaMs: CAFETERIA_MS, fadeMs: FADE_MS }

// Trabajando en su puesto: el ciclo de salida no lo toca.
assert.equal(nextLifecyclePhase({ ...base, state: 'working', now: 999_999 }), 'stay')

// Todavia caminando a la cafetera (aun no llego, wrappingSince nulo).
assert.equal(nextLifecyclePhase({ ...base, state: 'wrapping-up', now: 999_999 }), 'stay')

// En la cafetera, dentro de la ventana de espera: se queda.
assert.equal(
  nextLifecyclePhase({ ...base, state: 'wrapping-up', wrappingSince: 1_000, now: 1_000 + CAFETERIA_MS - 1 }),
  'stay',
)

// Se cumplio la espera sin trabajo nuevo: se va.
assert.equal(
  nextLifecyclePhase({ ...base, state: 'wrapping-up', wrappingSince: 1_000, now: 1_000 + CAFETERIA_MS }),
  'leave',
)

// Camino a la puerta pero aun sin llegar: no se borra.
assert.equal(nextLifecyclePhase({ ...base, state: 'leaving', now: 999_999 }), 'stay')

// En la puerta, con el fundido a medias: sigue visible.
assert.equal(
  nextLifecyclePhase({ ...base, state: 'leaving', leftAt: 2_000, now: 2_000 + FADE_MS - 1 }),
  'stay',
)

// Fundido terminado: se puede borrar.
assert.equal(
  nextLifecyclePhase({ ...base, state: 'leaving', leftAt: 2_000, now: 2_000 + FADE_MS }),
  'despawn',
)

// cafeteriaMs = 0 (config al minimo): se va en cuanto llega, sin quedarse pegado.
assert.equal(
  nextLifecyclePhase({ ...base, state: 'wrapping-up', wrappingSince: 500, now: 500, cafeteriaMs: 0 }),
  'leave',
)

console.log('lifecycle: 8/8 ok')
