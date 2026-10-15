import { useMemo, useState } from 'react'
import type { Schedule, Task } from './model'
import type { Unit } from './board-context'
import {
	calendarDays,
	wbsRows,
	type DayCol,
	type WbsRow,
} from './export'

export type GanttCfg = {
	/** baseline date YYYY-MM-DD (roots start here) */
	base: string
	/** unit='h' only: clock hour where a work day starts */
	startHour: number
	/** unit='h' only: working hours per day */
	hoursPerDay: number
	exSat: boolean
	exSun: boolean
	/** holiday dates YYYY-MM-DD, excluded like weekends */
	holidays: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function defaultGanttCfg(): GanttCfg {
	return {
		base: iso(new Date()),
		startHour: 9,
		hoursPerDay: 8,
		exSat: true,
		exSun: true,
		holidays: [],
	}
}

/** Coerce a persisted/imported gantt config into a valid one. */
export function sanitizeGanttCfg(raw: unknown): GanttCfg {
	const d = defaultGanttCfg()
	if (!raw || typeof raw !== 'object') return d
	const o = raw as Record<string, unknown>
	const clampNum = (v: unknown, lo: number, hi: number, fb: number) =>
		typeof v === 'number' && Number.isFinite(v)
			? Math.max(lo, Math.min(hi, Math.trunc(v)))
			: fb
	return {
		base:
			typeof o.base === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.base)
				? o.base
				: d.base,
		startHour: clampNum(o.startHour, 0, 23, d.startHour),
		hoursPerDay: clampNum(o.hoursPerDay, 1, 24, d.hoursPerDay),
		exSat: typeof o.exSat === 'boolean' ? o.exSat : d.exSat,
		exSun: typeof o.exSun === 'boolean' ? o.exSun : d.exSun,
		holidays: Array.isArray(o.holidays)
			? o.holidays.filter(
					(h): h is string =>
						typeof h === 'string' &&
						/^\d{4}-\d{2}-\d{2}$/.test(h),
				)
			: [],
	}
}

/* ---------------- settings dialog ---------------- */

