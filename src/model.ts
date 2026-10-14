export type Task = {
	id: string
	parentId: string | null // null = root
	order: number // order among siblings
	name: string
	effort: number // required effort; 0 = hidden
	/** breakdown session active: a trailing input/ghost slot follows the children */
	open?: boolean
	/** finish-to-start predecessors: this task can start after each dep finishes */
	deps?: string[]
}

/** Max children per task — a safety rail, not a methodology limit */
export const MAX_CHILDREN = 255

let seq = 0
export function newId(): string {
	return `t${Date.now().toString(36)}-${(seq++).toString(36)}`
}

export function childrenOf(tasks: Task[], parentId: string | null): Task[] {
	return tasks
		.filter((t) => t.parentId === parentId)
		.sort((a, b) => a.order - b.order)
}

/** Recursive effort sum. Leaf = own effort; parent = sum of subtree. */
export function rollup(tasks: Task[], id: string): number {
	const kids = childrenOf(tasks, id)
	if (kids.length === 0) return tasks.find((t) => t.id === id)?.effort ?? 0
	return kids.reduce((s, k) => s + rollup(tasks, k.id), 0)
}

/** Is `id` inside the subtree rooted at `ancestorId`? (id itself excluded) */
export function isDescendant(
	tasks: Task[],
	id: string,
	ancestorId: string,
): boolean {
	let cur = tasks.find((t) => t.id === id)
	while (cur?.parentId) {
		if (cur.parentId === ancestorId) return true
		cur = tasks.find((t) => t.id === cur!.parentId)
	}
	return false
}

/** Can `nodeId` be reparented under `newParentId`? Rejects cycles/self. */
export function canReparent(
	tasks: Task[],
	nodeId: string,
	newParentId: string | null,
): boolean {
	if (newParentId === null) return true
	if (newParentId === nodeId) return false
	return !isDescendant(tasks, newParentId, nodeId)
}

/** next sibling order value under a parent */
export function nextOrder(tasks: Task[], parentId: string | null): number {
	const kids = childrenOf(tasks, parentId)
	return kids.length === 0 ? 1 : kids[kids.length - 1].order + 1
}

/** Delete a task. mode: 'subtree' removes descendants too;
 *  'promote' makes direct children roots (their subtrees survive).
 *  Deps pointing at removed tasks are stripped. */
export function deleteTask(
	tasks: Task[],
	id: string,
	mode: 'subtree' | 'promote',
): Task[] {
	if (mode === 'subtree') {
		const doomed = new Set<string>([id])
		let grew = true
		while (grew) {
			grew = false
			for (const t of tasks) {
				if (t.parentId && doomed.has(t.parentId) && !doomed.has(t.id)) {
					doomed.add(t.id)
					grew = true
				}
			}
		}
		return tasks
			.filter((t) => !doomed.has(t.id))
			.map((t) =>
				t.deps?.some((d) => doomed.has(d))
					? { ...t, deps: t.deps.filter((d) => !doomed.has(d)) }
					: t,
			)
	}
	return tasks
		.filter((t) => t.id !== id)
		.map((t) => {
			const parentId = t.parentId === id ? null : t.parentId
			const deps = t.deps?.filter((d) => d !== id)
			return { ...t, parentId, deps }
		})
}

/** Coerce unknown input (JSON import / localStorage) into a sane task
 *  list. Accepts a bare task array or `{ tasks: [...] }`. Returns null
 *  when the input has no task array at all. Malformed entries are
 *  dropped, dangling/cyclic parents are reset to root, and deps that
 *  don't resolve are stripped. Invalid deps that DO resolve (self /
 *  ancestor / descendant) are kept — schedule() flags them as errors. */
export function sanitizeTasks(raw: unknown): Task[] | null {
	const list = Array.isArray(raw)
		? raw
		: raw && typeof raw === 'object'
			? (raw as { tasks?: unknown }).tasks
			: null
	if (!Array.isArray(list)) return null

	const seen = new Set<string>()
	const out: Task[] = []
	for (const e of list) {
		if (!e || typeof e !== 'object') continue
		const o = e as Record<string, unknown>
		if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue
		seen.add(o.id)
		out.push({
			id: o.id,
			parentId: typeof o.parentId === 'string' ? o.parentId : null,
			order:
				typeof o.order === 'number' && Number.isFinite(o.order)
					? o.order
					: out.length + 1,
			name: typeof o.name === 'string' ? o.name : '',
			effort:
				typeof o.effort === 'number' && Number.isFinite(o.effort)
					? o.effort
					: 0,
			open: o.open === true,
			deps: Array.isArray(o.deps)
				? [
						...new Set(
							o.deps.filter(
								(d): d is string => typeof d === 'string',
							),
						),
					]
				: undefined,
		})
	}

	const ids = new Set(out.map((t) => t.id))
	const byId = new Map(out.map((t) => [t.id, t]))
	// walk each parent chain to the root; a dead end or a revisit means
	// the original parentId was dangling or cyclic → reset to root
	for (const t of out) {
		let p = t.parentId
		if (p === null) continue
		const chain = new Set<string>([t.id])
		while (p !== null && ids.has(p) && !chain.has(p)) {
			chain.add(p)
			p = byId.get(p)?.parentId ?? null
		}
		if (p !== null) t.parentId = null
	}
	for (const t of out) {
		const deps = t.deps?.filter((d) => ids.has(d))
		t.deps = deps && deps.length > 0 ? deps : undefined
	}
	return out
}

