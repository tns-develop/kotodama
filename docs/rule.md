# 音声入力ツール自作ガイド（TypeScript + Electron / リアルタイム文字起こし・Windows / Mac 両対応・2026年6月版）

## このドキュメントの目的（最重要・最優先）

**音声入力を「可能な限りリアルタイム」かつ「可能な限り高精度」で文字に変換するアプリを自作する。** これがこのドキュメントが目指す唯一にして最上位のゴールである。

達成のための優先順位は次のとおり：

1. **【最優先】最も有力な音声変換LLM（音声→テキストモデル）を使う。** 変換の速さと正確さは、突き詰めればどのモデルを使うかでほぼ決まる。ここが品質の天井を決めるので、**モデル選定が最も重要**。本ガイドでは2026年6月時点で最有力の **OpenAI `gpt-realtime-whisper`（ストリーミング文字起こし）** を採用する。より優れたモデルが出たら差し替えられる設計にする。
2. **【次点】TypeScript + Electron で、使いやすいUIのアプリとして完成させる。** ホットキーで起動し、話すとカーソル位置に文字が入り、状態が見える——という「毎日使える」体験まで仕上げる。Win / Mac 両対応。
3. それ以外（エージェント連携・コマンド実行・翻訳など）は**すべて後回し**。リアルタイム高精度文字起こしという根幹が完成してから足す。

> 一言でいえば：**「最強の音声変換モデル × 使いやすいElectronアプリ」で、リアルタイム・高精度な音声入力を実現する。** 以降の章はすべてこの目的を実現するための手段である。

---

「ホットキーを押して話すと、いまフォーカスしているアプリのカーソル位置に**話しながら**文字が入っていく」タイプの音声入力ツール（superwhisper / Wispr Flow 系）を、**TypeScript + Electron で自作**するための調査・設計資料。Windows / macOS 両対応を前提とする。

### 実装リポジトリ（GitHub）

本ガイドに沿って作るアプリは、次のリポジトリ名で管理する。

| 項目 | 値 |
| --- | --- |
| **リポジトリ名** | `kotodama` |
| **スタック** | TypeScript + Electron |
| **由来** | 「言霊（ことだま）」より。hmkc1220 氏 V3「WhisperAnywhere」の発想を引き継ぐ |

`npm create` やディレクトリ構成（§2）もこの名前で統一する。リポジトリ作成例:

```bash
gh repo create kotodama --public --description "Realtime voice input with gpt-realtime-whisper (TypeScript + Electron)"
git clone git@github.com:<YOUR_ORG>/kotodama.git
```

このガイドは、Qiita / hmkc1220 氏の連作（音声入力ツール **Open Super Whisper** → V2 → **V3「WhisperAnywhere」**）と、2026年5月にOpenAIが発表した **リアルタイム音声モデル（Realtime API）** をふまえて構成している（モデル選定は2026年6月時点で再調査済み）。

### このガイドの結論を決めた「V3の知見」

著者は V1 / V2（Python + PyInstaller、MCP・エージェント連携あり）を作り込んだ末に、こう総括している：

> **エージェント機能やコマンド連携より、結局のところ「リアルタイムで高精度な文字起こし」が一番効く。**
> 技術スタックを **Python + PyInstaller → TypeScript + Electron** に変えたことで、過去に苦戦した **ホットキー・UI・配布まわりの摩擦が劇的に下がり**、`gpt-realtime-whisper` を使ったストリーミング文字起こしという本来やりたかったことに時間を集中できた。

本ガイドが TypeScript + Electron を主軸に置くのは、この実体験にもとづく。

参考:
- DXマガジン「新モデル『GPT-Realtime-2』登場」: https://dxmagazine.jp/news/2617ko66/
- Qiita / hmkc1220 記事一覧: https://qiita.com/hmkc1220
- OSS 実装 Open Super Whisper: https://github.com/TakanariShimbo/open-super-whisper / V2: https://github.com/TakanariShimbo/open-super-whisper-v2

> 注：参照記事・OpenAI公式ドキュメントは調査時点でボット経由アクセスが 403 で本文取得できず、本書は各記事スニペット・複数のニュース解説・公開実装・各ライブラリ公式仕様をもとに再構成している。**価格・APIイベント名・ライブラリ名など細部は実装前に必ず最新の公式ドキュメントで確認**すること。

