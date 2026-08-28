/**
 * KanbanBoard.tsx — el tablero de la pared, siempre al dia.
 *
 * Dos capas, porque el sprite del tablero mide ~36x36 px en pantalla y ahi no
 * entra texto legible:
 *   1. Post-its: un cuadrito por agente presente, con su color. Se ve de lejos
 *      si la oficina esta cargada o vacia, sin leer nada.
 *   2. Panel: al hacer click se abre la lista de verdad — agente, tarea, estado.
 *
 * Se dibuja encima del hotspot 'kanban-board' de rooms.ts y le roba el click.
 */
import React, { useEffect } from 'react'
import type { Agent, AgentState } from '../types'

/** Como se llama cada estado en el panel. */
const STATE_LABEL: Partial<Record<AgentState, string>> = {
  'working': 'en su puesto',
  'walking-to-desk': 'volviendo al puesto',
  'new-hire': 'llegando',
  'coffee-break': 'en pausa',
  'wrapping-up': 'en la cafetera',
  'leaving': 'saliendo',
  'talking-to-manager': 'reunido',
  'walking-to-manager': 'yendo a reunion',
  'idle': 'sin tarea',
}

/** Cuantos post-its caben antes de resumir el resto con un "+N". */
const MAX_NOTES = 9

interface Props {
  agents: Agent[]
  /** Posicion del hotspot en el fondo, en % de la sala. */
  x: number
  y: number
  open: boolean
  onToggle: () => void
  onClose: () => void
}

const KanbanBoard: React.FC<Props> = ({ agents, x, y, open, onToggle, onClose }) => {
  // Esc cierra el panel. Solo se engancha mientras esta abierto.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const notes = agents.slice(0, MAX_NOTES)
  const extra = agents.length - notes.length

  return (
    <>
      <div
        className="kanban-notes"
        style={{ left: `${x}%`, top: `${y}%` }}
        title={agents.length ? `${agents.length} en curso — click para ver` : 'tablero vacio'}
        onClick={onToggle}
      >
        {notes.map(a => (
          <span key={a.id} className="kanban-note" style={{ background: a.color }} />
        ))}
        {extra > 0 && <span className="kanban-note kanban-note-more">+{extra}</span>}
      </div>

      {open && (
        <div className="kanban-panel" onClick={e => e.stopPropagation()}>
          <div className="kanban-panel-head">
            <span>Tablero · {agents.length} en curso</span>
            <button className="kanban-close" onClick={onClose} aria-label="Cerrar">×</button>
          </div>
          {agents.length === 0 ? (
            <div className="kanban-empty">Nadie trabajando ahora mismo.</div>
          ) : (
            <ul className="kanban-list">
              {agents.map(a => (
                <li key={a.id} className="kanban-row">
                  <span className="kanban-dot" style={{ background: a.color }} />
                  <div className="kanban-text">
                    <div className="kanban-name">{a.emoji} {a.name}</div>
                    <div className="kanban-task">{a.task ?? a.statusText ?? '—'}</div>
                  </div>
                  <span className={`kanban-state kanban-state-${a.state}`}>
                    {STATE_LABEL[a.state] ?? a.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

export default KanbanBoard
