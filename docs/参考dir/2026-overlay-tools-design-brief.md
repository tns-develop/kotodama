# テキスト注入オーバーレイ・ツール群 設計検討（追加タスク・2026年6月版）

ユーザーから「グローバルホットキー → 何らかの処理 → 元アプリへ注入」という共通の殻を持つ小型ツール群を、Mac/Windows 両対応で自作したい、という追加要望が来た。本書はその設計検討の出発点。前提・コア思想・既決事項は元ブリーフをそのまま採用し、本書は依頼の5項目に「選択肢＋推奨」を併記する形で回答する。

技術スタックは **Tauri + React + Ollama** を前提とする（既存音声入力ツールの Electron 構成とは独立。理由は §0 末尾に補足）。

---

## 0. 検討の前提（共通理解）

- 共通フロー: `hotkey → 入力取得 → 処理 → 出力（注入/クリップボード）→ 即閉じる`。
- 「最も難しく、最も再利用が効く」のは **出力＝注入レイヤー**。ここを最初に固める。
- 既決事項（再検討の出発点）:
  1. IME 候補の吸い出しはしない。OS の IME に任せ、LLM は「文の続き」を担当。
  2. 注入は **クリップボード方式**（保存→貼り付けエミュ→復元）。Accessibility/UIAutomation直挿しは初手で避ける。
  3. ローカル LLM 補完は **Tab/オンデマンド発火**。毎キー入力では撃たない。
- なぜ Tauri か（補足）: 既存音声入力アプリは Electron。Tauri は (1) バンドルが小さい（10MB台）、(2) Rust で OS API へ直接届く（注入レイヤーが書きやすい）、(3) 常駐・浮遊オーバーレイの軽量化が効く、という理由で本ツール群とは相性が良い。Electron との二本立てを許容するか後で統一するかは、**注入レイヤーが先に Rust で書けてしまうので Tauri を先行**させ、結果次第で判断する。

---

## 1. 共通殻のアーキテクチャ設計

### 1-1. プロセス・モジュール境界

Tauri は **Rust バックエンド（main）** と **WebView フロントエンド（React）** の2層。OS依存・性能要件のあるものは Rust、UI と編集状態は React、両者は Tauri コマンド/イベントで繋ぐ。

| レイヤー | 担当 | 実装場所 |
| --- | --- | --- |
| ホットキー登録／OSイベント | `tauri-plugin-global-shortcut` | Rust |
| オーバーレイ Window 制御（表示・最前面・透過・focus 奪取/復帰） | Tauri Window API | Rust |
| 元アプリのフォーカス記憶／復帰 | NSWorkspace(macOS) / GetForegroundWindow(Win) | Rust |
| 入力取得（選択テキスト・音声・画面） | OS別実装＋共通trait | Rust |
| 注入（クリップボード＋ペースト送出） | `arboard` + `enigo` 等 | Rust |
| 処理プラグイン（補完・翻訳・校正・文字起こし・スニペット） | trait Processor で抽象化 | Rust（呼び出しは React から） |
| エディタ / ゴーストテキスト / 結果表示 UI | React + 普通の `<textarea>`（IMEに任せる） | フロント |

### 1-2. 推奨ディレクトリ構成

```
overlay-tools/
├── package.json                    # フロント側
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                 # app, tray, plugin登録
│       ├── shell/
│       │   ├── hotkey.rs           # global shortcut 登録/解除
│       │   ├── overlay.rs          # オーバーレイ Window 生成・focus 制御
│       │   └── focus.rs            # 直前フォーカス先の記憶/復帰（OS別）
│       ├── input/
│       │   ├── mod.rs              # trait InputSource
│       │   ├── selection.rs        # 選択テキスト取得（Cmd/Ctrl+C 経由）
│       │   ├── audio.rs            # マイク取得（cpal）
│       │   └── screen.rs           # 画面キャプチャ
│       ├── inject/
│       │   ├── mod.rs              # trait TextInjector
│       │   ├── clipboard.rs        # 保存→書込→復元
│       │   └── paste.rs            # キー送出（OS別）
│       ├── processor/
│       │   ├── mod.rs              # trait Processor { process(ctx) }
│       │   ├── predictive.rs       # Ollama 呼び出し（補完）
│       │   ├── translate.rs        # 翻訳
│       │   ├── proofread.rs        # 校正
│       │   ├── transcribe.rs       # 文字起こし
│       │   └── snippet.rs          # スニペット展開
│       └── commands.rs             # invoke で React に公開
└── src/                            # React
    ├── App.tsx
    ├── tools/
    │   ├── PredictiveLauncher.tsx
    │   ├── TranslatePopup.tsx
    │   ├── ProofreadPopup.tsx
    │   ├── VoiceInput.tsx
    │   └── SnippetExpander.tsx
    └── shared/
        ├── useHotkey.ts            # invoke wrapper
        └── components/             # 共通UI（浮遊枠・ピル等）
```

