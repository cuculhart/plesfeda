import { childrenOf, rollup, type Schedule, type Task } from './model'
import type { Unit } from './board-context'
import type { GanttCfg } from './gantt'

/* ------------------------------------------------------------------ */
/* Shared report groundwork                                            */
/*                                                                      */
/* The Gantt view and every export format stand on the same two walks:  */
/*   wbsRows       — DFS over the forest, deriving `1.2.3` codes        */
/*   calendarDays  — baseline → excluded-day skip → working-day index   */
/* Exports never carry the live model; ES/EF are baked into calendar    */
/* dates before they leave the app.                                     */
/* ------------------------------------------------------------------ */

export type WbsRow = {
	task: Task
	/** derived `1.2.3`-style number — positional, not stored */
	code: string
	/** root = 1 */
	level: number
	leaf: boolean
}

export function wbsRows(tasks: Task[]): WbsRow[] {
	const out: WbsRow[] = []
	const walk = (list: Task[], prefix: string, level: number) =>
		list.forEach((k, i) => {
			const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
			out.push({
				task: k,
				code,
				level,
				leaf: childrenOf(tasks, k.id).length === 0,
			})
			walk(childrenOf(tasks, k.id), code, level + 1)
		})
	walk(childrenOf(tasks, null), '', 1)
	return out
}

