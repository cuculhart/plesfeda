import { useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useBoard } from '../board-context'
import type { SlotData, TaskData } from '../layout'

export function TaskNode({ data, selected }: NodeProps) {
	const { task, code, rollup, leaf, dir, span, critical, depErr } =
		data as TaskData
	const board = useBoard()
	const [edit, setEdit] = useState<'name' | 'effort' | null>(null)
	const shown = leaf ? task.effort : rollup
	const tgt = dir === 'h' ? Position.Left : Position.Top
	const src = dir === 'h' ? Position.Right : Position.Bottom

	return (
		<div
			className={`task-node${selected ? ' selected' : ''}${task.open ? ' open' : ''}${critical ? ' critical' : ''}${depErr ? ' dep-err' : ''}`}
			onDoubleClick={() => setEdit('name')}
		>
			<Handle type="target" position={tgt} className="wbs-handle" />
			<div className="task-code">{code}</div>
			{edit === 'name' ? (
				<input
					className="task-name-input nodrag nopan"
					autoFocus
					defaultValue={task.name}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === 'Escape') {
							const v = (e.target as HTMLInputElement).value.trim()
							if (e.key === 'Enter' && v) board.rename(task.id, v)
							setEdit(null)
						}
					}}
					onBlur={(e) => {
						const v = e.target.value.trim()
						if (v && v !== task.name) board.rename(task.id, v)
						setEdit(null)
					}}
				/>
			) : (
				<div className="task-name" title={task.name}>
					{task.name || '…'}
				</div>
			)}
			{edit === 'effort' && leaf ? (
				<input
					className="task-effort-input nodrag nopan"
					type="number"
					autoFocus
					defaultValue={task.effort}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === 'Escape') {
							if (e.key === 'Enter')
								board.setEffort(
									task.id,
									Number((e.target as HTMLInputElement).value) || 0,
								)
							setEdit(null)
						}
					}}
					onBlur={(e) => {
						board.setEffort(task.id, Number(e.target.value) || 0)
						setEdit(null)
					}}
				/>
			) : (
				<div
					className={`task-effort${leaf ? ' editable' : ' rolled'}`}
					title={board.t(leaf ? 'Effort' : 'Σ children')}
					onClick={(e) => {
						if (!leaf) return
						e.stopPropagation()
						setEdit('effort')
					}}
				>
					{leaf
						? shown !== 0
							? `${shown}${board.unit}`
							: ''
						: span !== null
							? `${rollup} · ${span}${board.unit}`
							: rollup !== 0
								? `${rollup}`
								: ''}
				</div>
			)}
			<button
				className="task-break nodrag nopan"
				title={board.t('Breakdown')}
				onClick={(e) => {
					e.stopPropagation()
					board.toggleOpen(task.id)
				}}
			>
				⌄
			</button>
			<button
				className="task-delete nodrag nopan"
				title={board.t('Delete')}
				onClick={(e) => {
					e.stopPropagation()
					board.requestDelete(task.id)
				}}
			>
				×
			</button>
			<Handle type="source" position={src} className="wbs-handle" />
		</div>
	)
}

export function SlotNode({ data }: NodeProps) {
	const { kind, parentId, dir } = data as SlotData
	const board = useBoard()
	const [val, setVal] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const tgt = dir === 'h' ? Position.Left : Position.Top

	useEffect(() => {
		if (kind === 'input') inputRef.current?.focus()
	}, [kind])

	if (kind === 'input') {
		return (
			<div
				className="slot-node input"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<Handle type="target" position={tgt} className="wbs-handle" />
				<input
					ref={inputRef}
					className="slot-input nodrag nopan"
					placeholder={board.t('task')}
					value={val}
					onChange={(e) => setVal(e.target.value)}
					onClick={(e) => {
						e.stopPropagation()
						inputRef.current?.focus()
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							const v = val.trim()
							if (v) {
								board.commitSlot(parentId, v)
								setVal('')
								requestAnimationFrame(() => inputRef.current?.focus())
							} else {
								board.deactivateSlot()
							}
						}
						if (e.key === 'Escape') board.deactivateSlot()
					}}
				/>
			</div>
		)
	}
	return (
		<div
			className="slot-node ghost nodrag nopan"
			onMouseDown={(e) => e.preventDefault()}
			onClick={(e) => {
				e.stopPropagation()
				board.activateSlot(parentId)
			}}
		>
			<Handle type="target" position={tgt} className="wbs-handle" />
			<span className="slot-label">{board.t('+ child')}</span>
		</div>
	)
}