### 1-3. 「処理プラグイン」の差し込み口（推奨）

Rust 側で trait を切り、ツールごとに実装を差し替える。React からは「どのツールを開いたか」だけを渡し、処理は中央で dispatch する。

```rust
// src-tauri/src/processor/mod.rs（抜粋）
pub enum Input {
    Empty,                    // 予測入力ランチャー（空エディタ）
    Selection(String),        // 翻訳/校正（選択テキスト）
    Audio(Vec<i16>),          // 音声入力
    Screen(image::DynamicImage), // スクショOCR
    Snippet(String),          // トリガー文字列
}

pub enum Output {
    Insert(String),     // 元アプリにそのまま挿入
    Replace(String),    // 選択範囲を置換（翻訳/校正）
    ClipboardOnly(String), // 注入せずクリップボードへ
}

#[async_trait::async_trait]
pub trait Processor: Send + Sync {
    fn id(&self) -> &'static str;
    async fn process(&self, input: Input) -> anyhow::Result<Output>;
}
```

### 1-4. オーバーレイ Window の作り方（選択肢）

- **A: 都度生成・都度破棄** — 呼び出すたびに `WindowBuilder` で新規生成し、閉じたら破棄。状態管理は単純だがコールド表示が遅め。
- **B: 隠し常駐＋show/hide** — 常駐させて hide/show する。表示は即時、ただし常駐リソースを食う。
- **【推奨】B**。ツール群が増えるとホットキー押下→即表示の体感が UX を左右するため、隠し常駐＋show/hide で遅延を最小化。常駐コストは Tauri なら小さい。

---

## 2. 注入レイヤーの具体設計

### 2-1. 共通フロー

```
1. 元アプリのフォーカス（pid/window）を記憶
2. オーバーレイを表示・focus 奪取
3. ユーザ操作 → 出力テキスト確定
4. オーバーレイを hide
5. 元アプリへ focus 復帰
6. clipboard 元値を退避（バックアップ）
7. clipboard に新テキスト書き込み
8. ペーストキー送出（Mac=⌘V / Win=Ctrl+V）
9. ペースト完了まで小さな wait
10. clipboard を元値に復元
```

### 2-2. macOS 実装

- **クリップボード**: `arboard` または Tauri 公式 `tauri-plugin-clipboard-manager`。
- **キー送出**: `enigo`（CGEvent ラッパ）または直接 `core-graphics::event` で `CGEventCreateKeyboardEvent(0x09 /*kVK_ANSI_V*/)` ＋ Command フラグ。
- **フォーカス記憶／復帰**: `NSWorkspace.frontmostApplication` で取得し、復帰は `NSRunningApplication.activate(options:)`。
- **権限**: アクセシビリティ権限必須。未許可時はガイドダイアログ＋設定画面誘導。

### 2-3. Windows 実装

- **クリップボード**: 同上 `arboard` か Tauri plugin。
- **キー送出**: `enigo` または `windows` crate の `SendInput`（`KEYBDINPUT` で `VK_CONTROL` + `VK_V`）。
- **フォーカス記憶／復帰**: `GetForegroundWindow` / `SetForegroundWindow`。フォーカスを他プロセスに渡すには **AttachThreadInput** トリックが必要なケースあり。
- **権限/UAC**: 自アプリが非昇格でも昇格アプリへは `SendInput` が届かないことがある。エラーハンドリングを準備。

### 2-4. クレート選定（推奨）

| 役割 | 第1候補 | 補欠 | 備考 |
| --- | --- | --- | --- |
| ホットキー | `tauri-plugin-global-shortcut` | `global-hotkey` | Tauri公式が一番手 |
| クリップボード | `arboard` | `tauri-plugin-clipboard-manager` | テキスト/画像両対応 |
| キー送出 | `enigo` | `rdev` | クロスプラットフォーム抽象が薄く、依存も小さい |
| 音声入力 | `cpal` | `rodio` | ストリーム録音に必要 |
| Ollama HTTP | `reqwest`（既存依存に） | — | `/api/generate` を叩く |