/* ------------------------------------------------------------------ */
/* CPM schedule (PERT)                                                  */
/*                                                                      */
/* - leaf duration = effort (days)                                      */
/* - a child with no deps inherits its parent's earliest start          */
/* - a child with deps starts at max(parent ES, dep EFs)                */
/* - parent EF = max of descendants' EF                                 */
/* - deps on self / ancestor / descendant are invalid (flagged)         */
/* - dependency cycles are flagged; the schedule is then unreliable     */
/* ------------------------------------------------------------------ */

export type Schedule = {
	es: Map<string, number>
	ef: Map<string, number>
	/** EF - ES; for parents this is the elapsed span, not the cost */
	span: Map<string, number>
	/** project finish = max EF over roots */
	project: number
	/** task ids on the critical path (zero slack) */
	critical: Set<string>
	/** task ids involved in invalid deps or cycles */
	errors: Set<string>
	/** dep edge keys "pred->succ" that are invalid (self/ancestor/descendant) */
	badDeps: Set<string>
	cyclic: boolean
}

export function schedule(tasks: Task[]): Schedule {
	const ids = new Set(tasks.map((t) => t.id))
	const errors = new Set<string>()
	const badDeps = new Set<string>()
	const preds = new Map<string, string[]>()
	const succs = new Map<string, string[]>()
	for (const t of tasks) {
		for (const d of t.deps ?? []) {
			if (!ids.has(d)) continue
			if (
				d === t.id ||
				isDescendant(tasks, d, t.id) ||
				isDescendant(tasks, t.id, d)
			) {
				errors.add(t.id)
				errors.add(d)
				badDeps.add(`${d}->${t.id}`)
				continue
			}
			preds.set(t.id, [...(preds.get(t.id) ?? []), d])
			succs.set(d, [...(succs.get(d) ?? []), t.id])
		}
	}

	const depth = new Map<string, number>()
	const depthOf = (t: Task): number => {
		const m = depth.get(t.id)
		if (m !== undefined) return m
		const p = t.parentId ? tasks.find((x) => x.id === t.parentId) : null
		const d = p ? depthOf(p) + 1 : 0
		depth.set(t.id, d)
		return d
	}
	const byDepth = [...tasks].sort((a, b) => depthOf(b) - depthOf(a))
	const leaves = new Set(
		tasks.filter((t) => childrenOf(tasks, t.id).length === 0).map((t) => t.id),
	)

	const es = new Map<string, number>(tasks.map((t) => [t.id, 0]))
	const ef = new Map<string, number>()
	const recomputeEf = () => {
		for (const t of byDepth) {
			ef.set(
				t.id,
				leaves.has(t.id)
					? (es.get(t.id) ?? 0) + t.effort
					: Math.max(
							...(childrenOf(tasks, t.id).map((c) => ef.get(c.id) ?? 0)),
							es.get(t.id) ?? 0,
						),
			)
		}
	}
	recomputeEf()

	// forward relaxation; if values still grow after N passes there is a cycle
	let cyclic = false
	for (let i = 0; i <= tasks.length; i++) {
		const grew = new Set<string>()
		for (const t of tasks) {
			let v = t.parentId ? (es.get(t.parentId) ?? 0) : 0
			for (const p of preds.get(t.id) ?? []) v = Math.max(v, ef.get(p) ?? 0)
			if (v > (es.get(t.id) ?? 0)) {
				es.set(t.id, v)
				grew.add(t.id)
			}
		}
		recomputeEf()
		if (grew.size === 0) break
		if (i === tasks.length) {
			cyclic = true
			for (const id of grew) errors.add(id)
		}
	}

	const span = new Map<string, number>()
	for (const t of tasks) span.set(t.id, (ef.get(t.id) ?? 0) - (es.get(t.id) ?? 0))

	const project = Math.max(
		0,
		...childrenOf(tasks, null).map((t) => ef.get(t.id) ?? 0),
	)

	// backward pass for slack / critical path (skipped when cyclic)
	const critical = new Set<string>()
	if (!cyclic) {
		const lf = new Map<string, number>(tasks.map((t) => [t.id, project]))
		for (let i = 0; i <= tasks.length; i++) {
			let changed = false
			for (const t of tasks) {
				let v = project
				if (t.parentId && ids.has(t.parentId))
					v = lf.get(t.parentId) ?? project
				for (const s of succs.get(t.id) ?? [])
					v = Math.min(v, (lf.get(s) ?? project) - (span.get(s) ?? 0))
				if (v < (lf.get(t.id) ?? project)) {
					lf.set(t.id, v)
					changed = true
				}
			}
			if (!changed) break
		}
		for (const t of tasks) {
			if ((lf.get(t.id) ?? project) - (ef.get(t.id) ?? 0) <= 1e-9)
				critical.add(t.id)
		}
	}

	return { es, ef, span, project, critical, errors, badDeps, cyclic }
}
