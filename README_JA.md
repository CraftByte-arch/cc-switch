<div align="center">

# CC Switch

### Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw、Hermes Agent、Pi、MiniMax Code のオールインワン管理ツール

**ワンクリックで API プロバイダを切り替え、MCP・Skills・プロンプトを一元管理。JSON / TOML / YAML の設定ファイルを手作業で編集する必要はもうありません。**

[![Version](https://img.shields.io/github/v/release/CraftByte-arch/cc-switch?color=blue&label=version)](https://github.com/CraftByte-arch/cc-switch/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/CraftByte-arch/cc-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Downloads](https://img.shields.io/github/downloads/CraftByte-arch/cc-switch/total)](https://github.com/CraftByte-arch/cc-switch/releases/latest)

### コミュニティフォーク：**[CraftByte-arch/cc-switch](https://github.com/CraftByte-arch/cc-switch)**

[English](README.md) | [中文](README_ZH.md) | 日本語 | [Deutsch](README_DE.md) | [Changelog](CHANGELOG.md)

**[ダウンロード](#ダウンロード--インストール) · [クイックスタート](#クイックスタート) · [特長](#特長) · [よくある質問](#よくある質問) · [ユーザーマニュアル](docs/user-manual/ja/README.md)**

</div>

> [!IMPORTANT]
> このリポジトリは[上流の CC Switch](https://github.com/farion1231/cc-switch)を基に、Codex のマルチプロバイダーモデルルーティングを追加したコミュニティフォークです。上流の公式リリースではなく、上流のスポンサーはこのフォークを支援または推奨していません。

## CC Switch を選ぶ理由

Claude Code、Codex、Gemini CLI などの AI コーディングツールは、それぞれ設定形式が異なります。API プロバイダを変えるたびに JSON、TOML、YAML、`.env` ファイルを手作業で編集しなければならず、MCP、Skills、プロンプトもツールごとに個別に管理する必要があります。

**CC Switch** は、こうした作業を 1 つのデスクトップアプリに集約します。プリセットを選んでキーを入力すれば、ワンクリックで切り替えられます。既存の設定が失われることもありません。

- **1 つのアプリで 10 のツール** — Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw、Hermes、Pi、MiniMax Code
- **手動編集は不要** — AWS Bedrock、NVIDIA NIM、コミュニティリレーなど 90 以上のプロバイダプリセットを内蔵
- **Claude Code で GPT を、Codex で Claude を使う** — ローカルルーティングを内蔵し、Anthropic、OpenAI、Gemini の API 形式を自動で変換。自動フェイルオーバーにも対応
- **MCP・Skills・プロンプトを一元管理** — MCP と Skills は一度追加すれば、ツールごとにチェックを入れて同期。プロンプトはツールごとに個別に管理
- **使用量とクォータをひと目で確認** — ローカルルーティングを使わなくてもトークン使用量と費用を集計。サブスクリプションのクォータと残高をプロバイダカードとトレイに直接表示
- **クロスプラットフォーム** — Tauri 2 で構築された Windows、macOS、Linux 対応のネイティブデスクトップアプリ

## スクリーンショット

|                  メイン画面                   |                  プロバイダ追加                  |
| :-------------------------------------------: | :----------------------------------------------: |
| ![メイン画面](assets/screenshots/main-ja.png) | ![プロバイダ追加](assets/screenshots/add-ja.png) |

## ダウンロード & インストール

### システム要件

- **Windows**: Windows 10 以上
- **macOS**: macOS 12 (Monterey) 以上
- **Linux**: x86_64 または ARM64、glibc 2.35 以上と WebKitGTK 4.1 が必要（例：Ubuntu 22.04+、Debian 12+、最近の Fedora）。RHEL / Rocky / Alma 8–9 は現在未対応

### Windows ユーザー

[Releases](../../releases) ページから最新版の `CC-Switch-v{version}-Windows.msi` インストーラー、またはポータブル版 `CC-Switch-v{version}-Windows-Portable.zip` をダウンロード。ARM 版 Windows では `CC-Switch-v{version}-Windows-arm64.msi` または `CC-Switch-v{version}-Windows-arm64-Portable.zip` をダウンロードしてください。

### macOS ユーザー

**方法 1: Homebrew でインストール（推奨）**

```bash
brew install --cask cc-switch
```

アップデート:

```bash
brew upgrade --cask cc-switch
```

**方法 2: 手動ダウンロード**

[Releases](../../releases) から `CC-Switch-v{version}-macOS.dmg`（推奨）または `.zip` をダウンロード。Apple Silicon と Intel Mac の両方でネイティブに動作する Universal ビルドです。

> **注意**: CC Switch の macOS 版は Apple によるコード署名と公証が完了しているため、そのままインストールして開けます。

### Arch Linux ユーザー

**paru でインストール（推奨）**

```bash
paru -S cc-switch-bin
```

### Linux ユーザー

[Releases](../../releases) から最新版の Linux ビルドをダウンロード：

- `CC-Switch-v{version}-Linux-x86_64.deb` / `-Linux-arm64.deb`（Debian/Ubuntu）
- `CC-Switch-v{version}-Linux-x86_64.rpm` / `-Linux-arm64.rpm`（WebKitGTK 4.1 を提供する Fedora などの RPM 系ディストリビューション）
- `CC-Switch-v{version}-Linux-x86_64.AppImage` / `-Linux-arm64.AppImage`（上記のシステム要件を満たすディストリビューション）

> **Flatpak**：公式リリースには含まれていません。`.deb` から自分でビルドできます — 手順は [`flatpak/README.md`](flatpak/README.md) を参照してください。

## クイックスタート

### 基本的な使い方

1. **プロバイダ追加**: ツールバーの「新しいプロバイダーを追加」（+ ボタン）をクリック → プリセットを選ぶかカスタム設定を作成
2. **プロバイダ切り替え**:
   - メイン UI: プロバイダを選択 → 「有効化」をクリック（OpenCode、OpenClaw、Hermes、MiniMax Code ではボタンが「追加」になります。この 4 つのツールと Pi は共存型のツールで、複数のプロバイダを同時に追加できます）
   - システムトレイ: プロバイダ名をクリック（Claude Code、Codex、Gemini CLI、Grok Build に対応）
3. **反映**: Claude Code は再起動不要。Codex、Gemini CLI、Grok Build はターミナルまたは CLI ツールを再起動、Claude Desktop はアプリ自体を再起動（詳しくはよくある質問を参照）
4. **公式ログインに戻す**: リストに含まれている公式プロバイダ（例：「Claude Official」）に切り替え、ツールを再起動してログイン/OAuth フローを実行
5. **ローカルルーティング（任意）**: Claude Code で OpenAI 形式や Gemini 形式のプロバイダを使う場合や、Codex で Claude を使う場合は、ローカルルーティングを有効にする必要があります。「設定 → ルーティング → ローカルルーティング」で「ルーティング総スイッチ」をオンにし、「ルーティング有効」で対象のツールをオンにしてください。メインページ上部から直接オン/オフしたい場合は、「メインページにルーティング切り替えを表示」をオンにします

### MCP、プロンプト、Skills、プロジェクト & セッション

- **MCP**: 「MCP 管理」ボタンをクリック → テンプレートまたはカスタム設定でサーバーを追加（または「既存をインポート」）→ ツールごとの同期をトグルで切り替え
- **プロンプト**: 「プロンプト」をクリック → Markdown エディタでプロンプトを作成 → 有効化すると、そのツールのプロンプトファイルに書き込み
- **Skills**: 「Skills」をクリック → 「スキルを発見」 → skills.sh を検索、または GitHub リポジトリを閲覧 → 対応ツールへワンクリックでインストール
- **プロジェクト**: Claude Code、Claude Desktop、Codex のページで、メインページ上部のプロジェクトスイッチャーを開く → 「新規プロジェクト」で現在の設定を保存。以降はスイッチャーから選ぶだけで設定一式を切り替え
- **セッション**: 「セッション管理」をクリック → 各ツールの会話履歴を閲覧・検索・復元

> **補足**: 初回起動時、CC Switch は Claude Code、Codex、Gemini CLI、Grok Build の既存設定を `default` という名前のプロバイダとして自動でインポートし、これらのツールと Claude Desktop に公式プロバイダを追加します。既存の設定が失われることはありません。

各機能の詳しい使い方については、**[ユーザーマニュアル](docs/user-manual/ja/README.md)** をご覧ください。プロバイダ管理、MCP/プロンプト/Skills、ローカルルーティングとフェイルオーバーなど、すべての機能を網羅しています。

## 特長

[完全な更新履歴](CHANGELOG.md) | [リリースノート](docs/release-notes/v3.20.4-ja.md)

### ツール別の対応機能

| ツール | プロバイダ | ローカルルーティング | トレイ切り替え | MCP | Skills | プロンプト | セッション | 使用量統計 |
| --- | --- | :---: | :---: | :---: | :---: | --- | :---: | :---: |
| Claude Code | 切り替え | ✓ | ✓ | ✓ | ✓ | CLAUDE.md | ✓ | ✓ |
| Claude Desktop | 切り替え | モデルマッピング時 | – | – | – | – | – | モデルマッピング時 |
| Codex | 切り替え | ✓ | ✓ | ✓ | ✓ | AGENTS.md | ✓ | ✓ |
| Gemini CLI | 切り替え | ✓ | ✓ | ✓ | ✓ | GEMINI.md | ✓ | ✓ |
| Grok Build | 切り替え | ✓ | ✓ | ✓ | ✓ | AGENTS.md | ✓ | ✓ |
| OpenCode | 共存 | – | – | ✓ | ✓ | AGENTS.md | ✓ | ✓ |
| OpenClaw | 共存 | – | – | – | – | ワークスペースエディタ | ✓ | – |
| Hermes | 共存 | – | – | ✓ | ✓ | メモリ | ✓ | – |
| Pi | 共存 | – | – | – | ✓ | AGENTS.md、SYSTEM.md、プロンプトテンプレート | ✓ | ✓ |
| MiniMax Code | 共存 | – | – | ✓ | ✓ | AGENTS.md | ✓ | ✓ |

- **切り替え**：同時に有効にできるプロバイダは 1 つだけです。**共存**：複数のプロバイダを同時にツール自身の設定に書き込み、ツール内で選んで使用します。
- **ローカルルーティング**：CC Switch がローカルでリクエストを転送し、API 形式を変換します。詳しくは下記の[ローカルルーティング & フェイルオーバー](#ローカルルーティング--フェイルオーバー)をご覧ください。Claude Desktop のプロバイダでは「直接接続」か「モデルマッピング」を選択でき、「モデルマッピング」を選ぶとローカルルーティング経由で転送されます。
- **セッション**：会話履歴を閲覧・検索し、再開コマンドをコピーして会話を続けられます（OpenClaw と Hermes のセッションは現在、再開に対応していません）。Hermes のセッションは、セッション管理で「すべて」を選ぶと表示されます。
- **使用量統計**：ローカルルーティングを使わない場合は、各ツールのローカルセッション記録から集計します。ローカルルーティングを経由したリクエストも集計に含まれます。
- Claude Desktop のページで開いた MCP、Skills、プロンプト、セッションの各パネルは、Claude Code に適用されます。

### プロバイダ管理

- **90 以上のプロバイダプリセット** — プリセットを選んでキーを入力するだけで追加。カスタム設定の作成も可能
- **主要フィールドだけを変更** — 切り替え時に置き換えるのはリクエスト先アドレス、キー、モデルなどの接続情報だけ。プラグイン、フック、MCP、自分で追加した設定やコメントはそのまま残ります
- **プロジェクト** — Claude Code または Codex の現在のプロバイダ、MCP、Skills、プロンプトファイルを 1 つのプロジェクトとして保存（Claude Desktop はプロバイダのみ保存）。以降はメインページ上部のプロジェクトスイッチャーやトレイから設定一式をワンクリックで切り替え。別のプロジェクトに切り替えると、現在の状態は自動的に元のプロジェクトへ保存
- **OAuth 認証センター（Beta）** — 「設定 → 認証」で GitHub Copilot、ChatGPT、xAI（Grok）の複数アカウントにログインし、サブスクリプションをプロバイダとして Claude Code、Claude Desktop、Codex で利用（Codex の OpenAI Official 以外はすべてローカルルーティングの有効化が必要）。公式クライアント以外でサブスクリプションを使用すると、ベンダーの利用規約に違反する可能性があります。リスクはご自身で判断してください
- **Claude Desktop でサードパーティを利用** — Anthropic 互換エンドポイントに直接接続可能。Claude 以外のモデルは「モデルマッピング」を選び、ローカルルーティング経由で Sonnet、Opus、Haiku などのティアをプロバイダの実際のモデルにマッピング
- **ユニバーサルプロバイダ** — 1 つの設定を Claude Code、Codex、Gemini CLI に同期
- ワンクリック切り替え、システムトレイからのクイック切り替え（Claude Code、Codex、Gemini CLI、Grok Build）、ドラッグ＆ドロップ並び替え、インポート/エクスポート

### ローカルルーティング & フェイルオーバー

- **API 形式の変換** — ローカルルーティングが Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Gemini Native の間でリクエスト形式を変換。Claude Code と Claude Desktop は OpenAI 形式や Gemini 形式のプロバイダを、Codex と Grok Build は Chat Completions 形式や Anthropic Messages 形式のプロバイダを利用可能
- **ツールごとに有効化** — Claude Code、Codex、Gemini CLI、Grok Build でそれぞれ個別にローカルルーティングを有効化可能。有効化すると、プロバイダの切り替えが以降のリクエストに即座に反映（切り替えでモデルが変わる場合、Codex、Gemini CLI、Grok Build は再起動が必要になることがあります）
- **自動フェイルオーバー** — ツールごとにフェイルオーバーキューを設定し、リクエストが失敗するとキューの順に次のプロバイダへ自動で切り替え。サーキットブレーカーとプロバイダのヘルスモニタリングと連携
- **整流器** — 一部の上流と互換性のないリクエストを自動で修正（Thinking 署名、画像非対応時のフォールバックなど）
- 公式プロバイダ（Claude Official など）はローカルルーティングを経由できません（Codex の OpenAI Official を除く）
- 使い方ガイド：[Claude Code で GPT を使う](docs/guides/claude-codex-routing-guide-ja.md) · [Codex で Claude を使う](docs/guides/codex-claude-routing-guide-ja.md)

### MCP、プロンプト & Skills

- **統一 MCP パネル** — すべての MCP サーバーを 1 か所で管理し、ツールごとにチェックを入れて同期。各ツールの既存設定からのインポート、Deep Link インポートに対応
- **プロンプト** — ツールごとに管理するプロンプトライブラリ（Markdown エディタ付き）。有効化すると、そのツールのプロンプトファイル（CLAUDE.md / AGENTS.md / GEMINI.md）に書き込み。有効化の前にファイル内の既存の内容をプロンプトライブラリへ保存するため、内容が失われることはありません。Pi では SYSTEM.md、APPEND_SYSTEM.md、プロンプトテンプレートも編集可能
- **Skills** — skills.sh を検索、または GitHub リポジトリや ZIP ファイルからワンクリックでインストール。更新の確認とワンクリックでの一括更新に対応。シンボリックリンクまたはファイルコピーで各ツールに同期し、保存場所として `~/.agents/skills` も選択可能
- 3 つのパネルはいずれも検索に対応。MCP と Skills はツールごとにワンクリックで一括有効化・一括無効化も可能

### 使用量 & コストトラッキング

- **使用量ダッシュボード** — ローカルルーティングを使わなくても集計可能。デフォルトで各ツールのローカルセッション記録を自動スキャンし、プロバイダとモデルごとにリクエスト数、トークン、キャッシュヒット率、費用を集計。トレンドチャートとリクエスト単位のログを提供
- **クォータと残高** — プロバイダカードとトレイに、公式サブスクリプションのクォータ（Claude、ChatGPT、Gemini、SuperGrok）、Coding Plan の 5 時間 / 週 / 月のクォータ（Kimi、Zhipu GLM、MiniMax、Volcengine Ark など）、アカウント残高（DeepSeek、OpenRouter、SiliconFlow など）を直接表示。一部はプロバイダカードの「利用状況を設定」で事前に有効化が必要。その他のプロバイダではカスタム使用量スクリプトを作成可能
- **カスタム価格設定** — モデルごとに単価を設定。models.dev からのインポートも可能

### セッション管理 & ワークスペース

- **セッション管理** — 各ツールの会話履歴を閲覧・検索し、再開コマンドをコピーして会話を継続。macOS ではワンクリックでターミナルから再開可能
- **ワークスペースエディタ**（OpenClaw）— エージェントファイル（AGENTS.md、SOUL.md など）とデイリーメモリーを編集
- **メモリ**（Hermes）— Hermes の MEMORY.md と USER.md を編集

### システム & プラットフォーム

- **クラウド同期** — WebDAV（坚果云、Nextcloud、Synology NAS など）または S3 互換ストレージ（AWS S3、Cloudflare R2、Alibaba Cloud OSS、Tencent Cloud COS など）で複数のデバイス間を同期。CC Switch の設定ディレクトリを Dropbox、OneDrive、iCloud などのクラウドストレージのフォルダに置くことも可能
- **CLI ツール管理** — 「バージョン情報」ページで Claude Code、Codex などのコマンドラインツールの現在のバージョンと最新バージョンを確認し、ワンクリックでインストール、アップグレード、一括アップグレード。重複インストールの診断にも対応。Windows では WSL 内のツールも管理可能（よくある質問を参照）
- **Deep Link**（`ccswitch://`）— リンクからプロバイダ、MCP サーバー、プロンプトをワンクリックでインポート、またはスキルリポジトリを追加
- **便利ツール** — Claude Code の初回確認のスキップ、AI 署名の非表示、VS Code の Claude Code 拡張を CC Switch のプロバイダ切り替えに追従させる機能など
- ダーク / ライト / システムテーマ、自動起動、自動アップデーター、アトミック書き込み、自動バックアップ、多言語対応（簡体中文/繁體中文/英/日）

## よくある質問

<details>
<summary><strong>CC Switch はどの AI ツールに対応していますか？</strong></summary>

CC Switch は **Claude Code**、**Claude Desktop**、**Codex**、**Gemini CLI**、**Grok Build**、**OpenCode**、**OpenClaw**、**Hermes**、**Pi**、**MiniMax Code** の 10 のツールに対応しています。各ツールに専用のプロバイダプリセットと設定管理が用意されています。ツールごとに対応している機能は[ツール別の対応機能](#ツール別の対応機能)をご覧ください。

</details>

<details>
<summary><strong>プロバイダを切り替えた後、ターミナルの再起動は必要ですか？</strong></summary>

ツールによって異なります：

- **Claude Code**：プロバイダデータのホットスイッチに対応しており、再起動は不要です。
- **Codex、Gemini CLI、Grok Build**：変更を反映するにはターミナルまたは CLI ツールを再起動してください（切り替え後に通知が表示されます）。ローカルルーティングを有効にしている場合、リクエストは即座に新しいプロバイダへ転送されますが、切り替えでモデルが変わる場合は、この 3 つのツールは再起動が必要になることがあります。
- **Claude Desktop**：Claude Desktop を完全に終了してから再度開いてください。「モデルマッピング」を使用する場合は、CC Switch を起動したままにしておく必要もあります。
- **OpenCode、OpenClaw、Hermes、Pi、MiniMax Code**：これらは共存型のツールです。「追加」（Pi では「有効化」）をクリックするとプロバイダがツール自身の設定に書き込まれ、他のプロバイダと共存します。その後、ツール内で使用するモデルを選んでください。

</details>

<details>
<summary><strong>プロバイダを切り替えると、プラグインやフックなどの設定も変わってしまいますか？</strong></summary>

変わりません。Claude Code、Codex、Gemini CLI、Grok Build でプロバイダを切り替えるとき、CC Switch が置き換えるのは設定ファイルの**主要フィールド**だけです。対象はリクエスト先アドレス、キー、モデル名、API プロトコル（Codex は推論レベル、Gemini CLI は認証方式も含む）と、プロバイダに合わせて切り替わる一部の互換オプション（Claude Code の「Artifact ツールを無効化」やコンテキストウィンドウなど）です。プラグイン、フック、権限、MCP、自分で追加した環境変数、コメント、書式はそのまま残り、すべてのプロバイダに適用されます。

これらの共有設定は、ツール内で変更しても、設定ファイルを直接編集しても構いません。CC Switch で任意のプロバイダを編集して変更することもできます。エディタには「このプロバイダに切り替えた後の設定ファイルの内容」が表示され、保存すると主要フィールドはそのプロバイダに保存され、それ以外の変更は設定ファイルに書き込まれてすべてのプロバイダに適用されます。

そのため、以前の「共通設定スニペット」は不要になり、関連するボタンは削除されました。アップグレード前にスニペットに入れていた設定は、切り替えの際にすでに設定ファイルへ書き込まれているので、そのまま残ります。また CC Switch は、各設定ファイルを初めて書き換える前に、元のファイルを `~/.cc-switch/backups/live-first-write/` にバックアップします。

</details>

<details>
<summary><strong>ツール内でモデルを変えたのに、別のプロバイダに切り替えて戻すと元に戻ってしまうのはなぜですか？</strong></summary>

モデルは主要フィールドで、プロバイダに属します。ツール内で変えたモデル（Claude Code の `/model` など）は次に切り替えるまで有効です。切り替えると、設定ファイルのモデルは切り替え先のプロバイダに保存されたものに置き換わり、ツール内で変えたモデルが元のプロバイダに保存し直されることはありません。特定のモデルを継続して使いたい場合は、CC Switch でそのプロバイダを編集してください。

以前のバージョンは、別のプロバイダへ切り替えるときに設定ファイル全体をプロバイダに保存し直していましたが、現在はそうしていません。その方式では、プラグインなどの共有設定が 1 つのプロバイダに固定されてしまい、別のプロバイダに切り替えると失われていたためです。

</details>

<details>
<summary><strong>現在アクティブなプロバイダを削除できないのはなぜですか？</strong></summary>

CC Switch は「最小限の介入」という設計原則に従っています。アプリをアンインストールしても、各ツールは正常に動作し続けます。

そのため、同時に 1 つのプロバイダのみ有効なツール（Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build）では、すべての設定を削除すると対応するツールが使用できなくなるため、システムは常にアクティブな設定を 1 つ保持します。OpenCode、OpenClaw、Hermes、Pi、MiniMax Code などの共存型ツールにはこの制限がなく、どのプロバイダでも直接削除できます。あまり使わないツールがある場合は、設定で非表示にできます。公式ログインに戻す方法は、次の質問をご覧ください。

</details>

<details>
<summary><strong>公式ログインに戻すにはどうすればよいですか？</strong></summary>

Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build のプロバイダリストには、公式プロバイダ（**Claude Official**、**Claude Desktop Official**、**OpenAI Official**、**Google Official**、**Grok Official**）があらかじめ含まれています。削除してしまった場合は、プリセットから追加し直してください。公式プロバイダに切り替えた後、ツール自身のログインフロー（Claude Code の `/login`、Codex の `codex login` など）を実行すれば、以降は公式プロバイダとサードパーティプロバイダを自由に切り替えられます。

Codex では、CC Switch 内の「ChatGPT でログイン」から複数の ChatGPT アカウントにログインし、**OpenAI Official** カードごとに「使用するアカウント」を選べるため、複数の Plus、Pro、Team アカウントをワンクリックで切り替えられます。「Codex のログインに追従」を選んだカードは、Codex CLI 自身のログインをそのまま使用します。

注意：ローカルルーティングを有効にしている間は、公式プロバイダに切り替えられません（Codex の OpenAI Official カードを除く）。

</details>

<details>
<summary><strong>ローカルルーティングを有効にすると、設定ファイルのアドレスが 127.0.0.1 に変わるのはなぜですか？</strong></summary>

ローカルルーティングを有効にすると、ツールのリクエストはまず CC Switch のローカルルーティング（デフォルトは `http://127.0.0.1:15721`）に送られ、そこから CC Switch が選択中のプロバイダへ転送します。そのため、ツールの設定ファイルにはローカルアドレスとプレースホルダーのキー `PROXY_MANAGED` だけが書き込まれます。Claude Code のモデル名も `claude-sonnet-5` のような固定のエイリアスになります（`/model` メニューには実際のモデル名が表示されます）。実際のプロバイダのアドレス、キー、モデルはすべて CC Switch に保存されています。

「設定 → 利用統計 → リクエストログ」では、各リクエストの「リクエストモデル → 実際のモデル」を確認できます。

ローカルルーティングを有効にしている間に切り替わるのは、ローカルルーティングが使うプロバイダです。有効にする前に使っていたプロバイダは変わらず、カードに「直接接続」と表示されます。ローカルルーティングを無効にすると、設定ファイルはこの直接接続のプロバイダの設定に書き戻されます。CC Switch を終了するときも先に直接接続のプロバイダを書き戻し、次回起動時にローカルルーティングへ接続し直します。

</details>

<details>
<summary><strong>Claude Code で OpenAI 互換 API、Gemini、ローカルモデルを使えますか？</strong></summary>

使えますが、ローカルルーティングを有効にする必要があります。プロバイダを編集する際に、「高級オプション」の「上流フォーマット」でプロバイダに合った API 形式を選んでください。Chat Completions API のみを提供するサービス（多くのローカルモデルサービスがこれに当たります）は「OpenAI Chat Completions」、Responses API を提供するサービスは「OpenAI Responses API」、Gemini は「Gemini Native generateContent」を選びます。その後、[クイックスタート](#クイックスタート)の手順 5 に従って Claude Code のローカルルーティングを有効にしてください。形式の選択を誤ったり、ローカルルーティングを有効にしていなかったりすると、通常は 404 または 405 エラーになります。

逆に、Codex や Grok Build の「上流フォーマット」で「Anthropic Messages」を選ぶと、Claude 形式のプロバイダを使えます。この場合もローカルルーティングの有効化が必要です。詳しくは [Claude Code で GPT を使う](docs/guides/claude-codex-routing-guide-ja.md) と [Codex で Claude を使う](docs/guides/codex-claude-routing-guide-ja.md) をご覧ください。

</details>

<details>
<summary><strong>「接続チェック」は成功したのに、リクエストが失敗するのはなぜですか？</strong></summary>

プロバイダカードの「接続チェック」は、プロバイダのアドレスに接続できるかどうかだけを確認し、実際のモデルリクエストは送信しません。そのため、API キーやモデル名が正しいかどうかは検証できません。リクエストが失敗する場合は、キー、モデル名、上流フォーマットを確認してください。ローカルルーティングを有効にしている場合は、「設定 → 利用統計 → リクエストログ」で具体的なエラー内容も確認できます。

</details>

<details>
<summary><strong>データはどこに保存されますか？</strong></summary>

デフォルトでは、すべてユーザーのホームディレクトリにある `.cc-switch` フォルダ（Windows では `C:\Users\<ユーザー名>\.cc-switch`）に保存されます：

- **データベース**: `cc-switch.db`（SQLite — プロバイダ、MCP、プロンプト、Skills、プロジェクト、使用量記録など）
- **ローカル設定**: `settings.json`（デバイスレベルの設定。各ツールの設定ディレクトリ、バックアップポリシー、クラウド同期の接続情報など）
- **バックアップ**: `backups/`（デフォルトでは 24 時間ごとに自動バックアップし、最新 10 件を保持。「設定 → 詳細 → バックアップと復元」で変更可能）
- **Skills**: `skills/`（設定で `~/.agents/skills` に変更可能）。デフォルトではシンボリックリンクで各ツールに同期し、失敗した場合はコピーに切り替え
- **Skill バックアップ**: `skill-backups/`（スキルのアンインストールまたは更新の前に自動作成、最新 20 件を保持）
- **OAuth ログイン認証情報**: `copilot_auth.json`、`codex_oauth_auth.json`、`xai_oauth_auth.json`
- **ログ**: `logs/cc-switch.log` と `crash.log`（問題を報告する際は添付してください）
- **この端末の状態**: `live-state.json`（各ツールが直接接続かローカルルーティング経由か、前回何を書き込んだか）、`codex-login-stash.json`（サードパーティのプロバイダに切り替えたときに退避した Codex の公式ログイン。公式プロバイダに戻すと復元されます）
- **設定ファイルの原本**: `backups/live-first-write/`（CC Switch が各ツールの設定ファイルを初めて書き換える前の元のファイル）

「設定 → 詳細 → 設定ディレクトリ」で「CC Switch 設定ディレクトリ」を変更すると、`settings.json`、この端末の状態、設定ファイルの原本以外の上記ファイルはすべて新しいディレクトリに保存されるようになります。CC Switch は既存のファイルを自動では移動しないため、先に手動でコピーしておいてください。`settings.json`、この端末の状態、設定ファイルの原本はこのコンピュータ専用のもので、常にデフォルトのディレクトリに置かれ、クラウド同期の対象にもなりません。

</details>

<details>
<summary><strong>Windows で WSL 内のツールを管理するには？</strong></summary>

CC Switch は WSL を自動では認識しません。「設定 → 詳細 → 設定ディレクトリ → 設定ディレクトリの上書き（詳細）」で、対象ツールのディレクトリを WSL 内のパス（例：`\\wsl.localhost\Ubuntu\home\<ユーザー名>\.claude`）に変更して保存すると、CC Switch は WSL 内の設定を読み書きするようになります（Claude Code、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw、Hermes、Pi で設定可能）。設定後は、「バージョン情報」ページでも対応する WSL ディストリビューション内でそのツールを検出・アップグレードします。

注意：ローカルルーティングが設定に書き込むアドレスは `127.0.0.1` です。WSL2 のデフォルトである NAT ネットワークモードでは、WSL 内の `127.0.0.1` から Windows 上のローカルルーティングに接続できないため、WSL の mirrored ネットワークモードに切り替える必要があります。

</details>

<details>
<summary><strong>コマンドライン版やヘッドレス版はありますか？</strong></summary>

CC Switch 本体が提供しているのは、グラフィカル環境が必要なデスクトップ版のみです（システム要件は[ダウンロード & インストール](#ダウンロード--インストール)を参照）。サーバー、SSH リモート、デスクトップ環境のないマシンでは、コミュニティがメンテナンスしている **[CC Switch CLI](https://github.com/SaladDay/cc-switch-cli)** をおすすめします。対話型のターミナル UI（TUI）とコマンドラインの両方で使え、Claude Code、Codex、Gemini CLI、OpenCode、OpenClaw、Hermes、Pi に対応しています。Homebrew（`brew install cc-switch-cli`）またはインストールスクリプトでインストールできます。

CC Switch CLI はデフォルトでデスクトップ版とデータディレクトリ `~/.cc-switch` を共有し、デスクトップ版の WebDAV 同期とも互換性があります。2 つのプロジェクトは別々にリリースされるため、CLI 版が対応するデータベースのバージョンがデスクトップ版より遅れることがあります。「データベースのバージョンが新しすぎます」という表示が出た場合は、CLI 版をアップグレードするか、CLI 版の対応を待ってください。

</details>

<details>
<summary><strong>Linux（Wayland + NVIDIA）：Web コンテンツがクリックできない・リサイズで黒画面になる</strong></summary>

AppImage は過去のネイティブ Wayland クラッシュを避けるため `GDK_BACKEND=x11`（XWayland）を強制します。新しい Wayland + NVIDIA 環境ではこれが原因で Web コンテンツ領域がクリックできなくなり（タイトルバーのボタンは動作します）、リサイズ時に黒画面になることがあります。内蔵のエスケープハッチでネイティブ Wayland に戻せます：

```bash
CC_SWITCH_GDK_BACKEND=wayland ./CC-Switch-*.AppImage
```

デスクトップアイコンから起動する場合は、`.desktop` の `Exec=` 行に追記するか（例：`env CC_SWITCH_GDK_BACKEND=wayland /path/to/AppImage`）、セッション環境で設定してください。この変数は汎用です：タイル型 Wayland コンポジタ（sway/Hyprland）でクリックが効かない場合は、逆に `CC_SWITCH_GDK_BACKEND=x11` を試してください。未設定の場合は既定の動作のままです。

</details>

その他の質問については、ユーザーマニュアルの[よくある質問](docs/user-manual/ja/5-faq/5.2-questions.md)をご覧ください。

## 貢献

Issue でのバグ報告やご提案を歓迎します！新機能を開発する前に、まず Issue を作成して実装方針をご相談ください。プロジェクトに合わない機能の PR はクローズされる場合があります。

開発環境、提出前のチェック、アーキテクチャの説明は [CONTRIBUTING.md](CONTRIBUTING.md)（英語）をご覧ください。使い方に関する質問は、まず [SUPPORT.md](SUPPORT.md) をご確認ください。セキュリティ上の脆弱性は、[SECURITY.md](SECURITY.md) に従って非公開で報告してください。

**技術スタック**：Tauri 2 · Rust · React 18 · TypeScript · SQLite

## ライセンス

MIT © Jason Young