### 2-5. 既知の落とし穴と対策

| 落とし穴 | 対策 |
| --- | --- |
| **ペースト前にフォーカス復帰が完了していない** | フォーカス復帰後、`active_window == expected_pid` を 5〜10msポーリングで確認してから送出 |
| **復元が早すぎてペーストに古い値が入る** | 送出後 **80〜150ms** 待ってから復元。アプリ実機計測で調整 |
| **復元が遅すぎてユーザの手動コピーを上書きする** | 復元には**タイムスタンプガード**（保存→復元の間に clipboard が他プロセスで更新されたらスキップ） |
| **リッチテキスト/画像の喪失** | 元 clipboard を **複数MIMEごと**（text/plain, text/html, image/png, files）スナップショットし全て復元。`arboard` は image API もある |
| **昇格アプリ（Win）にペーストが届かない** | 失敗検知後 **「クリップボードに格納済み」フォールバック通知**（ユーザに手動貼り付けを促す） |
| **IME入力中の `Cmd+V` が無視される** | 送出前に `Escape` を1回送って確定／キャンセル、もしくは「IME中はペースト遅延」設定 |
| **Mac: アクセシビリティ権限なし** | 初回起動時に検出、設定画面を直接開くディープリンクを提示（`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`） |
| **ターミナルでの `Ctrl+V`** | 多くのターミナルは `Ctrl+Shift+V` 等、貼り付けバインドが異なる。**アプリ別ペーストキーマップ**を設定で持つ |

### 2-6. フォールバック設計（推奨）

注入を3段の段階フェイルセーフにする：

1. **第一段**: 通常のクリップボード＋ペースト送出。
2. **第二段（失敗検知時）**: クリップボードに残したまま、トースト通知「コピー完了。⌘V で貼り付けてください」。
3. **第三段（恒久退避）**: アプリ内履歴（直近10件）に保存し、後から呼び戻せるようにする。

「失敗検知」は厳密には難しいので、**送出から N ms 経っても元アプリの window 状態が変わらない場合**を実務上の目安にする。完全検知は諦め、**ユーザにトーストで気づかせる**設計に倒す。

---

## 3. 第一弾＝予測入力ランチャー MVP

### 3-1. 入れるもの（最小機能セット）

- グローバルホットキー（例: `Cmd/Ctrl+Shift+Space`）で**中央オーバーレイを表示**、`<textarea>` にフォーカス。
- ユーザは普通に IME で入力。
- **Tab キーで Ollama に補完リクエスト** → ゴーストテキスト（薄字）で末尾に表示。
- ゴースト表示中の挙動:
  - `Tab` or `→`: 採用（textarea に確定）
  - 何か別キー: ゴースト破棄
- `Enter`（修飾なし）: textarea の内容を**元アプリに注入して即閉じる**。
- `Esc`: 注入せず閉じる。
- 設定画面: Ollama モデル名・base URL・ホットキー・温度。
- 設定は `tauri-plugin-store` で JSON 保存。

### 3-2. 外すもの（v1 ではやらない）

- ストリーミング表示（`stream: false` で一括取得）。
- 履歴・お気に入り。
- 補完候補の複数提示／差し替えキー。
- 文体学習・コンテキスト保持。
- マークダウン整形。
- クラウド LLM 切替（後で `Processor` を増やすだけで済むので v1 では不要）。
- スクショ・音声・選択取得（別ツールに任せる）。

### 3-3. Ollama 呼び出し（最小実装）

```rust
// src-tauri/src/processor/predictive.rs（抜粋）
#[derive(serde::Serialize)]
struct OllamaReq<'a> { model: &'a str, prompt: &'a str, stream: bool }
#[derive(serde::Deserialize)]
struct OllamaResp { response: String }

pub async fn complete(model: &str, prompt: &str) -> anyhow::Result<String> {
    let body = OllamaReq { model, prompt, stream: false };
    let resp: OllamaResp = reqwest::Client::new()
        .post("http://127.0.0.1:11434/api/generate")
        .json(&body).send().await?.json().await?;
    Ok(resp.response)
}
```

呼び出し側（Tauri command）:

```rust
#[tauri::command]
async fn predict(prompt: String, model: String) -> Result<String, String> {
    predictive::complete(&model, &prompt).await.map_err(|e| e.to_string())
}
```

フロント（React）抜粋:

```tsx
async function onTab() {
  const ghost = await invoke<string>("predict", { prompt: text, model: settings.model });
  setGhost(ghost.trim());
}
function onEnter() {
  invoke("inject_text", { text: text + (accepted ? ghost : "") });
  // バックエンドが注入→hide
}
```

### 3-4. 補完の発火戦略（選択肢＋推奨）

- A: **Tab のみ**（オンデマンド）
- B: **入力停止 N ms（デフォルト 500ms）後に自動発火**
- C: **両方**（手動も自動も）

**【推奨】まず A**。最も予測しやすく、レイテンシ・コストを実測してから B を足すか判断。

### 3-5. UI の最小スケッチ

```
┌────────────────────────────────────────────────┐
│  [textarea]                                    │
│  今日のミーティングは|<ghost: 14時から開催します> │
│                                                │
│  Tab=採用  Enter=注入  Esc=閉じる   モデル: …  │
└────────────────────────────────────────────────┘
```

---

## 4. リスクと検証順序

「これが立たないとプロジェクトが死ぬ」順に並べる。

| 優先 | 不確実性 | 最小検証方法 | 合格基準 |
| --- | --- | --- | --- |
| **R1** | **注入の信頼性**（OS・アプリ差） | Tauri 最小サンプル＋`enigo` で、Mac/Win それぞれ **10アプリ × 5回ペースト**（Chrome, Safari/Edge, VSCode, Slack, Notion, Word, Terminal/PowerShell, メモ帳, X(Web), Gmail）。成功/失敗をログ | 8/10 アプリで 5/5 成功。ターミナル系は別マップで救済可なら可 |
| **R2** | **フォーカス記憶→復帰** | overlay 表示→閉じる→元アプリにフォーカスが戻るか。`GetForegroundWindow` / `NSWorkspace.frontmostApplication` で記録・復帰するだけのプロト | 復帰失敗率 < 5% |
| **R3** | **ホットキー競合・フルスクリーン挙動** | `Cmd/Ctrl+Shift+Space` 等候補を3つ用意、フルスクリーン動画・ゲーム・Zoom 共有中で発火 | いずれかの組合せで 100% 起動 |
| **R4** | **Ollama 補完レイテンシ** | `llama3.1:8b` / `qwen2.5:7b` 等で「200文字プロンプト→続き50文字」の time-to-complete を実測 | **800ms 以内**。超えるならモデル/量子化を変える or オンデマンド維持を堅持 |
| **R5** | **クリップボード復元の正しさ** | 画像 / RTF / 複数行テキスト をコピーした状態で注入サイクルを回し、復元結果を検証 | text は完全復元、画像は最低保持。失敗時はトーストで気づける |

R1 と R2 を **同じ最小プロト** に詰めるのが効率的。Tauri 雛形 + `tauri-plugin-global-shortcut` + `enigo` + `arboard` の4依存だけで作れる。**ここが立たないと Processor 側を作っても無駄になる**ので最優先。

---

## 5. 各ツールへの拡張時の差分（処理以外）

殻ができた後、各ツールに「処理ロジック以外で」追加実装が要る箇所。

| ツール | 追加実装が要る箇所 | 共通殻のまま |
| --- | --- | --- |
| **翻訳ポップアップ** | 入力: 選択テキスト取得（元アプリで `Cmd/Ctrl+C` を送出→`arboard` で取得→クリップボード復元）。UI: 結果ペイン＋「置換 or コピー」ボタン | ホットキー、注入、focus 制御 |
| **英文校正** | 翻訳とほぼ同じ。UI に **diff 表示**（追加: `diff` クレートまたは JS 側 `diff-match-patch`） | 同上 |
| **音声入力** | 入力: `cpal` でマイクストリーム、Whisper/Realtime API への WebSocket 接続（既存の `voice-input-tool` 実装と統合可）。UI: 録音中インジケータ・波形 | 注入、ホットキー |
| **スニペット展開** | 入力: トリガー文字列の**グローバル監視**が必要（`rdev` でキーログ→マッチで展開）。**IMEと競合しやすい**ため、`;trig` のような区切り起点＋確定キーで暴発を抑える | 注入のみ |
| **スクショOCR→翻訳** | 入力: 範囲選択キャプチャ（`xcap` / `screenshots` クレート）→ OCR（`tesseract-rs` or LLM Vision）→ 翻訳に合流 | 出力チェーン |