export function GanttDialog({
	cfg,
	unit,
	onOk,
	onClose,
	t,
}: {
	cfg: GanttCfg
	unit: Unit
	onOk: (c: GanttCfg) => void
	onClose: () => void
	t: (en: string) => string
}) {
	const [d, setD] = useState<GanttCfg>(cfg)
	const set = (p: Partial<GanttCfg>) => setD((c) => ({ ...c, ...p }))
	return (
		<div className="modal-back" onClick={onClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<h2>{t('Gantt settings')}</h2>
				<div className="field">
					<label>{t('Baseline date')}</label>
					<input
						type="date"
						value={d.base}
						onChange={(e) => set({ base: e.target.value })}
					/>
				</div>
				{unit === 'h' && (
					<>
						<div className="field">
							<label>{t('Start hour')}</label>
							<input
								type="number"
								min={0}
								max={23}
								value={d.startHour}
								onChange={(e) =>
									set({
										startHour: Math.max(
											0,
											Math.min(23, Number(e.target.value) || 0),
										),
									})
								}
							/>
						</div>
						<div className="field">
							<label>{t('Hours per day')}</label>
							<input
								type="number"
								min={1}
								max={24}
								value={d.hoursPerDay}
								onChange={(e) =>
									set({
										hoursPerDay: Math.max(
											1,
											Math.min(24, Number(e.target.value) || 1),
										),
									})
								}
							/>
						</div>
					</>
				)}
				<div className="field check">
					<label>
						<input
							type="checkbox"
							checked={d.exSat}
							onChange={(e) => set({ exSat: e.target.checked })}
						/>{' '}
						{t('Exclude Saturday')}
					</label>
				</div>
				<div className="field check">
					<label>
						<input
							type="checkbox"
							checked={d.exSun}
							onChange={(e) => set({ exSun: e.target.checked })}
						/>{' '}
						{t('Exclude Sunday')}
					</label>
				</div>
				<div className="modal-actions">
					<button
						onClick={() => {
							if (unit === 'h' && d.startHour + d.hoursPerDay > 24) {
								window.alert(t('Start hour + hours per day must be <= 24'))
								return
							}
							onOk(d)
						}}
					>
						{t('OK')}
					</button>
					<button onClick={onClose}>{t('Cancel')}</button>
				</div>
			</div>
		</div>
	)
}

/* ---------------- gantt view ---------------- */

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function GanttView({
	tasks,
	sched,
	unit,
	cfg,
	onEdit,
	onToggleHoliday,
	onClose,
	t,
}: {
	tasks: Task[]
	sched: Schedule
	unit: Unit
	cfg: GanttCfg
	onEdit: () => void
	onToggleHoliday: (iso: string) => void
	onClose: () => void
	t: (en: string) => string
}) {
	const rows = useMemo<WbsRow[]>(() => wbsRows(tasks), [tasks])

	// calendar days from baseline until the needed working days are covered
	const days = useMemo<DayCol[]>(
		() => calendarDays(cfg, unit, sched.project),
		[cfg, unit, sched.project],
	)

	const H = unit === 'h' ? cfg.hoursPerDay : 1
	const colPx = unit === 'h' ? 16 : 30
	const colW = `${colPx}px`
	// 2D pagination (for print): a page holds as many day-columns as fit in
	// the printable width and as many task rows as fit in the height of
	// landscape A4 (~1060x730px printable at 96dpi)
	const daysPerPage = Math.max(1, Math.floor((1060 - 190) / (H * colPx)))
	const headRows = unit === 'h' ? 4 : 3
	const rowsPerPage = Math.max(
		1,
		Math.floor((730 - 42 - headRows * 20 - 62) / 19),
	)
	const dayChunks: DayCol[][] = []
	for (let i = 0; i < days.length; i += daysPerPage)
		dayChunks.push(days.slice(i, i + daysPerPage))
	const rowChunks: WbsRow[][] = []
	for (let i = 0; i < rows.length; i += rowsPerPage)
		rowChunks.push(rows.slice(i, i + rowsPerPage))
	const pages: { pgDays: DayCol[]; pgRows: WbsRow[] }[] = []
	for (const pgDays of dayChunks)
		for (const pgRows of rowChunks) pages.push({ pgDays, pgRows })

	// fill test: does working-unit interval [es, ef) overlap this column?
	const filled = (wdIdx: number, hIdx: number, excl: boolean, es: number, ef: number) => {
		if (excl) return false
		const gi = unit === 'h' ? wdIdx * H + hIdx : wdIdx
		return gi + 1 > es && gi < ef
	}

	// milestone position for zero-duration leaves
	const mile = (es: number) => es

	const span = (list: DayCol[], get: (d: DayCol) => number | string) => {
		const out: { label: string; n: number }[] = []
		for (const d of list) {
			const k = get(d)
			const last = out[out.length - 1]
			if (last && last.label === k) last.n += H
			else out.push({ label: String(k), n: H })
		}
		return out
	}

	const renderGrid = (
		{ pgDays, pgRows }: { pgDays: DayCol[]; pgRows: WbsRow[] },
		pi: number,
	) => {
		const years = span(pgDays, (d) => d.year)
		const months = span(pgDays, (d) => `${d.year}-${pad(d.month)}`)
		return (
			<div key={pi} className="gantt-page">
				<div
					className="gantt-grid"
					style={{
						gridTemplateColumns: `190px repeat(${pgDays.length * H}, ${colW})`,
					}}
				>
				{/* year row */}
				<div className="g-label g-head" />
				{years.map((y, i) => (
					<div key={i} className="g-h" style={{ gridColumn: `span ${y.n}` }}>
						{y.label}
					</div>
				))}
				{/* month row */}
				<div className="g-label g-head" />
				{months.map((m, i) => (
					<div key={i} className="g-h" style={{ gridColumn: `span ${m.n}` }}>
						{m.label}
					</div>
				))}
				{/* day row (clickable → holiday) */}
				<div className="g-label g-head" />
				{pgDays.map((d) => (
					<div
						key={d.iso}
						className={`g-h g-day${d.excl ? ' ex' : ''}${d.hol ? ' hol' : ''}`}
						style={{ gridColumn: `span ${H}` }}
						title={d.iso}
						onClick={() => onToggleHoliday(d.iso)}
					>
						{d.day}
						<span className="g-dow">{t(DOW[d.dow])}</span>
					</div>
				))}
				{/* hour row */}
				{unit === 'h' && (
					<>
						<div className="g-label g-head" />
						{pgDays.flatMap((d) =>
							Array.from({ length: H }, (_, h) => (
								<div
									key={`${d.iso}-${h}`}
									className={`g-h g-hour${d.excl ? ' ex' : ''}${d.hol ? ' hol' : ''}`}
								>
									{cfg.startHour + h}
								</div>
							)),
						)}
					</>
				)}
				{/* task rows */}
				{pgRows.map((r) => {
					const es = sched.es.get(r.task.id) ?? 0
					const ef = sched.ef.get(r.task.id) ?? 0
					const crit = sched.critical.has(r.task.id)
					const isMile = r.leaf && ef - es <= 0
					return [
						<div key={`l-${r.task.id}`} className="g-label">
							<span className="g-code">{r.code}</span>
							{r.task.name || 'task'}
						</div>,
						...pgDays.flatMap((d, di) =>
							Array.from({ length: H }, (_, h) => {
								const f = filled(d.wdIdx, h, d.excl, es, ef)
								const m =
									isMile &&
									!d.excl &&
									(unit === 'h'
										? d.wdIdx * H + h === mile(es)
										: d.wdIdx === mile(es))
								return (
									<div
										key={`${r.task.id}-${di}-${h}`}
										className={`g-c${d.excl ? ' ex' : ''}${d.hol ? ' hol' : ''}${f ? (r.leaf ? ' fill' : ' sum') : ''}${f && crit ? ' crit' : ''}`}
									>
										{m ? '◆' : ''}
									</div>
								)
							}),
						),
					]
				})}
				</div>
				<div className="g-page-no">
					{t('Page')} {pi + 1} / {pages.length}
				</div>
			</div>
		)
	}

	return (
		<div className="gantt-wrap">
			<div className="gantt-head">
				<strong className="gantt-brand">Plesfeda</strong>
				<strong>{t('Gantt chart')}</strong>
				<span className="gantt-sub">
					{t('Project')}: ⏱ {sched.project}
					{unit}
				</span>
				<span className="gantt-sub g-hint">
					{t('Click a day header to toggle holiday')}
				</span>
				<button onClick={onEdit}>{t('Settings')}</button>
				<button onClick={onClose}>{t('Close')}</button>
			</div>
			<div className="gantt-scroll">{pages.map(renderGrid)}</div>
		</div>
	)
}
