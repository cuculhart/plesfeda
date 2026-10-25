import type { Edge, WorldObject } from '@kimetron/core'
import type { Task, Schedule } from './model'
import {
	buildGraph,
	type BoardNode,
	type Dir,
	type SlotData,
	type TaskData,
} from './layout'

export type NodeInfo = TaskData | SlotData

export type BuiltDoc = {
	objects: WorldObject[]
	edges: Edge[]
	/** renderObject lookup: node id → the data the RF version put on the node */
	info: Map<string, NodeInfo>
}

/** side ports — tree/dep edges anchor on a facing side, not the center */
const PORTS = [
	{ id: 'l', fx: 0, fy: 0.5 },
	{ id: 'r', fx: 1, fy: 0.5 },
	{ id: 't', fx: 0.5, fy: 0 },
	{ id: 'b', fx: 0.5, fy: 1 },
]

type Side = 'l' | 'r' | 't' | 'b'
const OPPOSITE: Record<Side, Side> = { l: 'r', r: 'l', t: 'b', b: 't' }

/** Project the task tree into a kimetron doc. Positions are fully derived —
 *  the engine doc is rebuilt on every tasks/dir/editingParent change, so a
 *  dropped node with no structural change snaps back like the RF version did. */
export function buildDoc(
	tasks: Task[],
	editingParent: string | null,
	dir: Dir,
	sched: Schedule | null,
): BuiltDoc {
	const g = buildGraph(tasks, editingParent, dir, sched)
	const info = new Map<string, NodeInfo>()
	const objects: WorldObject[] = g.nodes.map((n: BoardNode) => {
		info.set(n.id, n.data as NodeInfo)
		return {
			id: n.id,
			kind: n.type === 'task' ? 'task' : 'slot',
			x: n.position.x,
			y: n.position.y,
			w: n.width ?? 0,
			h: n.height ?? 0,
			ports: PORTS.map((p) => ({ ...p })),
			// slots are DOM-only affordances — never moved/selected by the engine
			locked: n.type === 'slot',
		}
	})
	// tree edges leave the parent on the depth side and enter the child
	// from the opposite side — the bracket/tournament look (driver recipe).
	// dep edges use the same ports — in the RF version they shared the task
	// node's single source/target handles, which is what gave the sideways
	// bezier sweep (NOT facing-side pick like the driver spike)
	const out: Side = dir === 'v' ? 'b' : 'r'
	const edges: Edge[] = g.edges.map((e) => {
		if (!e.id.startsWith('dep:')) {
			// tree edge — .wbs-edge styling; slot edges are dashed
			const slotEdge = (e.className ?? '').includes('slot-edge')
			return {
				id: e.id,
				from: { obj: e.source, port: out },
				to: { obj: e.target, port: OPPOSITE[out] },
				route: 'smoothstep',
				style: {
					color: 'var(--edge)',
					width: 1.5,
					...(slotEdge ? { dash: [4, 4] } : {}),
				},
			}
		}
		const err = (e.className ?? '').includes(' err')
		const crit = (e.className ?? '').includes('critical')
		// .dep-edge / .critical / .err styling — same ports as tree edges
		return {
			id: e.id,
			from: { obj: e.source, port: out },
			to: { obj: e.target, port: OPPOSITE[out] },
			route: 'bezier',
			markerEnd: 'arrow',
			style: {
				color: err
					? 'var(--danger)'
					: crit
						? 'var(--critical)'
						: 'var(--dep)',
				width: crit ? 2.5 : err ? 2 : 1.8,
			},
		}
	})
	return { objects, edges, info }
}

/** Drop-target for reparenting: first task object under (cx, cy). */
export function taskAt(
	objects: WorldObject[],
	cx: number,
	cy: number,
	exclude: string,
): string | null {
	for (const o of objects) {
		if (o.kind !== 'task' || o.id === exclude) continue
		if (cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h)
			return o.id
	}
	return null
}
