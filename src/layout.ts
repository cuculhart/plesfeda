import { MarkerType, type Edge, type Node } from '@xyflow/react'
import {
	childrenOf,
	MAX_CHILDREN,
	rollup,
	type Schedule,
	type Task,
} from './model'

export const NODE_W = 176
export const NODE_H = 60
export const SLOT_W = 128
export const SLOT_H = 40
export const SIB_GAP = 28 // gap between siblings on the cross axis
export const DEPTH_GAP_V = 72 // parent→child distance, vertical mode
export const DEPTH_GAP_H = 120 // parent→child distance, horizontal mode
export const TREE_GAP = 96

export type Dir = 'v' | 'h' // v = parent on top; h = parent on the left

export type TaskData = {
	task: Task
	code: string // WBS number, e.g. "1.2.3"
	rollup: number
	leaf: boolean
	dir: Dir
	/** elapsed span (EF-ES) for parents; null for leaves / cyclic schedules */
	span: number | null
	critical: boolean
	depErr: boolean
} & Record<string, unknown>

export type SlotData = {
	kind: 'input' | 'ghost'
	parentId: string
	dir: Dir
} & Record<string, unknown>

export type BoardNode = Node<TaskData | SlotData>

function slotKinds(t: Task, editingParent: string | null): SlotData['kind'][] {
	if (!t.open) return []
	return editingParent === t.id ? ['input', 'ghost'] : ['ghost']
}

/** Build RF nodes/edges. Positions are fully derived: same depth shares the
 *  same position on the depth axis; parents are centered on their child row. */
export function buildGraph(
	tasks: Task[],
	editingParent: string | null,
	dir: Dir,
	sched: Schedule | null,
): { nodes: BoardNode[]; edges: Edge[] } {
	const nodes: BoardNode[] = []
	const edges: Edge[] = []
	const memo = new Map<string, number>()

	const nodeCross = dir === 'v' ? NODE_W : NODE_H
	const slotCross = dir === 'v' ? SLOT_W : SLOT_H
	const depthStep = dir === 'v' ? NODE_H + DEPTH_GAP_V : NODE_W + DEPTH_GAP_H

	/** subtree span on the cross axis (width for v, height for h) */
	function span(t: Task): number {
		const m = memo.get(t.id)
		if (m !== undefined) return m
		const kids = childrenOf(tasks, t.id)
		const nSlot = kids.length < MAX_CHILDREN ? slotKinds(t, editingParent).length : 0
		const n = kids.length + nSlot
		let s = nodeCross
		if (n > 0) {
			const rowW =
				kids.reduce((acc, k) => acc + span(k), 0) +
				nSlot * slotCross +
				(n - 1) * SIB_GAP
			s = Math.max(nodeCross, rowW)
		}
		memo.set(t.id, s)
		return s
	}

	function nodePos(t: Task, depth: number, crossStart: number) {
		const w = span(t)
		return dir === 'v'
			? { x: crossStart + w / 2 - NODE_W / 2, y: depth * depthStep }
			: { x: depth * depthStep, y: crossStart + w / 2 - NODE_H / 2 }
	}

	function place(t: Task, depth: number, crossStart: number, code: string) {
		const w = span(t)
		const leaf = childrenOf(tasks, t.id).length === 0
		nodes.push({
			id: t.id,
			type: 'task',
			position: nodePos(t, depth, crossStart),
			data: {
				task: t,
				code,
				rollup: rollup(tasks, t.id),
				leaf,
				dir,
				span:
					sched && !sched.cyclic && !leaf
						? (sched.span.get(t.id) ?? null)
						: null,
				critical: sched ? sched.critical.has(t.id) : false,
				depErr: sched ? sched.errors.has(t.id) : false,
			},
			draggable: true,
			width: NODE_W,
			height: NODE_H,
		} satisfies BoardNode)

		const kids = childrenOf(tasks, t.id)
		const slots = kids.length < MAX_CHILDREN ? slotKinds(t, editingParent) : []
		const rowW =
			kids.reduce((s, k) => s + span(k), 0) +
			slots.length * slotCross +
			(kids.length + slots.length - 1) * SIB_GAP
		let cur = crossStart + (w - Math.max(rowW, 0)) / 2

		kids.forEach((k, i) => {
			edges.push({
				id: `e-${t.id}-${k.id}`,
				source: t.id,
				target: k.id,
				type: 'smoothstep',
				className: 'wbs-edge',
			})
			const kw = span(k)
			place(k, depth + 1, cur, `${code}.${i + 1}`)
			cur += kw + SIB_GAP
		})
		for (const kind of slots) {
			const sid = `slot:${kind}:${t.id}`
			const childDepth = (depth + 1) * depthStep
			// align the slot's leading edge with real children so slot edges
			// share the same rail as solid edges
			const position =
				dir === 'v' ? { x: cur, y: childDepth } : { x: childDepth, y: cur }
			nodes.push({
				id: sid,
				type: 'slot',
				position,
				data: { kind, parentId: t.id, dir },
				draggable: false,
				selectable: false,
				deletable: false,
				focusable: false,
				width: SLOT_W,
				height: SLOT_H,
			} satisfies BoardNode)
			edges.push({
				id: `e-${t.id}-${sid}`,
				source: t.id,
				target: sid,
				type: 'smoothstep',
				className: 'wbs-edge slot-edge',
			})
			cur += slotCross + SIB_GAP
		}
	}

	let cur = 0
	childrenOf(tasks, null).forEach((r, i) => {
		place(r, 0, cur, `${i + 1}`)
		cur += span(r) + TREE_GAP
	})

	// dependency (finish-to-start) edges, distinct from tree edges
	const ids = new Set(tasks.map((t) => t.id))
	for (const t of tasks) {
		for (const p of t.deps ?? []) {
			if (!ids.has(p)) continue
			const crit =
				sched && !sched.cyclic
					? sched.critical.has(p) &&
						sched.critical.has(t.id) &&
						sched.es.get(t.id) === sched.ef.get(p)
					: false
			const err = sched
				? sched.badDeps.has(`${p}->${t.id}`) ||
					(sched.cyclic && sched.errors.has(p) && sched.errors.has(t.id))
				: false
			edges.push({
				id: `dep:${p}->${t.id}`,
				source: p,
				target: t.id,
				type: 'default',
				className: `dep-edge${crit ? ' critical' : ''}${err ? ' err' : ''}`,
				markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--dep)' },
			})
		}
	}
	return { nodes, edges }
}