---

## 0. 結論（先に答え）

- 文字起こしモデルは **`gpt-realtime-whisper`**（OpenAI Realtime API のストリーミングSTT、**$0.017/分**）。話す端から部分テキスト（delta）が返り、確定（completed）で確定する。遅延設定で「低遅延＝早く出る／高遅延＝精度向上」を選べる。**モデルは抽象化して差し替え可能**にし、より優れたモデルが出たら載せ替える。
- 実装スタックは **TypeScript + Electron**。理由は著者の知見どおり：
  - **ホットキー**：Electron の `globalShortcut` がクロスプラットフォームで素直。
  - **UI**：HTML/CSS/React で「録音中の浮遊ピル」等のオーバーレイUIが圧倒的に作りやすい。
  - **配布**：`electron-builder` がインストーラ・署名・公証(notarization)までまとめて面倒を見る。
  - **音声 & 通信**：`getUserMedia` と `WebSocket` がブラウザ標準APIとして一級市民。
- パイプラインは **「①`globalShortcut` でホットキー → ②renderer で `getUserMedia`→PCM16 → ③`WebSocket` で Realtime API へストリーム & delta/completed 受信 → ④main で clipboard + キーシミュレーションでカーソル位置へ挿入」**。
- **クロスプラットフォーム対応の本質は「OS権限」と「カーソルへのテキスト挿入」**。特に **macOS のアクセシビリティ権限**（キーストローク送出に必須）と**マイク権限**がハマりどころ。Electron でも本質は変わらない。
- カーソル位置への入力は Electron 単体では不可。**`clipboard` でコピー → ネイティブのキーシミュレーション（nut.js / robotjs）で Cmd/Ctrl+V** が安定。

---

## 1. リアルタイム音声モデル（OpenAI Realtime API、2026年5月発表）

OpenAI が 2026年5月に Realtime API へ投入した3モデル。2026年6月時点でもストリーミング STT の本命は **`gpt-realtime-whisper`** のまま（後継モデルは未発表）。音声入力ツールは「録音し終えてから文字起こし」ではなく「話しながら逐次テキスト化」へ作り替えられる。

| モデル | 役割 | 価格 | 自作音声入力での使いどころ |
| --- | --- | --- | --- |
| **gpt-realtime-whisper** | ストリーミングSTT | $0.017/分 | **本命**。話しながら逐次入力。遅延と精度を設定でトレードオフ |
| **gpt-realtime-translate** | ライブ翻訳（入力70言語超→出力13言語） | $0.034/分 | 日本語で話して英語入力など、入力時翻訳 |
| **gpt-realtime-2** | 推論つき音声エージェント（コンテキスト128K） | $32 / 1M入力トークン, $64 / 1M出力トークン | 「声で操作(voice-to-action)」等の発展 |

V3 の知見の通り、まずは **gpt-realtime-whisper による文字起こしの質と速度** に集中するのが正解。translate / realtime-2 はモデル/セッション種別を差し替えれば後から足せる。

---

## 2. 全体アーキテクチャ（Electron）

Electron は **main プロセス（Node.js）** と **renderer プロセス（Chromium）** に分かれる。役割分担が肝。

```
┌──────────────────────── main プロセス (Node.js) ────────────────────────┐
│  app / Tray（トレイ・メニューバー常駐）                                    │
│  globalShortcut.register("CommandOrControl+Shift+R", toggle)            │
│  ipcMain：renderer から「確定テキスト」を受け取る                          │
│  text-injector：clipboard.writeText → nut.js で Cmd/Ctrl+V              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ IPC (toggle開始/停止, 確定テキスト)
┌──────────────────────────────┴──── renderer (Chromium, 隠しwindow) ─────┐
│  getUserMedia({audio}) → AudioWorklet で Float32→PCM16(24kHz, mono)     │
│  WebSocket: wss://api.openai.com/v1/realtime?intent=transcription      │
│    送信: input_audio_buffer.append (base64 PCM16)                       │
│    受信: ...input_audio_transcription.delta / .completed               │
│  確定テキストを ipcRenderer で main へ送る                                │
│  （任意）録音中インジケータの浮遊UIを描画                                   │
└────────────────────────────────────────────────────────────────────────┘
```

