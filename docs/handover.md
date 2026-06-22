# kotodama 引き継ぎ資料（2026-06-17）

次の LLM / 開発者向け。設計の正本は [rule.md](./rule.md)。本書は**実装済みの現状・デバッグで判明した差分・未着手の改善**をまとめる。

---

## 1. プロジェクト概要

| 項目 | 内容 |
| --- | --- |
| **リポジトリ名** | `kotodama` |
| **目的** | ホットキーで録音トグル → 話す → **現在フォーカス中アプリのカーソル位置**に文字起こしを貼り付ける |
| **スタック** | TypeScript + Electron（electron-vite + React） |
| **STT モデル** | OpenAI Realtime API `gpt-realtime-whisper`（$0.017/分、Tier 1 以上必須） |
| **現状** | **MVP 動作確認済み**（macOS、開発モード `npm run dev`）。音声入力→文字起こし→貼り付けまで到達 |

**最新コミット（執筆時点）**: `219ed86` — 「とりあえず音声入力できるところまで進んだので一旦コミット」

---

## 2. 設計（rule.md）からの主な差分

rule.md のコード例は **Beta API 時代の記述**が残っている。実装は **GA Realtime API** に合わせてある。

| 項目 | rule.md（旧/参考） | 実装（現行） |
| --- | --- | --- |
| リポジトリ名 | `whisper-anywhere` | **`kotodama`** |
| WebSocket 接続 | renderer 直結 or subprotocol | **main で `ws` + `Authorization` ヘッダ**（セキュア構成） |
| `OpenAI-Beta` ヘッダ | `realtime=v1` を送る例あり | **送らない**（送ると Beta 廃止エラー） |
| `session.update` | フラット `input_audio_format` 等 | **ネスト `audio.input.format` / `audio.input.transcription`** |
| `turn_detection` | 言及少 | **`null` + 手動 `input_audio_buffer.commit`** |
| 音声取得 | renderer | renderer（**PCM を IPC で main へ**） |
| エラー表示 | なし | 端末ログ + 浮遊ピルに `message` 表示 |

---

## 3. アーキテクチャ（セキュア構成）

```
globalShortcut (main)
    → toggleRecording
    → ws 接続 (main/realtime.ts) ← Authorization: Bearer
    → recordingToggle IPC → worker renderer
        → getUserMedia + AudioWorklet → PCM16 24kHz mono
        → audio:pcm IPC → main → input_audio_buffer.append
    → delta/completed 受信
    → completed → text-injector (clipboard + nut.js Cmd/Ctrl+V)
```

### ウィンドウ構成

| ウィンドウ | 役割 | hash |
| --- | --- | --- |
| worker | 非表示。マイク取得・PCM 送信 | （なし） |
| overlay | 録音中の浮遊ピル（delta プレビュー） | `#overlay` |
| settings | API キー・delay・ホットキー設定 | `#settings` |

### 主要ファイル

```
src/
├── main/
│   ├── index.ts          # Tray, globalShortcut, 録音制御, IPC, teardownSession
│   ├── realtime.ts       # GptRealtimeWhisperAdapter (SttAdapter IF)
│   ├── text-injector.ts  # clipboard + @nut-tree-fork/nut-js
│   ├── store.ts          # safeStorage (APIキー), config.json
│   └── permissions.ts    # マイク / アクセシビリティ案内
├── preload/index.ts      # contextBridge → window.api
├── renderer/
│   ├── index.html        # CSP（blob/worker 許可済み）
│   └── src/
│       ├── App.tsx       # worker / settings / overlay ビュー
│       ├── audio.ts      # getUserMedia, AudioContext.resume()
│       └── pcm-worklet.js
└── shared/ipc.ts         # IPC チャンネル名・型・DEFAULT_CONFIG
```

---

## 4. 開発・実行

```bash
npm install
# electron バイナリ未 DL の場合:
node node_modules/electron/install.js
npm run dev
```

- **API キー**: トレイ →「設定…」→ OpenAI API キー保存（`~/Library/Application Support/kotodama/apikey.bin`、safeStorage 暗号化）
- **ホットキー既定**: `Cmd+Shift+R`（`CommandOrControl+Shift+R`）
- **main 変更後は必ず dev 再起動**（HMR は renderer のみ。main/preload は再起動要）

