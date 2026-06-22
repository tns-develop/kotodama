# トレイアイコン(メニューバー)

macOS のメニューバー / Windows のタスクトレイに表示されるアイコンをここで差し替えます。

## 配置するファイル

| ファイル | サイズ | 用途 |
| --- | --- | --- |
| `trayTemplate.png` | 16x16 px | 通常解像度 |
| `trayTemplate@2x.png` | 32x32 px | Retina（任意。あると鮮明） |

ファイルを置くと自動的に使われます（未配置なら従来の黒丸を実行時生成）。

## macOS テンプレート画像の条件

- PNG / 背景は透過
- 図柄は **黒（+アルファ）のモノクロ**。色は無視され、メニューバーの明暗（ライト/ダーク）に応じて自動着色される
- 基本 16x16 px、Retina 用 `@2x` は 32x32 px（18x18 / 36x36 でも可）
- コード側で `setTemplateImage(true)` 済みのため、ファイル名末尾の `Template` は必須ではないが慣例として踏襲

## 仕組み

`src/main/index.ts` の `createTrayIcon()` が、`app.isPackaged ? process.resourcesPath : app.getAppPath()` を基点に `resources/trayTemplate.png` を読み込む。配布ビルドでは `electron-builder.yml` の `extraResources` で `resources/` が同梱される。