**逐次入力の設計**：まずは `completed`（確定文）が来たらまとめて挿入する方式から始めると単純。慣れたら `delta`（部分テキスト）で浮遊UIにプレビュー表示 → 確定時に本入力、という体験へ拡張する。

### 推奨ディレクトリ構成

```
kotodama/
├── package.json
├── tsconfig.json
├── electron-builder.yml          # 配布設定（mac/win）
├── src/
│   ├── main/
│   │   ├── main.ts               # app, Tray, globalShortcut, ipcMain
│   │   ├── text-injector.ts      # clipboard + nut.js でカーソルへ挿入
│   │   └── store.ts              # APIキー等の保存(safeStorage)
│   ├── preload/
│   │   └── preload.ts            # contextBridge で安全にIPC公開
│   └── renderer/
│       ├── index.html
│       ├── audio.ts              # getUserMedia → PCM16
│       ├── realtime.ts           # WebSocket で Realtime API
│       └── pcm-worklet.ts        # AudioWorklet (Float32→Int16)
└── build/                        # アイコン・entitlements 等
```

---

## 3. 技術選定

### 3-1. 主要パッケージ

| 役割 | パッケージ | 備考 |
| --- | --- | --- |
| ランタイム/シェル | **electron** | main/renderer 構成 |
| 言語 | **typescript** | 型安全。`electron-vite` 等のテンプレが楽 |
| ビルド/配布 | **electron-builder** | `.exe`(NSIS) / `.dmg`/`.app` 生成・署名・公証 |
| ホットキー | Electron 標準 **globalShortcut** | 追加依存不要、クロスプラットフォーム |
| マイク取得 | ブラウザ標準 **getUserMedia + AudioWorklet** | renderer 側。追加依存不要 |
| Realtime接続 | ブラウザ標準 **WebSocket** | renderer 側。サーバー用途なら `ws` |
| カーソルへ挿入 | **nut.js**（`@nut-tree-fork/nut-js`）または **robotjs** | キーストローク送出。ネイティブモジュール |
| クリップボード | Electron 標準 **clipboard** | 貼り付け方式に使用 |
| APIキー保存 | Electron 標準 **safeStorage** | OSの資格情報基盤で暗号化保存 |

> ネイティブモジュール（nut.js / robotjs）は **Electron の Node ABI に合わせて再ビルド**が必要。`electron-rebuild`（`@electron/rebuild`）を使う。robotjs は新しめの Node/Electron でビルドに難があることがあり、メンテの観点では nut.js 系が無難。

### 3-2. なぜ Python+PyInstaller から Electron+TS へ（V3の乗り換え理由）

| 摩擦点 | Python + PyInstaller（V1/V2） | TypeScript + Electron（V3） |
| --- | --- | --- |
| グローバルホットキー | `pynput` 等。OS差・権限でハマりやすい | `globalShortcut` が標準で素直 |
| UI（浮遊ピル・設定画面） | PyQt6 等。凝るほど大変 | HTML/CSS/React で容易・高自由度 |
| 配布・インストーラ | PyInstaller は署名/公証/インストーラを別途整備 | `electron-builder` が一括対応 |
| 音声・WebSocket | ライブラリ選定と連携が必要 | `getUserMedia`/`WebSocket` が標準API |
| トレードオフ | 実行ファイルは比較的軽量 | Chromium同梱でサイズ大・メモリ増 |

→ 「文字起こしの質と速度に集中したい」なら、周辺の摩擦が小さい Electron が有利、というのが V3 の結論。

### 3-3. 接続方式：WebSocket か WebRTC か

- デスクトップ常駐ツールは **WebSocket** が素直（renderer から直接接続、`input_audio_buffer.append` で base64 PCM16 を送る）。
- ブラウザ/モバイルから直接繋ぐ純Webアプリなら **WebRTC** 推奨。Electron の renderer は Chromium なので WebRTC も使えるが、本ガイドの用途では WebSocket で十分。

---

## 4. クロスプラットフォーム対応で押さえる差分

音声取得・WebSocket通信はOSをまたいでほぼ共通。**差が出るのは「OS権限」「テキスト挿入」「配布(署名/公証)」**。Electron でも本質は同じ。