### macOS 権限（開発時）

| 権限 | 用途 | 開発中の許可対象 |
| --- | --- | --- |
| マイク | 音声取得 | **Electron**（システム設定 → プライバシー → マイク） |
| アクセシビリティ | Cmd+V キー送出 | **Electron**（または Terminal / Cursor） |

メニューバーのオレンジマイクが **Cursor** だけ点灯していても、**Electron** 側のマイク許可が別途必要なことがある。

### OpenAI 課金

- **Tier 1** と **Organization budget（例: $20/月）** は別物。
- **`Credit balance` が $0** だと `You exceeded your current quota` で即切断。Billing でクレジット追加が必要。
- Usage が $0 のまま = リクエストが課金対象まで到達していない（接続前エラー or 音声 0 バイト）。

---

## 5. デバッグで遭遇した問題と修正（再発防止）

実装・検証中に実際に起きた事象。同じエラーが出たらここを参照。

### 5-1. Beta API ヘッダ

- **症状**: 一瞬「聞き取り中」の後 `The Realtime Beta API is no longer supported`
- **原因**: `OpenAI-Beta: realtime=v1` を送っていた
- **修正**: `src/main/realtime.ts` からヘッダ削除。GA は `/v1/realtime` + `Authorization` のみ

### 5-2. quota / クレジット不足

- **症状**: `You exceeded your current quota`
- **原因**: Credit balance $0（Tier 1 でも残高ゼロは不可）
- **対処**: platform.openai.com → Billing → Add to credit balance

### 5-3. 音声 0 バイト（buffer too small）

- **症状**: `Expected at least 100ms of audio, but buffer only has 0.00ms`
- **原因（複合）**:
  1. **AudioContext が suspended** — 非表示ウィンドウで `resume()` 未実施 → `audio.ts` で `await ctx.resume()` 追加
  2. **CSP が blob AudioWorklet をブロック** — `index.html` の CSP に `script-src blob:`, `worker-src blob:` 等を追加
  3. **main プロセスが古いまま** — HMR 後も main 未再起動だと修正が効かない → **dev 完全再起動**

### 5-4. エラー内容が見えない

- **症状**: 浮遊ピルは「エラー」のみ、端末にも出ない
- **修正**:
  - `teardownSession` で `console.error('[kotodama] session error:', message)`
  - `unexpected-response` で HTTP 401 等の本文をパース（`realtime.ts`）
  - オーバーレイに `RecordingStatePayload.message` を表示
  - `audio:error` IPC で renderer のマイク/worklet 失敗を main へ転送

### 5-5. その他環境

- エージェントシェルに `ELECTRON_RUN_AS_NODE=1` があると `app.whenReady` が undefined — 通常ターミナルでは問題なし
- `electron install.js` 未実行だと Electron バイナリなしで起動失敗

---

## 6. ログの読み方（`npm run dev` 端末）

```
[kotodama] ready: ... apiKey=set|unset
[kotodama] connecting: model=..., lang=..., delay=...
[kotodama] committing: sent N bytes (~Xms of audio)   # 停止時。48000 byte/sec 目安
[kotodama] session error: ...                         # 失敗時の詳細
```

- **committing が出ない** → main が古い / 停止前に API 側エラーで切断
- **sent 0 bytes** → マイク/worklet/CSP/権限を疑う
- **sent が 4800 以上（≈100ms）** → 音声パイプは OK。以降は STT/貼り付け側

---

## 7. 実装済み機能（フェーズ1 + 一部フェーズ2）

- [x] electron-vite + React + TS 雛形
- [x] globalShortcut 録音トグル、Tray 常駐
- [x] main 側 Realtime WebSocket（GA session.update / append / commit）
- [x] SttAdapter 抽象化（`gpt-realtime-whisper`）
- [x] PCM16 24kHz mono（AudioWorklet）
- [x] safeStorage API キー、設定 UI（model / language / delay / hotkey）
- [x] text-injector（clipboard + nut.js、OS 分岐）
- [x] macOS 権限案内（マイク・アクセシビリティ）
- [x] 浮遊ピル overlay（delta 逐次プレビュー、エラー文言）
- [x] teardownSession（エラー/切断時の後始末統一）
- [x] electron-builder.yml（mac entitlements、NSMicrophoneUsageDescription）
- [ ] **配布ビルドの実機検証**（署名・公証・アイコンはプレースホルダ）— **macOS 実機 E2E 確認済**（2026-06-22）。Windows は [dist-verification-plan.md](./dist-verification-plan.md) フェーズ 2 待ち

