# kotodama

ホットキーで起動し、話すと現在フォーカス中アプリのカーソル位置にリアルタイム文字起こしを挿入する音声入力ツール。TypeScript + Electron 製。文字起こしは OpenAI Realtime API の `gpt-live-transcribe`（ストリーミングSTT）を使用する。

詳細な設計は [docs/rule.md](docs/rule.md) を参照。

## 必要要件

- Node.js 20 以上（開発は v25 で確認）
- OpenAI APIキー（`gpt-live-transcribe` は Tier 1 以上が必要。Free プランは非対応）
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

### 音声編集モード（選択テキストの書き換え）

テキストを選択した状態で録音を開始すると、話した内容が「入力」ではなく「編集指示」として扱われ、選択範囲がその指示どおりに書き換わる。専用のホットキーは無く、通常の録音操作（ホットキー / Control ダブルタップ）を共用する。

1. 任意のアプリでテキストを選択する。
2. 通常どおり録音を開始する。選択が検出されるとピルの上に「選択中: …」が表示される。
3. 「箇条書きにして」「英語に翻訳して」「もっと丁寧にして」などと話して録音を停止する。
4. `gpt-5.6-luna` で書き換えられた本文が貼り付けられ、選択範囲が置き換わる。

- 言い直した文そのものを話した場合は、その内容が新しい本文として採用される。
- 選択が無い / 6,000文字を超える場合は通常の音声入力にフォールバックする。
- 書き換えに失敗した場合は貼り付けを行わないため、選択範囲は壊れない。
- 選択の有無は録音開始時に Cmd/Ctrl+C を送って判定するため、通常の音声入力の開始も僅かに遅くなる。不要なら設定の「テキストを選択してから録音すると…」を OFF にする（既定 ON）。

## アーキテクチャ（セキュア構成）

- **main (Node.js)**: `globalShortcut` / Tray / OpenAI への WebSocket 接続（`ws` + `Authorization` ヘッダ）/ `clipboard` + nut.js での貼り付け / `safeStorage`。
- **renderer (Chromium, 隠しwindow)**: `getUserMedia` + `AudioWorklet` で PCM16(24kHz, mono) を生成し、IPC で main へ送る。APIキーは renderer に渡さない。
- 文字起こしモデルは `src/main/realtime.ts` の `SttAdapter` で抽象化しており、差し替え可能。

```
src/
├── main/        # index.ts, realtime.ts, text-injector.ts, selection.ts, voice-edit.ts, store.ts, permissions.ts
├── preload/     # index.ts (contextBridge)
├── renderer/    # index.html, src/{App.tsx, audio.ts, pcm-worklet.js, ...}
└── shared/      # ipc.ts (チャンネル名・型)
```

## macOS の権限（重要）

- **マイク**: 初回にダイアログで許可。`Info.plist` の `NSMicrophoneUsageDescription` は `electron-builder.yml` で設定済み。
- **アクセシビリティ**: 貼り付け（キー送出）に必須。未許可だと貼り付けが無反応になる（ハマり所No.1）。
  `システム設定 > プライバシーとセキュリティ > アクセシビリティ` で許可する（開発中は Electron / ターミナル）。

## アプリアイコン（Dock / Finder / .app）

配布ビルド用のアプリアイコンは `build/` に配置する（`electron-builder.yml` の `buildResources: build`）。

1. 推奨: **`build/icon.png`** … **1024×1024 px** の正方形 PNG 1枚
   - `npm run dist:mac` / `dist:win` 時に electron-builder が `.icns` / `.ico` を自動生成する
2. 個別配置も可: `build/icon.icns`（macOS）/ `build/icon.ico`（Windows）
3. デザインの目安:
   - フルカラー可（トレイアイコンとは別素材）
   - 32px 程度まで縮小しても形が分かるよう、太めのシルエット・余白を確保
   - macOS の角丸は OS 側がマスクするため、正方形キャンバスいっぱいに描いてよい

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

ネイティブモジュール（nut.js）を含むため、配布ビルドは対象OSのビルドホストで `npm run rebuild` 済みであること。アプリアイコン（`build/icon.png`）とトレイアイコン（`resources/trayTemplate.png`）はリポジトリに同梱済み。差し替え時は上記の節を参照。

