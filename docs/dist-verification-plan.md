# 配布ビルド実機検証（最小構成）

実行手順・チェックリスト・検証記録。背景は [handover.md](./handover.md) §5（落とし穴）・§8（配布）、設計は [rule.md §6](./rule.md)、コマンド概要は [README.md](../README.md)。

**成功基準**: macOS / Windows それぞれで、配布成果物から **ホットキー録音 → 文字起こし → カーソル位置への貼り付け** まで到達（必須 #1〜5）。

---

## フェーズ 0: 共通準備

各 OS のビルドホストで実施。

| OS | 必要環境 |
| --- | --- |
| macOS | Node.js 20+、Xcode Command Line Tools |
| Windows | Node.js 20+、Visual Studio Build Tools（C++） |

```bash
git clone <repo> && cd kotodama
npm install
node node_modules/electron/install.js   # Electron バイナリ未 DL 時のみ
npm run rebuild                         # nut.js（package.json 定義）
npx electron-rebuild -f -w uiohook-napi  # rebuild スクリプト対象外
```

> `npm run rebuild` は `@nut-tree-fork/nut-js` のみ。`uiohook-napi` は別途 rebuild が必要。

**API キー**: Tier 1 以上 + Credit balance > $0（[handover §5-2](./handover.md)）。起動後トレイ →「設定…」で保存。

**未署名ビルド**（署名・公証は後回し）:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
export CSC_IDENTITY="-"   # macOS のみ。Windows は AUTO_DISCOVERY=false のみ
```

macOS Gatekeeper 警告: `xattr -cr dist/mac*/Kotodama.app` または右クリック →「開く」。

---

## フェーズ 1: macOS

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
export CSC_IDENTITY="-"
npm run dist:mac
```

| 成果物 | パス（arch 依存） |
| --- | --- |
| アプリ | `dist/mac-arm64/Kotodama.app`（Apple Silicon）/ `dist/mac/Kotodama.app`（Intel） |
| インストーラ | `dist/Kotodama-<version>-<arch>.dmg` |

起動・ログ:

```bash
open dist/mac-arm64/Kotodama.app   # 環境に合わせてパスを読み替え
dist/mac-arm64/Kotodama.app/Contents/MacOS/Kotodama
```

**権限**: 配布ビルドでは **Kotodama.app** を許可（開発時の Electron とは別）。マイク / アクセシビリティ（Cmd+V）/ 入力監視（Control ダブルタップ、設定 `doubleControl` 既定 ON）。入力監視は一覧に無い場合「＋」で `.app` を追加（設定画面の「場所をコピー」可）。

チェックリスト（下記）を実施し、検証記録に記入。

---

## フェーズ 2: Windows

**推奨**: [release-ci-handover.md](./release-ci-handover.md) の GHA `windows-latest` で x64 ビルド → **GitHub Releases** からダウンロードして実機検証。

ローカル Windows ホストでも可。Mac からのクロスビルドは **win-arm64** になり、一般 PC（x64）向けにはならない。

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run dist:win
```

| 成果物 | パス |
| --- | --- |
| インストーラ | `dist/Kotodama Setup <version>.exe` |
| アンパック | `dist/win-<arch>-unpacked/Kotodama.exe` |

SmartScreen 警告は未署名のため想定内。貼り付けは Ctrl+V。macOS 専用の権限案内は [permissions.ts](../src/main/permissions.ts) のみ（Windows は OS 標準のマイク許可）。

チェックリストを実施（修飾キーは Ctrl）し、検証記録に記入。

---

## 共通チェックリスト

**必須 #1〜5** が成功基準。#6〜8 は可能なら確認。

| # | 項目 | 確認方法 | 重点モジュール |
| --- | --- | --- | --- |
| 1 | 起動・トレイ常駐 | メニューバー / 通知領域 | — |
| 2 | 設定・API キー | 保存後再起動で保持 | safeStorage |
| 3 | **E2E コア** | エディタ焦点 → ホットキー → 発話 → 停止 → 貼り付け | nut.js, ws, audio |
| 4 | 浮遊ピル | delta プレビュー | renderer |
| 5 | 音声パイプ | ログ `committing: sent N bytes`（N ≥ 4800） | AudioWorklet, CSP |
| 6 | ESC 中断 | 貼り付けなしで idle | — |
| 7 | Control ダブルタップ | 起動/停止（設定 ON 時） | uiohook-napi |
| 8 | 効果音 / LLM 補正 | 任意（未配置・OFF 既定でスキップ可） | post-process |

症状別の切り分けは [handover §5](./handover.md) を参照。

---

## 検証記録

再検証時は下表を上書きする。

### 環境

| 項目 | macOS | Windows |
| --- | --- | --- |
| 実施日 | 2026-06-22（E2E 確認済） | — |
| OS / arch | macOS 26.5.1 (arm64) | — |
| Node.js | v25.9.0 | — |
| コミット / ブランチ | `a893287`+ / `main` | — |
| 成果物 | `dist/Kotodama-0.1.0-arm64.dmg` | — |

### チェックリスト結果

| # | 項目 | macOS | Windows | メモ |
| --- | --- | --- | --- | --- |
| 1 | 起動・トレイ常駐 | **PASS** | — | |
| 2 | 設定・API キー | **PASS** | — | |
| 3 | E2E コア | **PASS** | — | ホットキー → STT → 貼り付け |
| 4 | 浮遊ピル | **PASS** | — | |
| 5 | 音声パイプ | **PASS** | — | |
| 6 | ESC 中断 | 未確認 | — | 任意 |
| 7 | Control ダブルタップ | **PASS** | — | 入力監視設定後 |
| 8 | 効果音 / LLM 補正 | スキップ | — | |

### ビルドパイプライン（2026-06-22 時点）

| 確認項目 | macOS | Windows |
| --- | --- | --- |
| `dist:*` ビルド成功 | OK | OK |
| ネイティブ `.node` asarUnpack | OK | OK |
| 未署名 Gatekeeper / SmartScreen | 想定内 | 想定内 |

### 総合判定

- [x] macOS 必須 #1〜5 PASS（2026-06-22 実機確認済）
- [ ] Windows 必須 #1〜5 PASS ← **次工程**
- [ ] 両 OS PASS → [handover.md:178](./handover.md) を `[x]` に更新

**スコープ外**（別タスク）: 署名・公証・正式アイコン → [release-ci-handover.md](./release-ci-handover.md)（CI / Releases は次工程）