---

## 8. 改善したい点（未着手・次の LLM 向け）

優先度はプロダクト判断に委ねる。ユーザー感覚では「動くが UX/品質はまだ粗い」段階。

### ユーザー要望（2026-06-17 追記 → 同日 実装済み）

プロダクトオーナーから挙がった改修候補4件。下表のとおり実装完了（実機での挙動確認は要ユーザー操作）。

| # | 要望 | 対応状況 | 実装内容 |
| --- | --- | --- | --- |
| 1 | **浮遊ピルをマウス位置付近に表示** | ✅ 実装済み | `src/main/index.ts` `showOverlay()` を `screen.getCursorScreenPoint()` + `getDisplayNearestPoint()` でカーソル近傍（少し下・右）に配置、`workArea` で clamp。**録音開始時のみ配置**（常時追従はしない） |
| 2 | **文脈を考慮した漢字変換** | ✅ 実装済み | 新モジュール `src/main/post-process.ts`。**ルール辞書補正（常時・オフライン）** ＋ **任意 LLM 補正（設定 ON/OFF）**。LLM は `gpt-5.4-nano`（Chat Completions、4s タイムアウト、失敗時はルール結果へフォールバック）。`onCompleted` で `injectText` 前に通す。設定 `llmCorrection`（既定 false）追加 |
| 3 | **起動コマンド（ホットキー）を任意に変更** | ✅ 実装済み | `App.tsx` 設定画面に「キーを録音」ボタン（**ウィンドウ全体で keydown 捕捉**→accelerator 変換、Esc でキャンセル）＋簡易バリデーション。`registerHotkey` が成否を返し、`setConfig` 結果（`SetConfigResult.hotkeyOk`）で UI 通知。登録失敗時は直前の有効ホットキーへ復帰。**Control 単独はグローバルホットキー不可**のため、別途「Control ダブルタップ起動」を `uiohook-napi`（`src/main/global-keys.ts`）で実装。設定 `doubleControl`（既定 true）。macOS は「入力監視/アクセシビリティ」権限が必要 |
| 4 | **入力文字が増えると途中から見えなくなる** | ✅ 実装済み | `styles.css` `.pill .partial` を折り返し＋ `-webkit-line-clamp: 4`。オーバーレイ窓を 460×200 に拡張、`.overlay` を左上寄せに変更（カーソル基準配置と整合） |

### 追加対応（2026-06-17 第2弾 実装済み）

| 項目 | 実装内容 |
| --- | --- |
| **設定: キャンセル / ESC** | `IPC.closeSettings` 追加（`preload`→`settingsWindow.close()`）。`SettingsView` に「キャンセル」ボタンと ESC ハンドラ。設定は Save までローカル state のみのため閉じれば破棄。キー録音中の ESC は録音キャンセル優先 |
| **設定: 初期値に戻す** | `SettingsView` の `onReset()` で `DEFAULT_CONFIG` へフォームを戻す（自動保存しない・APIキー対象外） |
| **録音中 ESC で中断** | `startRecording` で `globalShortcut.register('Escape', cancelRecording)`、`teardownSession` 冒頭で `unregister('Escape')`。`cancelRecording()` は `commit` を呼ばず `teardownSession('idle')`＝貼り付けなしの中断（best-effort 登録） |
| **起動/終了 効果音** | `WorkerView` の `onState` で前回 state を ref 保持し、`recording` 遷移で開始音 / 正常完了(`recording`\|`finalizing`→`idle`)で終了音を `playSE()` 再生。鳴らす直前に `getConfig()` で `soundEnabled`（既定 true）確認。音源は `src/renderer/public/sounds/{start,stop}.mp3`（ユーザー配置、未配置は無音）。エラー終了時は鳴らさない |
| **トレイアイコン差し替え** | `createTrayIcon()` が `resources/trayTemplate.png`(+@2x) を `nativeImage.createFromPath`＋`setTemplateImage(true)` で読込、空なら `createFallbackTrayIcon()`（従来の黒丸）。`electron-builder.yml` に `extraResources` で `resources/` 同梱。仕様は `resources/README.md` と `README.md` に記載 |

