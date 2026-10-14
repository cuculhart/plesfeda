# Changelog

このファイルには Plesfeda（プレスフェダ）の主な変更をすべて記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に準拠します。

## [Unreleased]

## [0.1.0] - 2026-10-14

### 追加

- 初回公開。無限キャンバス上で WBS（作業分解構成図）を組み立てるボード
- Breakdown 入力（アクティブ枠＋ゴースト枠の連続子追加）
- ドラッグによる subtree ごとの親付け替え・循環拒否・WBS番号の自動採番
- 工数ロールアップ（葉は手入力、親は再帰合計）
- 先行タスク依存（finish-to-start）と PERT/CPM スケジュール、
  クリティカルパス強調、循環・祖先依存のエラー表示
- ガント出力（基準日・土日・休暇除外、マイルストーン、
  縦横2次元ページ分割の印刷対応）
- 多言語対応（JA/EN）、テーマ（Light/Quiet/Dark/System）、
  縦横レイアウト、工数単位（日/時）、ノード・線の色カスタム
- JSON 保存/読込・Undo/Redo・完全ローカル動作