| 項目 | Windows | macOS |
| --- | --- | --- |
| マイク権限 | 設定 > プライバシー > マイク | `Info.plist` に `NSMicrophoneUsageDescription`、初回ダイアログで許可 |
| キーストローク送出(挿入)の権限 | 基本そのまま動く | **「アクセシビリティ」権限が必須**（nut.js/robotjs のキー送出に必要） |
| ホットキー | `globalShortcut` で動く | 同左。ただし一部キーはアクセシビリティ前提 |
| ペーストキー | `Ctrl+V` | `Cmd+V` |
| 常駐表示 | システムトレイ | メニューバー |
| 配布物 | `.exe`(NSIS インストーラ) | `.dmg`/`.app`。**署名＋公証(notarization)** 必須級 |
| ネイティブ再ビルド | `electron-rebuild` | 同左 |

### macOS 特有の最重要ポイント

- **アクセシビリティ権限**：`clipboard` + キーシミュレーションで他アプリへ貼り付ける際に必須。`システム設定 > プライバシーとセキュリティ > アクセシビリティ` で対象アプリ（開発中は Terminal/Electron、配布後は自作アプリ）を許可。**最頻出のハマりどころ**なので、未許可時はアプリ内で案内する。
- **マイク権限**：`Info.plist` に用途文言が無いとクラッシュ/無音。`electron-builder` の `mac.extendInfo` 等で設定。
- **`.app` 配布**：自己署名だと「開発元を確認できません」警告。一般配布は Apple Developer 署名＋公証が必要（`electron-builder` が対応）。

OS分岐は `text-injector.ts` に閉じ込め、`process.platform`（`"darwin"`/`"win32"`）で切り替える。

---

## 5. 実装ステップ

### Step 0. プロジェクト作成

`electron-vite` 等の TS テンプレが楽。最小の依存:

```bash
npm create @quick-start/electron@latest kotodama   # TS + electron-vite テンプレ
cd kotodama
npm i
npm i @nut-tree-fork/nut-js          # キーストローク送出（または robotjs）
npm i -D @electron/rebuild
npx electron-rebuild                  # ネイティブモジュールを Electron 向けに再ビルド
```

- APIキーは `safeStorage` で暗号化保存（後述）。コードやビルドに**直書きしない**。

### Step 1. main プロセス：ホットキー・トレイ・IPC

```ts
// src/main/main.ts
import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain } from "electron";
import { injectText } from "./text-injector";

let win: BrowserWindow;   // renderer（隠しウィンドウ）

function createWindow() {
  win = new BrowserWindow({
    show: false,                  // UIは浮遊ピルのみ等。基本は隠し
    webPreferences: { preload: /* preload.js のパス */ "" },
  });
  win.loadFile("index.html");     // electron-vite では dev/prod でパスが変わる
}

app.whenReady().then(() => {
  createWindow();

  // トレイ常駐
  const tray = new Tray(/* icon path */ "");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "終了", click: () => app.quit() },
  ]));

  // グローバルホットキー（録音トグル）
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    win.webContents.send("toggle-recording");   // renderer に通知
  });

  // renderer から確定テキストを受けてカーソルに挿入
  ipcMain.on("transcript-completed", (_e, text: string) => {
    injectText(text);
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
```

### Step 2. preload：安全に IPC を公開

```ts
// src/preload/preload.ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  onToggle: (cb: () => void) => ipcRenderer.on("toggle-recording", () => cb()),
  sendCompleted: (text: string) => ipcRenderer.send("transcript-completed", text),
});
```

### Step 3. renderer：マイク取得 → PCM16

`getUserMedia` で24kHz指定が通らない環境では `AudioContext({sampleRate:24000})` 側で揃える。`AudioWorklet` で Float32 を Int16 PCM に変換。

```ts
// src/renderer/pcm-worklet.ts （AudioWorkletProcessor）
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (input) {
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;   // Float32 → Int16
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
```

```ts
// src/renderer/audio.ts
export async function startMic(onPcm: (buf: ArrayBuffer) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 24000 });
  await ctx.audioWorklet.addModule("pcm-worklet.js");
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-processor");
  node.port.onmessage = (e) => onPcm(e.data as ArrayBuffer);
  src.connect(node);
  return { stop: () => { node.disconnect(); src.disconnect(); ctx.close(); stream.getTracks().forEach(t => t.stop()); } };
}
```

