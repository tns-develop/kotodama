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

## トレイアイコン（メニューバー）の変更

メニューバー（macOS は画面上部）に表示されるアイコンは差し替え可能。

1. 以下のファイルを `resources/` に配置する（置くだけで自動的に使われ、未配置なら従来の黒丸を実行時生成）。
   - `resources/trayTemplate.png` … 16x16 px（通常解像度）
   - `resources/trayTemplate@2x.png` … 32x32 px（Retina 用、任意）
2. macOS テンプレート画像の条件:
   - PNG / 背景は透過
   - 図柄は **黒（+アルファ）のモノクロ**。色は無視され、メニューバーの明暗（ライト/ダーク）に応じて自動着色
   - 基本 16x16 px、`@2x` は 32x32 px（18x18 / 36x36 でも可）
   - コードで `setTemplateImage(true)` 済みのため命名の `Template` は必須ではないが踏襲推奨

仕組み・詳細は [resources/README.md](resources/README.md) を参照。配布ビルドでは `electron-builder.yml` の `extraResources` で `resources/` が同梱される。

## 効果音（SE）

録音の開始・終了時に効果音を鳴らせる（設定画面の「録音の開始・終了時に効果音を鳴らす」で ON/OFF、既定 ON）。

- `src/renderer/public/sounds/start.mp3`（開始）/ `stop.mp3`（終了）を配置する。詳細は [src/renderer/public/sounds/README.md](src/renderer/public/sounds/README.md)。
- 終了音は正常完了時のみ。ESC キャンセル・エラー時は鳴らない。

## ビルド・配布

```bash
npm run build      # 型チェック相当のビルド（electron-vite build）
npm run dist:mac   # .dmg / .app（要 Apple Developer 署名・公証）
npm run dist:win   # .exe (NSIS)
```

ネイティブモジュール（nut.js）を含むため、配布ビルドは対象OSのビルドホストで `npm run rebuild` 済みであること。トレイアイコンは現在プレースホルダ（実行時生成）のため、配布時は `build/` に正式アイコンを用意することを推奨。
