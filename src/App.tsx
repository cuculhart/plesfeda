import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	Background,
	BackgroundVariant,
	Controls,
	ReactFlow,
	ReactFlowProvider,
	type Node,
	type NodeChange,
} from '@xyflow/react'
import { BoardCtx, type BoardActions, type Unit } from './board-context'
import { makeT, type Lang } from './i18n'
import { buildGraph, NODE_H, NODE_W, type BoardNode, type Dir } from './layout'
import {
	canReparent,
	deleteTasks,
	isDescendant,
	newId,
	nextOrder,
	sanitizeTasks,
	schedule,
	topmost,
	type Task,
} from './model'
import { SlotNode, TaskNode } from './nodes/task-node'
import {
	defaultGanttCfg,
	GanttDialog,
	GanttView,
	sanitizeGanttCfg,
	type GanttCfg,
} from './gantt'
import {
	exportRows,
	issueRows,
	toCsv,
	toMermaid,
	toTsv,
} from './export'

const nodeTypes = { task: TaskNode, slot: SlotNode }

const APP_VERSION = '0.2.0'

type Theme = 'system' | 'light' | 'quiet' | 'dark'
type ResolvedTheme = Exclude<Theme, 'system'>

const SEED: Task[] = [
	{ id: 'r1', parentId: null, order: 1, name: 'Plesfeda mock', effort: 0 },
	{ id: 'c1', parentId: 'r1', order: 1, name: 'Board & nodes', effort: 0 },
	{ id: 'c2', parentId: 'r1', order: 2, name: 'Breakdown input', effort: 0 },
	{ id: 'c3', parentId: 'r1', order: 3, name: 'Docs', effort: 1 },
	{ id: 'g1', parentId: 'c1', order: 1, name: 'Layout', effort: 3 },
	{ id: 'g2', parentId: 'c1', order: 2, name: 'Theme', effort: 2 },
	{ id: 'g3', parentId: 'c2', order: 1, name: 'Ghost slots', effort: 5 },
]

const LS_KEY = 'plesfeda.tasks.v1'
const LS_UI = 'plesfeda.ui.v1'

type UiColors = {
	nodeFill?: string
	nodeBorder?: string
	nodeText?: string
	edge?: string
	toolbarBg?: string
}

type UiState = {
	theme?: Theme
	dir?: Dir
	lang?: Lang
	colors?: UiColors
	unit?: Unit
	gantt?: GanttCfg
}

const pick = <T,>(v: unknown, ok: readonly T[]): T | undefined =>
	ok.includes(v as T) ? (v as T) : undefined

function loadUi(): UiState {
	try {
		const raw = localStorage.getItem(LS_UI)
		if (raw) {
			const o = JSON.parse(raw) as Record<string, unknown>
			const colors: UiColors = {}
			if (o.colors && typeof o.colors === 'object')
				for (const k of [
					'nodeFill',
					'nodeBorder',
					'nodeText',
					'edge',
					'toolbarBg',
				] as const) {
					const v = (o.colors as Record<string, unknown>)[k]
					if (typeof v === 'string') colors[k] = v
				}
			return {
				theme: pick<Theme>(o.theme, [
					'system',
					'light',
					'quiet',
					'dark',
				]),
				dir: pick<Dir>(o.dir, ['v', 'h']),
				lang: pick<Lang>(o.lang, ['en', 'ja']),
				colors,
				unit: pick<Unit>(o.unit, ['h', 'd']),
				gantt:
					o.gantt !== undefined
						? sanitizeGanttCfg(o.gantt)
						: undefined,
			}
		}
	} catch {
		/* fall through */
	}
	return {}
}

function COLOR_DEFAULTS(theme: ResolvedTheme): Required<UiColors> {
	return {
		nodeFill: '#fef3c7',
		nodeBorder: '#e0d77a',
		nodeText: '#1c1917',
		edge:
			theme === 'dark'
				? '#5a6474'
				: theme === 'quiet'
					? '#b6ae9d'
					: '#a39e93',
		toolbarBg:
			theme === 'dark'
				? '#23262e'
				: theme === 'quiet'
					? '#f6f3ee'
					: '#ffffff',
	}
}

function loadTasks(): Task[] {
	try {
		const raw = localStorage.getItem(LS_KEY)
		if (raw) {
			const arr = sanitizeTasks(JSON.parse(raw))
			if (arr) return arr
		}
	} catch {
		/* fall through */
	}
	return SEED
}