### Step 4. renderer：Realtime API へ WebSocket 接続（文字起こし）

ストリーミング文字起こしは **transcription セッション**。接続後 `session.update` でモデルと音声フォーマットを設定し、音声を `input_audio_buffer.append`（base64 PCM16）で送り続け、`...input_audio_transcription.delta` / `.completed` を受信する。

```ts
// src/renderer/realtime.ts
const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

export function connectRealtime(apiKey: string, opts: {
  onDelta: (t: string) => void; onCompleted: (t: string) => void;
}) {
  // ブラウザ WebSocket は任意ヘッダ不可のため、subprotocol でキーを渡す方式を使う
  const ws = new WebSocket(WS_URL, [
    "realtime",
    `openai-insecure-api-key.${apiKey}`,   // 公式が案内するクライアント接続方式
    "openai-beta.realtime-v1",
  ]);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        input_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-realtime-whisper", language: "ja" },
      },
    }));
  };

  ws.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (e.type?.endsWith("input_audio_transcription.delta")) opts.onDelta(e.delta ?? "");
    else if (e.type?.endsWith("input_audio_transcription.completed")) opts.onCompleted(e.transcript ?? "");
  };

  const sendPcm = (buf: ArrayBuffer) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
  };
  return { sendPcm, close: () => ws.close() };
}
```

> **APIキーの扱いに注意**：renderer に生のキーを置くと露出リスクがある。堅くするなら **main プロセスで `ws`(Nodeの WebSocket) を使い、Authorization ヘッダで接続**し、PCM/テキストを IPC で受け渡す構成にする。個人利用ならクライアント接続方式でも可。イベント名・接続方式・ヘッダ仕様は更新され得るので**最新の公式 Realtime ガイドで要確認**。
> 翻訳入力にしたいなら `gpt-realtime-translate`、声で操作したいなら `gpt-realtime-2` にモデル/セッション種別を差し替える。

### Step 5. renderer：トグルで配線

```ts
// src/renderer/index.ts
import { startMic } from "./audio";
import { connectRealtime } from "./realtime";

let active: { stop(): void; close(): void } | null = null;

window.api.onToggle(async () => {
  if (active) { active.stop(); active.close(); active = null; return; }
  const apiKey = await /* preload 経由で safeStorage から取得 */ "";
  const rt = connectRealtime(apiKey, {
    onDelta: (_t) => { /* 浮遊UIにプレビュー（任意） */ },
    onCompleted: (t) => window.api.sendCompleted(t),   // main でカーソルに挿入
  });
  const mic = await startMic(rt.sendPcm);
  active = { stop: mic.stop, close: rt.close };
});
```

### Step 6. main：カーソル位置へ挿入（OS分岐の肝）

**clipboard にコピー → キーシミュレーションで Cmd/Ctrl+V** が日本語・長文に強く安定。

```ts
// src/main/text-injector.ts
import { clipboard } from "electron";
import { keyboard, Key } from "@nut-tree-fork/nut-js";

export async function injectText(text: string) {
  if (!text) return;
  clipboard.writeText(text);
  await new Promise((r) => setTimeout(r, 50));
  const mod = process.platform === "darwin" ? Key.LeftCmd : Key.LeftControl;  // Mac=Cmd / Win=Ctrl
  await keyboard.pressKey(mod, Key.V);
  await keyboard.releaseKey(mod, Key.V);
}
```

> 直接タイピング（`keyboard.type(text)`）は日本語IMEや対象アプリで取りこぼし・文字化けしやすい。基本はクリップボード貼り付け方式。

### Step 7. APIキーの保存（safeStorage）

```ts
// src/main/store.ts
import { safeStorage } from "electron";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

export function saveApiKey(path: string, key: string) {
  writeFileSync(path, safeStorage.encryptString(key));
}
export function loadApiKey(path: string): string | null {
  if (!existsSync(path)) return null;
  return safeStorage.decryptString(readFileSync(path));
}
```

---

## 6. 配布・ビルド（electron-builder）

**クロスビルドは原則 対象OS実機/CIで**（特に mac の署名・公証は macOS が必要）。