### UX

- **delta プレビューの精度**: 現状は delta を連結表示。確定前テキストの扱い（差分更新 vs 全文置換）は API イベント次第で要調整
- **push-to-talk**（押している間だけ録音）— rule.md §8 参照。globalShortcut だけでは難しい
- **設定画面**: API キー変更 UX、接続テストボタン、エラー履歴の表示
- **トレイアイコン**: `resources/trayTemplate.png` で差し替え可能（未配置時は従来の黒丸を実行時生成）。正式アイコン素材の用意は別途

### 技術

- **completed 方式のみ**: 停止時 commit → 一括貼り付け。話しながら逐次貼り付けは未実装
- **WebSocket 再接続**の明示的ポリシー（ネットワーク瞬断）
- **GA イベント名**: 接尾辞 `endsWith` で吸収中。公式ドキュメントと突合して固定名にしてもよい
- **Electron 42 / vite 7**: electron-vite 5 は vite 8 非対応。package.json は vite ^7 固定
- **README の `npm run rebuild`**: nut.js は N-API プリビルトで rebuild 不要な環境あり（"No native modules found" は正常なことも）

### rule.md 更新候補

- Beta ヘッダ・旧 session.update 例の削除 or 「GA では不可」注記
- セキュア構成（main ws）を正とするデータフロー図への差し替え
- CSP / AudioContext.resume の注意（非表示 renderer）

### 配布

- **配布ビルド実機検証**（進捗・手順・記録）: [dist-verification-plan.md](./dist-verification-plan.md) — macOS PASS / Windows 待ち
- **次工程（GHA + GitHub Releases）**: [release-ci-handover.md](./release-ci-handover.md) ← **次セッションはここから**
- **macOS UX（2026-06-22）**: 表示名 `Kotodama`。権限案内は [`permissions.ts`](../src/main/permissions.ts) + 設定「macOS 権限」
- 署名・公証・正式アイコンは未着手

---

## 9. Realtime API 接続メモ（実装の正）

```ts
// src/main/realtime.ts
const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
// headers: { Authorization: `Bearer ${apiKey}` } のみ（OpenAI-Beta なし）

// session.update（接続 open 直後）
{
  type: 'session.update',
  session: {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: {
          model: 'gpt-realtime-whisper',
          language: 'ja',  // 任意
          delay: 'minimal' // minimal|low|medium|high|xhigh
        },
        turn_detection: null
      }
    }
  }
}

// 送信: input_audio_buffer.append (base64 PCM16)
// 停止: input_audio_buffer.commit（100ms 未満はエラー）
// 受信: *input_audio_transcription.delta / *input_audio_transcription.completed
```

---

## 10. クイックスタート（次のセッション用）

1. [rule.md](./rule.md) — プロダクトゴール・背景
2. **本書** — 現状・落とし穴
3. **配布・CI 続き** → [release-ci-handover.md](./release-ci-handover.md)（GHA + GitHub Releases）
4. **実機検証記録** → [dist-verification-plan.md](./dist-verification-plan.md)
5. [README.md](../README.md) — コマンド一覧
6. 変更時の触りどころ:
   - 接続/STT → `src/main/realtime.ts`
   - 録音ライフサイクル → `src/main/index.ts`（`startRecording` / `stopRecording` / `teardownSession`）
   - 音声 → `src/renderer/src/audio.ts`, `pcm-worklet.js`
   - UI → `src/renderer/src/App.tsx`
   - IPC/型 → `src/shared/ipc.ts`

---

## 11. 参考リンク（GA）

- [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [Realtime and audio（Beta→GA migration）](https://developers.openai.com/api/docs/guides/realtime)
- [gpt-realtime-whisper](https://developers.openai.com/api/docs/models/gpt-realtime-whisper)