function Board() {
	const [tasks, setTasks] = useState<Task[]>(loadTasks)
	const [editingParent, setEditingParent] = useState<string | null>(null)
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
	const [depPending, setDepPending] = useState<string | null>(null)
	const [selDep, setSelDep] = useState<string | null>(null)
	const [depDel, setDepDel] = useState<string | null>(null)
	const [showSettings, setShowSettings] = useState(false)
	const [showAbout, setShowAbout] = useState(false)
	const [showClear, setShowClear] = useState(false)
	const [theme, setTheme] = useState<Theme>(() => loadUi().theme ?? 'light')
	const [dir, setDir] = useState<Dir>(() => loadUi().dir ?? 'v')
	const [lang, setLang] = useState<Lang>(() => loadUi().lang ?? 'en')
	const [colors, setColors] = useState<UiColors>(() => loadUi().colors ?? {})
	const [unit, setUnit] = useState<Unit>(() => loadUi().unit ?? 'd')
	const [ganttCfg, setGanttCfg] = useState<GanttCfg>(
		() => loadUi().gantt ?? defaultGanttCfg(),
	)
	const [showGantt, setShowGantt] = useState(false)
	const [ganttDlg, setGanttDlg] = useState(false)
	const [showExport, setShowExport] = useState(false)
	const [exportText, setExportText] = useState<string | null>(null)
	const t = useMemo(() => makeT(lang), [lang])
	const [osDark, setOsDark] = useState(
		() => window.matchMedia('(prefers-color-scheme: dark)').matches,
	)
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: dark)')
		const fn = () => setOsDark(mq.matches)
		mq.addEventListener('change', fn)
		return () => mq.removeEventListener('change', fn)
	}, [])
	const resolvedTheme: ResolvedTheme =
		theme === 'system' ? (osDark ? 'dark' : 'light') : theme
	const history = useRef<{ past: Task[][]; future: Task[][] }>({
		past: [],
		future: [],
	})

	const commit = useCallback((next: Task[]) => {
		setTasks((prev) => {
			history.current.past.push(prev)
			if (history.current.past.length > 100) history.current.past.shift()
			history.current.future = []
			return next
		})
	}, [])

	const undo = useCallback(() => {
		setTasks((prev) => {
			const p = history.current.past.pop()
			if (!p) return prev
			history.current.future.push(prev)
			return p
		})
	}, [])

	const redo = useCallback(() => {
		setTasks((prev) => {
			const f = history.current.future.pop()
			if (!f) return prev
			history.current.past.push(prev)
			return f
		})
	}, [])

	useEffect(() => {
		localStorage.setItem(LS_KEY, JSON.stringify(tasks))
	}, [tasks])

	// selection/editing can outlive their task (delete, undo, import) —
	// drop them so a stale editingParent can't create orphan children
	useEffect(() => {
		const ids = new Set(tasks.map((x) => x.id))
		setSelectedIds((prev) => {
			const next = new Set([...prev].filter((id) => ids.has(id)))
			return next.size === prev.size ? prev : next
		})
		if (deleteIds) {
			const alive = deleteIds.filter((id) => ids.has(id))
			if (alive.length !== deleteIds.length)
				setDeleteIds(alive.length > 0 ? alive : null)
		}
		if (editingParent && !ids.has(editingParent)) setEditingParent(null)
		if (depPending && !ids.has(depPending)) setDepPending(null)
	}, [tasks, deleteIds, editingParent, depPending])

	useEffect(() => {
		localStorage.setItem(
			LS_UI,
			JSON.stringify({ theme, dir, lang, colors, unit, gantt: ganttCfg }),
		)
	}, [theme, dir, lang, colors, unit, ganttCfg])

	/** Bulk delete: normalize to topmost so overlapping subtrees aren't
	 *  double-applied. The promote/subtree prompt only appears when some
	 *  descendant is NOT selected — children already in the selection were
	 *  explicitly marked for deletion, so asking about them is noise. */
	const requestDeleteIds = useCallback(
		(ids: string[]) => {
			const set = new Set(ids)
			const tops = topmost(tasks, ids)
			if (tops.length === 0) return
			const needsConfirm = tops.some((id) =>
				tasks.some((t) => !set.has(t.id) && isDescendant(tasks, t.id, id)),
			)
			if (needsConfirm) setDeleteIds(tops)
			else commit(deleteTasks(tasks, tops, 'subtree'))
		},
		[tasks, commit],
	)

	const actions = useMemo<BoardActions>(
		() => ({
			t,
			unit,
			rename: (id, name) =>
				commit(tasks.map((x) => (x.id === id ? { ...x, name } : x))),
			setEffort: (id, effort) =>
				commit(tasks.map((x) => (x.id === id ? { ...x, effort } : x))),
			toggleOpen: (id) => {
				const task = tasks.find((x) => x.id === id)
				if (!task) return
				if (task.open) {
					commit(
						tasks.map((x) => (x.id === id ? { ...x, open: false } : x)),
					)
					if (editingParent === id) setEditingParent(null)
				} else {
					commit(tasks.map((x) => (x.id === id ? { ...x, open: true } : x)))
					setEditingParent(id)
				}
			},
			activateSlot: (parentId) => setEditingParent(parentId),
			commitSlot: (parentId, name) => {
				commit([
					...tasks,
					{
						id: newId(),
						parentId,
						order: nextOrder(tasks, parentId),
						name,
						effort: 0,
					},
				])
			},
			deactivateSlot: () => setEditingParent(null),
			requestDelete: (id) => requestDeleteIds([id]),
		}),
		[tasks, editingParent, commit, t, unit, requestDeleteIds],
	)

	const sched = useMemo(() => schedule(tasks), [tasks])
	const graph = useMemo(
		() => buildGraph(tasks, editingParent, dir, sched),
		[tasks, editingParent, dir, sched],
	)
	const edges = useMemo(
		() => graph.edges.map((e) => ({ ...e, selected: e.id === selDep })),
		[graph.edges, selDep],
	)
	const [nodes, setNodes] = useState<BoardNode[]>(graph.nodes)
	useEffect(() => {
		setNodes(
			graph.nodes.map((n) => ({ ...n, selected: selectedIds.has(n.id) })),
		)
	}, [graph, selectedIds, setNodes])

	const onNodesChange = useCallback(
		(changes: NodeChange<BoardNode>[]) => {
			for (const c of changes) {
				if (c.type === 'select')
					setSelectedIds((prev) => {
						const next = new Set(prev)
						if (c.selected && !c.id.startsWith('slot:'))
							next.add(c.id)
						else next.delete(c.id)
						return next
					})
			}
			// apply position changes during drag so the node follows the pointer
			setNodes((nds) =>
				nds.map((n) => {
					const pos = changes.find(
						(c) => c.type === 'position' && c.id === n.id,
					)
					return pos && pos.type === 'position' && pos.position
						? { ...n, position: pos.position }
						: n
				}),
			)
		},
		[setNodes],
	)

	/** Drop onto another node to reparent; drop on empty space makes it a root. */
	const onNodeDragStop = useCallback(
		(_e: unknown, node: Node) => {
			if (node.type !== 'task') return
			const cx = node.position.x + NODE_W / 2
			const cy = node.position.y + NODE_H / 2
			const target = graph.nodes.find(
				(n) =>
					n.type === 'task' &&
					n.id !== node.id &&
					cx >= n.position.x &&
					cx <= n.position.x + NODE_W &&
					cy >= n.position.y &&
					cy <= n.position.y + NODE_H,
			)
			const task = tasks.find((x) => x.id === node.id)
			if (!task) return
			if (target) {
				if (canReparent(tasks, node.id, target.id)) {
					commit(
						tasks.map((x) =>
							x.id === node.id
								? {
										...x,
										parentId: target.id,
										order: nextOrder(tasks, target.id),
									}
								: x,
						),
					)
					return
				}
			} else if (task.parentId !== null) {
				commit(
					tasks.map((x) =>
						x.id === node.id
							? {
									...x,
									parentId: null,
									order: nextOrder(tasks, null),
								}
							: x,
					),
				)
				return
			}
			// no structural change — snap the node back to its layout position
			setNodes(
				graph.nodes.map((n) => ({
					...n,
					selected: selectedIds.has(n.id),
				})),
			)
		},
		[graph.nodes, tasks, commit, selectedIds],
	)

	const addDep = useCallback(
		(succ: string, pred: string) => {
			commit(
				tasks.map((x) =>
					x.id === succ
						? { ...x, deps: [...new Set([...(x.deps ?? []), pred])] }
						: x,
				),
			)
		},
		[tasks, commit],
	)

	const removeDep = useCallback(
		(edgeId: string) => {
			// edge id format: dep:<pred>-><succ>
			const body = edgeId.slice(4)
			const at = body.indexOf('->')
			const pred = body.slice(0, at)
			const succ = body.slice(at + 2)
			commit(
				tasks.map((x) =>
					x.id === succ
						? { ...x, deps: (x.deps ?? []).filter((d) => d !== pred) }
						: x,
				),
			)
			setSelDep(null)
		},
		[tasks, commit],
	)

	const onNodeClick = useCallback(
		(_e: unknown, node: Node) => {
			if (!depPending || node.type !== 'task' || node.id === depPending)
				return
			addDep(depPending, node.id)
		},
		[depPending, addDep],
	)

	const onEdgeClick = useCallback((_e: unknown, edge: { id: string }) => {
		setSelDep(edge.id.startsWith('dep:') ? edge.id : null)
	}, [])

	const onEdgeDoubleClick = useCallback(
		(_e: unknown, edge: { id: string }) => {
			if (edge.id.startsWith('dep:')) setDepDel(edge.id)
		},
		[],
	)

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName
			if (tag === 'INPUT' || tag === 'TEXTAREA') return
			if (e.key === 'Escape') {
				if (depDel) setDepDel(null)
				else if (deleteIds) setDeleteIds(null)
				else if (showClear) setShowClear(false)
				else if (ganttDlg) setGanttDlg(false)
				else if (showSettings) setShowSettings(false)
				else if (showAbout) setShowAbout(false)
				else if (showGantt) setShowGantt(false)
				else if (showExport) {
					setShowExport(false)
					setExportText(null)
				} else {
					setDepPending(null)
					setSelDep(null)
					setSelectedIds(new Set())
				}
				return
			}
			if (e.key === 'Delete' || e.key === 'Backspace') {
				if (selDep) removeDep(selDep)
				else if (selectedIds.size > 0)
					requestDeleteIds([...selectedIds])
			}
			if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
				if (e.shiftKey) redo()
				else undo()
			}
			if (e.key === 'y' && (e.ctrlKey || e.metaKey)) redo()
		},
		[
			selectedIds,
			selDep,
			depDel,
			deleteIds,
			showClear,
			ganttDlg,
			showSettings,
			showAbout,
			showGantt,
			showExport,
			removeDep,
			requestDeleteIds,
			undo,
			redo,
		],
	)

	const saveFile = useCallback(() => {
		const doc = { app: 'plesfeda', version: 1, tasks, gantt: ganttCfg }
		const blob = new Blob([JSON.stringify(doc, null, 2)], {
			type: 'application/json',
		})
		const a = document.createElement('a')
		a.href = URL.createObjectURL(blob)
		a.download = `plesfeda-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`
		a.click()
		URL.revokeObjectURL(a.href)
	}, [tasks, ganttCfg])

	const doExport = useCallback(
		(kind: 'tsv' | 'csv' | 'issue' | 'mmd') => {
			const text =
				kind === 'issue'
					? toTsv(issueRows(tasks, sched, ganttCfg, unit))
					: kind === 'mmd'
						? toMermaid(tasks, sched, ganttCfg, unit)
						: kind === 'csv'
							? toCsv(exportRows(tasks, sched, ganttCfg, unit))
							: toTsv(exportRows(tasks, sched, ganttCfg, unit))
			if (kind === 'csv') {
				const blob = new Blob([text], { type: 'text/csv' })
				const a = document.createElement('a')
				a.href = URL.createObjectURL(blob)
				a.download = `plesfeda-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.csv`
				a.click()
				URL.revokeObjectURL(a.href)
			} else {
				navigator.clipboard?.writeText(text).catch(() => {})
			}
			setExportText(text)
		},
		[tasks, sched, ganttCfg, unit],
	)

	const fileRef = useRef<HTMLInputElement>(null)
	const openFile = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const f = e.target.files?.[0]
			e.target.value = ''
			if (!f) return
			f.text()
				.then((text) => {
					const doc: unknown = JSON.parse(text)
					const arr = sanitizeTasks(doc)
					if (!arr) throw new Error('bad')
					commit(arr)
					if (doc !== null && typeof doc === 'object' && 'gantt' in doc)
						setGanttCfg(
							sanitizeGanttCfg(
								(doc as { gantt?: unknown }).gantt,
							),
						)
					setEditingParent(null)
					setSelectedIds(new Set())
				})
				.catch(() => window.alert(t('Invalid file')))
		},
		[commit, t],
	)

	const addTask = useCallback(() => {
		const id = newId()
		commit([
			...tasks,
			{
				id,
				parentId: null,
				order: nextOrder(tasks, null),
				name: '',
				effort: 0,
			},
		])
		setSelectedIds(new Set([id]))
	}, [tasks, commit])

	const singleId =
		selectedIds.size === 1 ? [...selectedIds][0]! : null

	const appStyle = {
		...(colors.nodeFill && { '--node-fill': colors.nodeFill }),
		...(colors.nodeBorder && { '--node-border': colors.nodeBorder }),
		...(colors.nodeText && { '--node-text': colors.nodeText }),
		...(colors.edge && { '--edge': colors.edge }),
		...(colors.toolbarBg && { '--toolbar-bg': colors.toolbarBg }),
	} as React.CSSProperties

	return (
		<BoardCtx.Provider value={actions}>
			<div
				className={`app ${resolvedTheme}${showGantt ? ' gantt-open' : ''}`}
				style={appStyle}
				onKeyDown={onKeyDown}
				tabIndex={-1}
			>
				<ReactFlow
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					onNodesChange={onNodesChange}
					onNodeDragStop={onNodeDragStop}
					onNodeClick={onNodeClick}
					onEdgeClick={onEdgeClick}
					onEdgeDoubleClick={onEdgeDoubleClick}
					onPaneClick={() => {
						setEditingParent(null)
						setSelectedIds(new Set())
						setDepPending(null)
						setSelDep(null)
					}}
					fitView
					deleteKeyCode={null}
					nodesConnectable={false}
					multiSelectionKeyCode="Shift"
					selectionKeyCode="Shift"
				>
					<Background variant={BackgroundVariant.Dots} gap={20} size={1} />
					<Controls showInteractive={false} />
				</ReactFlow>

				<div className="toolbar">
					<div className="brand">
						Plesfeda
						<em>{t('work breakdown structure editor')}</em>
					</div>
					<button onClick={addTask}>{t('+ Task')}</button>
					<button
						disabled={!singleId}
						onClick={() => singleId && actions.toggleOpen(singleId)}
					>
						{t('Breakdown')}
					</button>
					<button
						className={depPending ? 'active' : ''}
						disabled={!singleId && !depPending}
						onClick={() =>
							setDepPending(depPending ? null : singleId)
						}
					>
						{t('Depends on')}
					</button>
					<button
						disabled={selectedIds.size === 0}
						onClick={() => requestDeleteIds([...selectedIds])}
					>
						{t('Delete')}
						{selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}
					</button>
					<button
						disabled={history.current.past.length === 0}
						onClick={undo}
					>
						{t('Undo')}
					</button>
					<button
						disabled={history.current.future.length === 0}
						onClick={redo}
					>
						{t('Redo')}
					</button>
					<button onClick={saveFile}>{t('Save')}</button>
					<button onClick={() => fileRef.current?.click()}>
						{t('Open')}
					</button>
					<button
						onClick={() => {
							if (sched.cyclic || sched.errors.size > 0) {
								window.alert(t('Resolve dependency errors first'))
								return
							}
							setGanttDlg(true)
						}}
					>
						{t('Gantt')}
					</button>
					<button
						onClick={() => {
							if (sched.cyclic || sched.errors.size > 0) {
								window.alert(t('Resolve dependency errors first'))
								return
							}
							setShowExport(true)
						}}
					>
						{t('Export')}
					</button>
					<button
						className="danger"
						onClick={() => setShowClear(true)}
					>
						{t('Clear')}
					</button>
					<input
						ref={fileRef}
						type="file"
						accept=".json,application/json"
						style={{ display: 'none' }}
						onChange={openFile}
					/>
					<button onClick={() => setShowSettings(true)}>
						⚙ {t('Settings')}
					</button>
					<button onClick={() => setShowAbout(true)}>
						ⓘ {t('About')}
					</button>
					{!sched.cyclic && tasks.length > 0 && (
						<div className="tb-proj">
							{t('Project')}: ⏱ {sched.project}{unit}
						</div>
					)}
					<div className="tb-hint">
						{depPending
							? t('Click a predecessor task — Esc to finish')
							: t('Drag onto a node to reparent; empty space = root')}
					</div>
				</div>

				{(sched.cyclic || sched.errors.size > 0) && (
					<div className="dep-banner">
						⚠{' '}
						{sched.cyclic
							? t('Dependency cycle detected')
							: t('Invalid dependency (ancestor/descendant)')}
					</div>
				)}

				{deleteIds && (
					<div className="modal-back" onClick={() => setDeleteIds(null)}>
						<div className="modal" onClick={(e) => e.stopPropagation()}>
							<h2>
								{deleteIds.length === 1
									? t('Delete this task?')
									: t('Delete selected tasks?')}
							</h2>
							<div className="modal-sub">
								{deleteIds
									.slice(0, 5)
									.map(
										(id) =>
											`“${tasks.find((x) => x.id === id)?.name || 'task'}”`,
									)
									.join(' ')}
								{deleteIds.length > 5 ? ` +${deleteIds.length - 5}` : ''}
							</div>
							<div className="modal-actions">
								<button
									onClick={() => {
										commit(deleteTasks(tasks, deleteIds, 'promote'))
										setDeleteIds(null)
									}}
								>
									{t('Keep children as roots')}
								</button>
								<button
									className="danger"
									onClick={() => {
										commit(deleteTasks(tasks, deleteIds, 'subtree'))
										setDeleteIds(null)
									}}
								>
									{t('Delete subtree')}
								</button>
								<button onClick={() => setDeleteIds(null)}>
									{t('Cancel')}
								</button>
							</div>
						</div>
					</div>
				)}

				{depDel && (
					<div className="modal-back" onClick={() => setDepDel(null)}>
						<div className="modal" onClick={(e) => e.stopPropagation()}>
							<h2>{t('Delete this dependency?')}</h2>
							<div className="modal-sub">
								{(() => {
									const body = depDel.slice(4)
									const at = body.indexOf('->')
									const name = (id: string) =>
										tasks.find((x) => x.id === id)?.name || 'task'
									return `“${name(body.slice(0, at))}” → “${name(body.slice(at + 2))}”`
								})()}
							</div>
							<div className="modal-actions">
								<button
									className="danger"
									onClick={() => {
										removeDep(depDel)
										setDepDel(null)
									}}
								>
									{t('Delete')}
								</button>
								<button onClick={() => setDepDel(null)}>
									{t('Cancel')}
								</button>
							</div>
						</div>
					</div>
				)}

				{showSettings && (
					<div className="modal-back" onClick={() => setShowSettings(false)}>
						<div className="modal" onClick={(e) => e.stopPropagation()}>
							<h2>{t('Settings')}</h2>
							<div className="field">
								<label>{t('Language')}</label>
								<select
									value={lang}
									onChange={(e) => setLang(e.target.value as Lang)}
								>
									<option value="en">English</option>
									<option value="ja">日本語</option>
								</select>
							</div>
							<div className="field">
								<label>{t('Layout')}</label>
								<select
									value={dir}
									onChange={(e) => setDir(e.target.value as Dir)}
								>
									<option value="v">{t('Vertical')}</option>
									<option value="h">{t('Horizontal')}</option>
								</select>
							</div>
							<div className="field">
								<label>{t('Unit')}</label>
								<select
									value={unit}
									onChange={(e) => setUnit(e.target.value as Unit)}
								>
									<option value="d">{t('Days')}</option>
									<option value="h">{t('Hours')}</option>
								</select>
							</div>
							<div className="field">
								<label>{t('Theme')}</label>
								<select
									value={theme}
									onChange={(e) => setTheme(e.target.value as Theme)}
								>
									<option value="system">{t('System')}</option>
									<option value="light">{t('Light')}</option>
									<option value="quiet">{t('Quiet')}</option>
									<option value="dark">{t('Dark')}</option>
								</select>
							</div>
							<div className="modal-sec">{t('Colors')}</div>
							{(
								[
									['Node color', 'nodeFill'],
									['Node border', 'nodeBorder'],
									['Text color', 'nodeText'],
									['Line color', 'edge'],
									['Toolbar color', 'toolbarBg'],
								] as const
							).map(([label, key]) => (
								<div className="field" key={key}>
									<label>{t(label)}</label>
									<input
										type="color"
										value={colors[key] ?? COLOR_DEFAULTS(resolvedTheme)[key]}
										onChange={(e) =>
											setColors((c) => ({
												...c,
												[key]: e.target.value,
											}))
										}
									/>
								</div>
							))}
							<div className="field">
								<button
									className="link"
									onClick={() => setColors({})}
								>
									{t('Reset colors')}
								</button>
							</div>
							<div className="modal-actions">
								<button onClick={() => setShowSettings(false)}>
									{t('Close')}
								</button>
							</div>
						</div>
					</div>
				)}

				{showAbout && (
					<div className="modal-back" onClick={() => setShowAbout(false)}>
						<div className="modal" onClick={(e) => e.stopPropagation()}>
							<h2>Plesfeda</h2>
							<div className="modal-sub">
								{t('work breakdown structure editor')}
							</div>
							<p className="about-text">
								{t('A board for building real Work Breakdown Structures — breakdown first, schedule later.')}
							</p>
							<p className="about-text about-name">
								{t('Welsh “pleth” (weave) + Old Irish “feda” (woods; also the name of the Ogham letters)')}
							</p>
							<div className="about-rows">
								<div className="about-row">
									<span className="k">{t('Version')}</span>
									<span>{APP_VERSION}</span>
								</div>
								<div className="about-row">
									<span className="k">{t('License')}</span>
									<span>MIT</span>
								</div>
								<div className="about-row">
									<span className="k">{t('Copyright')}</span>
									<span>© 2026 cuculhart</span>
								</div>
								<div className="about-row">
									<span className="k">{t('Built with')}</span>
									<span>React Flow / Vite</span>
								</div>
							</div>
							<div className="modal-actions">
								<button onClick={() => setShowAbout(false)}>
									{t('Close')}
								</button>
							</div>
						</div>
					</div>
				)}
				{ganttDlg && (
					<GanttDialog
						cfg={ganttCfg}
						unit={unit}
						onOk={(c) => {
							setGanttCfg(c)
							setGanttDlg(false)
							setShowGantt(true)
						}}
						onClose={() => setGanttDlg(false)}
						t={t}
					/>
				)}

				{showGantt && !sched.cyclic && sched.errors.size === 0 && (
					<GanttView
						tasks={tasks}
						sched={sched}
						unit={unit}
						cfg={ganttCfg}
						onEdit={() => setGanttDlg(true)}
						onToggleHoliday={(s) =>
							setGanttCfg((c) => ({
								...c,
								holidays: c.holidays.includes(s)
									? c.holidays.filter((x) => x !== s)
									: [...c.holidays, s],
							}))
						}
						onClose={() => setShowGantt(false)}
						t={t}
					/>
				)}

				{showExport && (
					<div
						className="modal-back"
						onClick={() => {
							setShowExport(false)
							setExportText(null)
						}}
					>
						<div
							className="modal export"
							onClick={(e) => e.stopPropagation()}
						>
							<h2>{t('Export')}</h2>
							<div className="modal-sub">
								{t('Dates are baked in from the current schedule.')}
							</div>
							<div className="modal-actions">
								<button onClick={() => doExport('tsv')}>
									{t('Copy TSV (for spreadsheets)')}
								</button>
								<button onClick={() => doExport('mmd')}>
									{t('Copy Mermaid gantt')}
								</button>
								<button onClick={() => doExport('issue')}>
									{t('Copy TSV for issue tracker bulk add')}
								</button>
								<button onClick={() => doExport('csv')}>
									{t('Save CSV')}
								</button>
							</div>
							{exportText !== null && (
								<textarea
									className="export-out"
									readOnly
									value={exportText}
									onFocus={(e) => e.target.select()}
								/>
							)}
							<div className="modal-actions export-close">
								<button
									onClick={() => {
										setShowExport(false)
										setExportText(null)
									}}
								>
									{t('Close')}
								</button>
							</div>
						</div>
					</div>
				)}

				{showClear && (
					<div className="modal-back" onClick={() => setShowClear(false)}>
						<div className="modal" onClick={(e) => e.stopPropagation()}>
							<h2>{t('Clear the board?')}</h2>
							<div className="modal-sub">
								{t('This will delete all tasks.')}
							</div>
							<div className="modal-actions">
								<button
									className="danger"
									onClick={() => {
										commit([])
										setEditingParent(null)
										setSelectedIds(new Set())
										setShowClear(false)
									}}
								>
									{t('Clear all')}
								</button>
								<button onClick={() => setShowClear(false)}>
									{t('Cancel')}
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</BoardCtx.Provider>
	)
}

export function App() {
	return (
		<ReactFlowProvider>
			<Board />
		</ReactFlowProvider>
	)
}