export type DayCol = {
	iso: string
	year: number
	month: number
	day: number
	dow: number
	excl: boolean
	hol: boolean
	/** index among working days only (excluded days share the count) */
	wdIdx: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) =>
	`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Calendar from the baseline until `spanUnits` working units are covered,
 * plus one trailing working day so boundary milestones (es == project)
 * still land on a real date.
 */
export function calendarDays(
	cfg: GanttCfg,
	unit: Unit,
	spanUnits: number,
): DayCol[] {
	const H = unit === 'h' ? cfg.hoursPerDay : 1
	const needWd = Math.max(5, Math.ceil(spanUnits / H)) + 1
	const out: DayCol[] = []
	const cur = new Date(`${cfg.base}T00:00:00`)
	let wd = 0
	while (wd < needWd && out.length < 400) {
		const s = iso(cur)
		const dow = cur.getDay()
		const hol = cfg.holidays.includes(s)
		const excl = (cfg.exSat && dow === 6) || (cfg.exSun && dow === 0) || hol
		out.push({
			iso: s,
			year: cur.getFullYear(),
			month: cur.getMonth() + 1,
			day: cur.getDate(),
			dow,
			excl,
			hol,
			wdIdx: wd,
		})
		if (!excl) wd++
		cur.setDate(cur.getDate() + 1)
	}
	return out
}

/** wdIdx → iso lookup */
function dayMap(cfg: GanttCfg, unit: Unit, spanUnits: number) {
	return new Map(
		calendarDays(cfg, unit, spanUnits).map((d) => [d.wdIdx, d.iso] as const),
	)
}

/** `frac` is a fractional working-hour count → "HH:MM" clock stamp */
function clock(cfg: GanttCfg, frac: number): string {
	const hh = cfg.startHour + Math.floor(frac)
	const mm = Math.min(59, Math.round((frac - Math.floor(frac)) * 60))
	return `${pad(hh)}:${pad(mm)}`
}

/** ES (work-unit index, interval start) → `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` */
function startStamp(
	days: Map<number, string>,
	cfg: GanttCfg,
	unit: Unit,
	u: number,
): string {
	if (unit === 'd') return days.get(Math.floor(u)) ?? ''
	const s = days.get(Math.floor(u / cfg.hoursPerDay)) ?? ''
	return s ? `${s} ${clock(cfg, u % cfg.hoursPerDay)}` : ''
}

/** EF (work-unit index, interval end) → same stamps as startStamp */
function finishStamp(
	days: Map<number, string>,
	cfg: GanttCfg,
	unit: Unit,
	es: number,
	ef: number,
): string {
	if (ef <= es) return startStamp(days, cfg, unit, es)
	if (unit === 'd') return days.get(Math.max(0, Math.ceil(ef) - 1)) ?? ''
	const H = cfg.hoursPerDay
	if (ef % H === 0) {
		const s = days.get(ef / H - 1) ?? ''
		return s ? `${s} ${pad(cfg.startHour + H)}:00` : ''
	}
	const s = days.get(Math.floor(ef / H)) ?? ''
	return s ? `${s} ${clock(cfg, ef % H)}` : ''
}

/* ---------------- tabular export ---------------- */

const HEADER = [
	'WBS',
	'Name',
	'Level',
	'Type',
	'Effort',
	'Start',
	'Finish',
	'Predecessors',
	'Critical',
	// empty tracking columns — the pasted sheet doubles as an
	// actuals tracker (Plesfeda plans, the spreadsheet tracks)
	'Assignee',
	'Status',
	'Progress',
	'ActualStart',
	'ActualFinish',
]

export function exportRows(
	tasks: Task[],
	sched: Schedule,
	cfg: GanttCfg,
	unit: Unit,
): string[][] {
	const rows = wbsRows(tasks)
	const days = dayMap(cfg, unit, sched.project)
	const byId = new Map(rows.map((r) => [r.task.id, r] as const))
	return [
		HEADER,
		...rows.map(({ task, code, level, leaf }) => {
			const es = sched.es.get(task.id) ?? 0
			const ef = sched.ef.get(task.id) ?? 0
			return [
				code,
				task.name,
				String(level),
				leaf ? (task.effort === 0 ? 'Milestone' : 'Task') : 'Summary',
				String(leaf ? task.effort : rollup(tasks, task.id)),
				startStamp(days, cfg, unit, es),
				finishStamp(days, cfg, unit, es, ef),
				(task.deps ?? [])
					.map((d) => byId.get(d)?.code)
					.filter((c): c is string => !!c)
					.join(','),
				sched.critical.has(task.id) ? 'yes' : '',
				'',
				'',
				'',
				'',
				'',
			]
		}),
	]
}

/** 課題管理ツールの一括登録向け: 葉のみ・ヘッダなし・4列（件名/開始日/期限日/予定時間） */
export function issueRows(
	tasks: Task[],
	sched: Schedule,
	cfg: GanttCfg,
	unit: Unit,
): string[][] {
	return exportRows(tasks, sched, cfg, unit)
		.slice(1)
		.filter((r) => r[3] !== 'Summary')
		.map((r) => [
			`${r[0]} ${r[1]}`,
			r[5].slice(0, 10),
			r[6].slice(0, 10),
			unit === 'h' ? r[4] : String(Number(r[4]) * cfg.hoursPerDay),
		])
}

const csvCell = (v: string) =>
	/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v

/** RFC4180-ish CSV, UTF-8 BOM for Excel */
const BOM = String.fromCharCode(0xfeff)
export function toCsv(rows: string[][]): string {
	return BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function toTsv(rows: string[][]): string {
	return rows
		.map((r) => r.map((v) => v.replace(/[\t\r\n]/g, ' ')).join('\t'))
		.join('\n')
}

/* ---------------- mermaid ---------------- */

/**
 * Leaves become tasks under sections. A single-root forest puts the root
 * on `title` and sections its children; multiple roots get one section
 * each. `after` links use mermaid ids derived from WBS codes; a dep on a
 * parent expands to all leaves of that subtree ("after the whole
 * subtree" — same semantics as the board). Dates are baked, so only
 * dep-free tasks carry an explicit start; `after` tasks are rescheduled
 * by mermaid itself.
 */
export function toMermaid(
	tasks: Task[],
	sched: Schedule,
	cfg: GanttCfg,
	unit: Unit,
): string {
	const rows = wbsRows(tasks)
	const byId = new Map(rows.map((r) => [r.task.id, r] as const))
	const days = dayMap(cfg, unit, sched.project)
	const H = unit === 'h' ? cfg.hoursPerDay : 1
	const dateOf = (u: number) => days.get(Math.floor(u / H)) ?? cfg.base
	const mid = (code: string) => `t${code.replace(/\./g, '_')}`
	const depIds = (dep: string): string[] => {
		const r = byId.get(dep)
		if (!r) return []
		if (r.leaf) return [mid(r.code)]
		return rows
			.filter((x) => x.leaf && x.code.startsWith(`${r.code}.`))
			.map((x) => mid(x.code))
	}
	const clean = (s: string) => s.replace(/[:#\r\n]/g, ' ')
	const label = (r: WbsRow) => clean(`${r.code} ${r.task.name || 'task'}`)

	const roots = rows.filter((r) => r.level === 1)
	const lines = ['gantt']
	if (roots.length === 1)
		lines.push(`    title ${clean(roots[0].task.name || 'project')}`)
	lines.push('    dateFormat YYYY-MM-DD', '    axisFormat %b %d')
	const excludes = [
		...(cfg.exSat && cfg.exSun ? ['weekends'] : []),
		...cfg.holidays,
	]
	if (excludes.length) lines.push(`    excludes ${excludes.join(', ')}`)

	// a lone root reads better as title+child sections than as one big section
	const groups =
		roots.length === 1 && childrenOf(tasks, roots[0].task.id).length > 0
			? rows.filter((r) => r.level === 2)
			: roots
	for (const g of groups) {
		lines.push(`    section ${label(g)}`)
		for (const r of rows.filter(
			(x) =>
				x.leaf &&
				(x.code === g.code || x.code.startsWith(`${g.code}.`)),
		)) {
			const es = sched.es.get(r.task.id) ?? 0
			const meta: string[] = []
			if (sched.critical.has(r.task.id)) meta.push('crit')
			if (r.task.effort === 0) meta.push('milestone')
			meta.push(mid(r.code))
			const preds = [
				...new Set((r.task.deps ?? []).flatMap(depIds)),
			].filter((m) => m !== mid(r.code))
			const start = preds.length
				? `after ${preds.join(' ')}`
				: dateOf(es)
			const dur = `${r.task.effort}${unit}`
			lines.push(`    ${label(r)} :${meta.join(', ')}, ${start}, ${dur}`)
		}
	}
	return lines.join('\n')
}
