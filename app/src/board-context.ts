import { createContext, useContext } from 'react'

export type Unit = 'h' | 'd'

export type BoardActions = {
	/** translate an English source string */
	t(en: string): string
	/** effort/duration unit: hours or days */
	unit: Unit
	rename(id: string, name: string): void
	setEffort(id: string, v: number): void
	toggleOpen(id: string): void
	/** activate the input slot of a parent (ghost → input + new ghost) */
	activateSlot(parentId: string): void
	/** confirm the input slot: create child, keep the input slot active */
	commitSlot(parentId: string, name: string): void
	/** leave the input slot: it falls back to a ghost */
	deactivateSlot(): void
	/** request deletion of a task (modal choice when it has children) */
	requestDelete(id: string): void
	/** task click while a dep-pick is armed (adds the dependency) */
	pickDep(id: string): void
}

export const BoardCtx = createContext<BoardActions | null>(null)

export function useBoard(): BoardActions {
	const ctx = useContext(BoardCtx)
	if (!ctx) throw new Error('BoardCtx missing')
	return ctx
}