### 5-1. 共通殻が「処理以外で」拡張時に増やすべき抽象

- **入力ソース trait** を最初から切る（§1-3 の `Input` enum を `InputSource` trait に格上げ）。
  - `EmptyEditor`, `SelectionGrabber`, `MicCapturer`, `ScreenCapturer`, `SnippetWatcher`。
- **出力ポリシー**（`Insert` / `Replace` / `ClipboardOnly`）を Processor の戻り値に持たせ、注入レイヤーが分岐。
- **UI コンポーネントの規約**（例: トップに `<ToolHeader title hotkey />`、メイン領域は自由、底に `<ToolFooter actions />`）を決めておくと、各ツールの React 実装がほぼ「処理＋表示」のみで済む。

### 5-2. スニペット展開だけ特殊な点（注意）

スニペット展開はホットキー起点ではなく **全キー監視** が要る。これは Mac の入力監視権限・Win のキーボードフックという別世界に踏み込むため、**他4つが完成してから着手**を強く推奨。先に作るとデバッグの軸が増えすぎる。

---

## 6. 設計判断のサマリ（推奨）

| 論点 | 推奨 | 理由 |
| --- | --- | --- |
| スタック | Tauri + React + Ollama | バンドル小・Rustで注入実装が直接的・既存音声ツール（Electron）と独立できる |
| オーバーレイ Window | 隠し常駐＋show/hide | 体感速度を最優先 |
| 注入 | クリップボード＋送出＋3段フェイルセーフ | 移植性最大、失敗時もユーザに気付かせる |
| 注入クレート | `enigo` + `arboard`（+ Tauri plugin） | 抽象が薄く依存も小さい |
| 補完発火 | Tab のみ（オンデマンド）から開始 | レイテンシ/コストを実測してから自動発火を検討 |
| 第一弾 | 予測入力ランチャー MVP（§3-1の機能のみ） | 殻の全要素（hotkey/overlay/focus/inject）が要るため検証材料が最大 |
| 検証順 | R1 注入 → R2 focus → R3 hotkey → R4 latency → R5 復元 | プロジェクトを殺すリスクの大きい順 |
| スニペット展開 | 最後にやる | 全キー監視は別世界、他が固まってから |

---

## 7. 次のアクション（提案）

1. **R1+R2 最小プロト**を 2〜3 日で組む（Tauri 雛形 + global-shortcut + enigo + arboard + フォーカス記憶/復帰）。Mac/Win 両方で対象10アプリのペースト成否を計測。
2. プロト結果で「クリップボード方式の信頼性」を確定 → 通れば §1〜§3 の構造で本実装へ。詰まれば §2-5 のアプリ別ペーストキーマップ等で救済範囲を確定してから本実装。
3. 並行して **Ollama レイテンシ R4** をローカルで実測（モデル選定）。
4. 上記が立ったら **予測入力ランチャー MVP** を 1 週間で形にして実使用 → そこから次ツール（翻訳/校正）を Processor 追加で量産。

---

## 8. 未確定・要相談事項

設計判断が必要だが、決め打ちできない点：

- **Tauri バージョン**: v2 系を前提でよいか（プラグインの命名・API が v1 と異なる）。
- **Ollama 既定モデル**: `llama3.1:8b` / `qwen2.5:7b` / `gemma2:9b` 等、ユーザのハード性能で振る幅が大きい。デフォルトを決めるか、初回ウィザードで実測選定するか。
- **ホットキー初期割当**: `Cmd/Ctrl+Shift+Space` を本ツール群のランチャー親キーにする案。他ツールは親キー連打 or サブキーで切替（例: 親→`T` で翻訳）。これが好みでなければ別案。
- **既存音声入力アプリ（Electron）との統合方針**: (A) 別アプリのまま、(B) Tauri 版に移植して一本化、(C) Electron 側は廃止予定として Tauri 側に音声 Processor を新規実装。**推奨は (A) 並走 → 体感比較後に判断**。

これらは実装着手前に握っておきたい。

---

## 参考

- 既存音声入力ツール設計: `voice-input-tool/2026-self-made-voice-input-tool.md`
- Tauri: https://tauri.app/
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
- enigo / arboard / cpal / xcap / tesseract-rs 各 crates.io ドキュメント