```yaml
# electron-builder.yml（抜粋）
appId: com.example.kotodama
mac:
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  extendInfo:
    NSMicrophoneUsageDescription: "音声入力のためマイクを使用します"
win:
  target: nsis
```

```bash
npm run build          # TS をコンパイル
npx electron-builder --mac    # .dmg / .app（要署名・公証）
npx electron-builder --win    # .exe (NSIS)
```

- **mac**：`hardenedRuntime` + entitlements（マイク・JIT等）を設定し、Apple Developer 署名＋公証(notarization)。`electron-builder` が `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` 等で公証まで実行可能。
- **win**：NSIS インストーラ。コード署名証明書があれば SmartScreen 警告を減らせる。
- **ネイティブモジュール**：nut.js/robotjs を含むため、ビルドホストで `electron-rebuild` 済みであること。
- **サイズ**：Chromium 同梱で数十〜100MB超。これは Electron のトレードオフ。

---

## 7. つまずきやすいポイント（チェックリスト）

- [ ] **macOS：アクセシビリティ権限**を許可したか（貼り付け＝キー送出が無反応の原因No.1）
- [ ] **マイク権限** / `NSMicrophoneUsageDescription` を設定したか（無音・クラッシュ）
- [ ] ネイティブモジュールを **`electron-rebuild`** したか（nut.js/robotjs が読み込めない）
- [ ] 音声は **PCM16 / mono / 24kHz** に揃えたか（AudioContext の sampleRate）
- [ ] WebSocket の **接続方式（subprotocol or ヘッダ）と session.update** は最新仕様に合っているか
- [ ] テキスト挿入は**クリップボード方式**、ペーストキーを**OS分岐**（Mac=Cmd+V/Win=Ctrl+V）したか
- [ ] APIキーを **renderer に直置きせず**、`safeStorage` で保存したか（理想は main で接続）
- [ ] WebSocket の**切断・再接続**を考慮したか
- [ ] 署名・公証は**対象OSで**実施したか（mac クロスビルド不可）

---

## 8. 発展（任意）

- **delta による逐次プレビュー**：部分テキストを浮遊ピルに薄字表示 → 確定で本入力。体感が大きく向上。
- **ライブ翻訳入力**：`gpt-realtime-translate` に切り替え、日本語で話して英語を入力。
- **声でアプリ操作(voice-to-action)**：`gpt-realtime-2` ＋ツール呼び出し/MCP で、文字起こしを「コマンド」として扱う（V2 が挑んだ方向）。ただし V3 の知見どおり、**まずは文字起こしの質と速度を最優先**。
- **後処理にLLM**：句読点付け・フィラー除去・固有名詞補正。カスタム語彙（辞書）も有効。
- **push-to-talk**：トグルではなく「押している間だけ録音」。`globalShortcut` は押しっぱなし検知が苦手なため、必要なら低レベルのキーフック（`uIOhook` 等）を検討。

---

## 9. 参考リンク

- DXマガジン記事: https://dxmagazine.jp/news/2617ko66/
- OpenAI「Advancing voice intelligence with new models in the API」: https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/
- OpenAI Realtime transcription ガイド: https://developers.openai.com/api/docs/guides/realtime-transcription
- OpenAI Realtime API（WebSocket）: https://developers.openai.com/api/docs/guides/realtime-websocket
- gpt-realtime-whisper モデル: https://developers.openai.com/api/docs/models/gpt-realtime-whisper
- Qiita / hmkc1220 記事一覧: https://qiita.com/hmkc1220
- Open Super Whisper（V1〜V2 / Python実装の参考）: https://github.com/TakanariShimbo/open-super-whisper
- Electron: https://www.electronjs.org/docs/latest / globalShortcut / safeStorage / electron-builder / nut.js 各公式ドキュメント

---

## 10. 実装引き継ぎ（2026-06-17）

MVP（音声入力→カーソル貼り付け）まで実装済み。**次の LLM / 開発者は [handover.md](./handover.md) を先に読むこと。**

本書（rule.md）は設計・調査資料。handover.md には以下を記載:

- rule.md からの GA 移行差分（Beta ヘッダ廃止、session.update ネスト構造、セキュア構成）
- 実際に遭遇した障害と修正（quota、音声 0 バイト、CSP、AudioContext.resume）
- ログの読み方、macOS 権限、未着手の改善項目
</content>
