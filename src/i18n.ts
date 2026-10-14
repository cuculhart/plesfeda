export type Lang = 'en' | 'ja'

/**
 * English-first i18n: UI strings are written in English in the source.
 * Each locale is a translation table keyed by the English source string.
 * Untranslated keys fall back to the English source.
 */
const ja: Record<string, string> = {
	'Plesfeda': 'Plesfeda',
	'work breakdown structure editor': '作業分解構成図エディタ',
	'Settings': '設定',
	'Language': '言語',
	'About': 'このツールについて',
	'Close': '閉じる',
	'A board for building real Work Breakdown Structures — breakdown first, schedule later.':
		'本物の作業分解構成図を組み立てるためのボード — まず分解、日程はあと。',
	'Welsh “pleth” (weave) + Old Irish “feda” (woods; also the name of the Ogham letters)':
		'ウェールズ語 “pleth”（編む）+ 古アイルランド語 “feda”（木々／オガム文字の字母名）',
	'+ Task': '＋ Task',
	'Breakdown': '分解',
	'Delete': '削除',
	'Save': '保存',
	'Open': '開く',
	'Invalid file': '読み込めないファイルです',
	'Undo': '元に戻す',
	'Redo': 'やり直す',
	'Colors': '色',
	'Node color': 'ノード色',
	'Node border': 'ノード枠色',
	'Text color': '文字色',
	'Line color': '線色',
	'Reset colors': '色をリセット',
	'Version': 'バージョン',
	'License': 'ライセンス',
	'Copyright': '著作権',
	'Built with': 'Powered by',
	'Theme': 'テーマ',
	'Light': 'ライト',
	'Quiet': 'クワイエット',
	'Dark': 'ダーク',
	'System': 'システム',
	'Layout': 'レイアウト',
	'Vertical': '縦（上→下）',
	'Horizontal': '横（左→右）',
	'+ child': '＋ child',
	'Effort': '工数',
	'Σ children': '子の合計',
	'task': 'task',
	'Delete this task?': 'このタスクを削除しますか？',
	'Keep children as roots': '子を root に残す',
	'Delete subtree': '配下ごと削除',
	'Cancel': 'キャンセル',
	'Clear': 'クリア',
	'Clear the board?': 'ボードをクリアしますか？',
	'This will delete all tasks.': 'すべてのタスクを削除します。',
	'Clear all': 'すべて削除',
	'Drag onto a node to reparent; empty space = root':
		'ノードに重ねてドロップで親を変更・空白で root 化',
	'Depends on': '先行タスク',
	'Click a predecessor task — Esc to finish':
		'先行するタスクをクリック（Esc で終了）',
	'Dependency cycle detected': '依存関係が循環しています',
	'Invalid dependency (ancestor/descendant)':
		'祖先・子孫への依存は設定できません',
	'Delete this dependency?': 'この依存関係を削除しますか？',
	'Project': 'プロジェクト',
	'Unit': '単位',
	'Days': '日',
	'Hours': '時',
	'Gantt': 'ガント',
	'Gantt chart': 'ガントチャート',
	'Gantt settings': 'ガント設定',
	'Baseline date': '基準日',
	'Start hour': '開始時刻',
	'Hours per day': '1日の作業時間',
	'Exclude Saturday': '土曜を除外',
	'Exclude Sunday': '日曜を除外',
	'OK': 'OK',
	'Start hour + hours per day must be <= 24':
		'開始時刻＋作業時間は24以下にしてください',
	'Resolve dependency errors first':
		'依存関係のエラーを解消してください',
	'Click a day header to toggle holiday':
		'日ヘッダをクリックで休暇の切替',
	'Task': 'タスク',
	'Su': '日',
	'Mo': '月',
	'Tu': '火',
	'We': '水',
	'Th': '木',
	'Fr': '金',
	'Sa': '土',
	'Page': 'ページ',
}

export function makeT(lang: Lang) {
	return (en: string): string => (lang === 'ja' ? (ja[en] ?? en) : en)
}
