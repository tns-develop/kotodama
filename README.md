# kotodama

ホットキーで起動し、話すと現在フォーカス中アプリのカーソル位置にリアルタイム文字起こしを挿入する音声入力ツール。TypeScript + Electron 製。文字起こしは OpenAI Realtime API の `gpt-realtime-whisper`（ストリーミングSTT）を使用する。

詳細な設計は [docs/rule.md](docs/rule.md) を参照。

## 必要要件

- Node.js 20 以上（開発は v25 で確認）
- OpenAI APIキー（`gpt-realtime-whisper` は Tier 1 以上が必要。Free プランは非対応）
- macOS では「マイク」「アクセシビリティ」権限（後述）

## セットアップ

```bash
npm install
npm run rebuild   # nut.js(ネイティブモジュール)を Electron 向けに再ビルド
npm run dev       # 開発起動
```

初回起動後、トレイ（macOS はメニューバー）アイコンの「設定…」から OpenAI APIキーを保存する。
キーは `safeStorage` で暗号化して保存され、ソースやビルドには含まれない。

## 使い方

1. ホットキー（既定: `Cmd/Ctrl+Shift+R`）で録音開始。
2. 話す。録音中は画面下部に浮遊ピルが表示され、`delta` を逐次プレビューする。
3. もう一度ホットキーで停止。確定テキストがカーソル位置に貼り付けられる。

## アーキテクチャ（セキュア構成）

- **main (Node.js)**: `globalShortcut` / Tray / OpenAI への WebSocket 接続（`ws` + `Authorization` ヘッダ）/ `clipboard` + nut.js での貼り付け / `safeStorage`。
- **renderer (Chromium, 隠しwindow)**: `getUserMedia` + `AudioWorklet` で PCM16(24kHz, mono) を生成し、IPC で main へ送る。APIキーは renderer に渡さない。
- 文字起こしモデルは `src/main/realtime.ts` の `SttAdapter` で抽象化しており、差し替え可能。

```
src/
├── main/        # index.ts, realtime.ts, text-injector.ts, store.ts, permissions.ts
├── preload/     # index.ts (contextBridge)
├── renderer/    # index.html, src/{App.tsx, audio.ts, pcm-worklet.js, ...}
└── shared/      # ipc.ts (チャンネル名・型)
```

## macOS の権限（重要）

- **マイク**: 初回にダイアログで許可。`Info.plist` の `NSMicrophoneUsageDescription` は `electron-builder.yml` で設定済み。
- **アクセシビリティ**: 貼り付け（キー送出）に必須。未許可だと貼り付けが無反応になる（ハマり所No.1）。
  `システム設定 > プライバシーとセキュリティ > アクセシビリティ` で許可する（開発中は Electron / ターミナル）。

## ビルド・配布

```bash
npm run build      # 型チェック相当のビルド（electron-vite build）
npm run dist:mac   # .dmg / .app（要 Apple Developer 署名・公証）
npm run dist:win   # .exe (NSIS)
```

ネイティブモジュール（nut.js）を含むため、配布ビルドは対象OSのビルドホストで `npm run rebuild` 済みであること。トレイアイコンは現在プレースホルダ（実行時生成）のため、配布時は `build/` に正式アイコンを用意することを推奨。
