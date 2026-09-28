<div align="center">

# CC Switch

### Der All-in-One-Manager für Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build, OpenCode, OpenClaw, Hermes Agent, Pi & MiniMax Code

**API-Anbieter mit einem Klick wechseln und MCP, Skills und Prompts zentral verwalten — ohne JSON-, TOML- oder YAML-Konfigurationsdateien von Hand zu bearbeiten.**

[![Version](https://img.shields.io/github/v/release/CraftByte-arch/cc-switch?color=blue&label=version)](https://github.com/CraftByte-arch/cc-switch/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/CraftByte-arch/cc-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Downloads](https://img.shields.io/github/downloads/CraftByte-arch/cc-switch/total)](https://github.com/CraftByte-arch/cc-switch/releases/latest)

### Community-Fork: **[CraftByte-arch/cc-switch](https://github.com/CraftByte-arch/cc-switch)**

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JA.md) | Deutsch | [Changelog](CHANGELOG.md)

**[Download](#download--installation) · [Schnellstart](#schnellstart) · [Funktionen](#funktionen) · [FAQ](#faq) · [Benutzerhandbuch (Englisch)](docs/user-manual/en/README.md)**

</div>

> [!IMPORTANT]
> Dieses Repository ist ein Community-Fork von [CC Switch](https://github.com/farion1231/cc-switch) mit Schwerpunkt auf Codex-Modellrouting über mehrere Anbieter. Es ist kein offizielles Upstream-Release; die Upstream-Sponsoren unterstützen oder empfehlen diesen Fork nicht.

## Warum CC Switch?

Claude Code, Codex, Gemini CLI und andere KI-Programmierwerkzeuge haben jeweils ihr eigenes Konfigurationsformat. Wer den API-Anbieter wechselt, muss JSON-, TOML-, YAML- oder `.env`-Dateien von Hand bearbeiten; auch MCP, Skills und Prompts müssen in jedem Werkzeug einzeln gepflegt werden.

**CC Switch** bündelt all das in einer einzigen Desktop-App: Preset auswählen, Schlüssel eintragen und mit einem Klick wechseln — Ihre bestehende Konfiguration geht dabei nicht verloren.

- **Eine App, zehn Werkzeuge** — Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build, OpenCode, OpenClaw, Hermes, Pi, MiniMax Code
- **Kein manuelles Bearbeiten mehr** — 90+ Anbieter-Presets einschließlich AWS Bedrock, NVIDIA NIM und Community-Relays
- **GPT in Claude Code, Claude in Codex** — Integriertes lokales Routing, das die Schnittstellenformate von Anthropic, OpenAI und Gemini automatisch konvertiert, mit automatischem Failover
- **MCP, Skills & Prompts zentral verwalten** — MCP und Skills einmal hinzufügen und pro Werkzeug per Häkchen synchronisieren; Prompts werden je Werkzeug separat gepflegt
- **Nutzung und Kontingente auf einen Blick** — Token-Verbrauch und Kosten werden auch ohne lokales Routing erfasst; Abo-Kontingente und Guthaben erscheinen direkt auf den Anbieterkarten und im System-Tray
- **Plattformübergreifend** — Native Desktop-App für Windows, macOS und Linux, gebaut mit Tauri 2

## Screenshots

|                  Hauptoberfläche                   |                  Anbieter hinzufügen                  |
| :------------------------------------------------: | :---------------------------------------------------: |
| ![Hauptoberfläche](assets/screenshots/main-en.png) | ![Anbieter hinzufügen](assets/screenshots/add-en.png) |

## Download & Installation

### Systemanforderungen

- **Windows**: Windows 10 und höher
- **macOS**: macOS 12 (Monterey) und höher
- **Linux**: x86_64 oder ARM64 mit glibc 2.35+ und WebKitGTK 4.1 — z. B. Ubuntu 22.04+, Debian 12+ und aktuelle Fedora-Versionen; RHEL / Rocky / Alma 8–9 werden derzeit nicht unterstützt

### Windows-Nutzer

Laden Sie das neueste Installationsprogramm `CC-Switch-v{version}-Windows.msi` oder die portable Version `CC-Switch-v{version}-Windows-Portable.zip` von der Seite [Releases](../../releases) herunter. Unter Windows on ARM laden Sie `CC-Switch-v{version}-Windows-arm64.msi` oder `CC-Switch-v{version}-Windows-arm64-Portable.zip` herunter.

### macOS-Nutzer

**Methode 1: Installation über Homebrew (empfohlen)**

```bash
brew install --cask cc-switch
```

Aktualisieren:

```bash
brew upgrade --cask cc-switch
```

**Methode 2: Manueller Download**

Laden Sie `CC-Switch-v{version}-macOS.dmg` (empfohlen) oder `.zip` von der Seite [Releases](../../releases) herunter. Es handelt sich um einen Universal-Build, der nativ auf Apple-Silicon- und Intel-Macs läuft.

> **Hinweis**: CC Switch für macOS ist von Apple code-signiert und notarisiert. Sie können es direkt installieren und öffnen.

### Arch-Linux-Nutzer

**Installation über paru (empfohlen)**

```bash
paru -S cc-switch-bin
```

### Linux-Nutzer

Laden Sie den neuesten Linux-Build von der Seite [Releases](../../releases) herunter:

- `CC-Switch-v{version}-Linux-x86_64.deb` / `-Linux-arm64.deb` (Debian/Ubuntu)
- `CC-Switch-v{version}-Linux-x86_64.rpm` / `-Linux-arm64.rpm` (Fedora und andere RPM-Distributionen mit WebKitGTK 4.1)
- `CC-Switch-v{version}-Linux-x86_64.AppImage` / `-Linux-arm64.AppImage` (jede Distribution, die die obigen Systemanforderungen erfüllt)

> **Flatpak**: Nicht in den offiziellen Releases enthalten. Sie können es selbst aus dem `.deb` bauen — eine Anleitung finden Sie unter [`flatpak/README.md`](flatpak/README.md).

## Schnellstart

### Grundlegende Verwendung

1. **Anbieter hinzufügen**: Klicken Sie in der Symbolleiste auf „Add New Provider“ (die +-Schaltfläche) → Wählen Sie ein Preset oder erstellen Sie eine eigene Konfiguration
2. **Anbieter wechseln**:
   - Hauptoberfläche: Anbieter auswählen → auf „Enable“ klicken (bei OpenCode, OpenClaw, Hermes und MiniMax Code heißt die Schaltfläche „Add“; diese vier Werkzeuge und Pi arbeiten im Parallelmodus, sodass Sie mehrere Anbieter gleichzeitig hinzufügen können)
   - System-Tray: Anbietername direkt anklicken (Claude Code, Codex, Gemini CLI, Grok Build)
3. **Wirksam werden**: Claude Code erfordert keinen Neustart; bei Codex, Gemini CLI und Grok Build starten Sie das Terminal oder das CLI-Werkzeug neu, bei Claude Desktop die App selbst (siehe FAQ)
4. **Zurück zum offiziellen Login**: Wechseln Sie zum mitgelieferten offiziellen Anbieter in der Liste (z. B. „Claude Official“), starten Sie das Werkzeug neu und folgen Sie dann seinem Login-/OAuth-Vorgang
5. **Lokales Routing (optional)**: Wenn Sie in Claude Code Anbieter im OpenAI- oder Gemini-Format nutzen oder Claude in Codex verwenden möchten, müssen Sie das lokale Routing aktivieren. Schalten Sie dazu unter „Settings → Routing → Local Routing“ den „Routing Master Switch“ ein und aktivieren Sie anschließend unter „Routing Enabled“ das jeweilige Werkzeug. Wenn Sie das Routing direkt oben auf der Hauptseite umschalten möchten, aktivieren Sie „Show Routing Toggle on Main Page“

### MCP, Prompts, Skills, Projekte & Sessions

- **MCP**: Klicken Sie auf „MCP Management“ → Server über Vorlagen oder eigene Konfiguration hinzufügen (oder „Import Existing“) → Synchronisierung pro Werkzeug umschalten
- **Prompts**: Klicken Sie auf „Prompts“ → Prompts mit dem Markdown-Editor erstellen → nach dem Aktivieren wird der Prompt in die Prompt-Datei des Werkzeugs geschrieben
- **Skills**: Klicken Sie auf „Skills“ → „Discover Skills“ → skills.sh durchsuchen oder GitHub-Repositorys durchstöbern → mit einem Klick in unterstützte Werkzeuge installieren
- **Projekte**: Öffnen Sie auf der Seite von Claude Code, Claude Desktop oder Codex den Projektumschalter oben auf der Hauptseite → „New project“, um die aktuelle Konfiguration zu speichern; später wählen Sie das Projekt einfach im Umschalter aus, um die gesamte Konfiguration auf einmal zu wechseln
- **Sessions**: Klicken Sie auf „Session Manager“ → Gesprächsverlauf der einzelnen Werkzeuge durchsehen, durchsuchen und fortsetzen

> **Hinweis**: Beim Erststart importiert CC Switch Ihre bestehende Konfiguration von Claude Code, Codex, Gemini CLI und Grok Build automatisch als Anbieter namens `default` und fügt für diese Werkzeuge sowie für Claude Desktop jeweils den offiziellen Anbieter hinzu, sodass nichts von Ihrer bisherigen Konfiguration verloren geht.

Ausführliche Anleitungen zu allen Funktionen finden Sie im **[Benutzerhandbuch](docs/user-manual/en/README.md)** (auf Englisch) — es deckt sämtliche Funktionen ab, darunter Anbieterverwaltung, MCP/Prompts/Skills sowie lokales Routing & Failover.

## Funktionen

[Vollständiges Changelog](CHANGELOG.md) | [Release Notes](docs/release-notes/v3.20.4-en.md)

### Funktionen je Werkzeug

| Werkzeug | Anbieter | Lokales Routing | Tray-Umschaltung | MCP | Skills | Prompts | Sessions | Nutzungsstatistik |
| --- | --- | :---: | :---: | :---: | :---: | --- | :---: | :---: |
| Claude Code | Wechsel | ✓ | ✓ | ✓ | ✓ | CLAUDE.md | ✓ | ✓ |
| Claude Desktop | Wechsel | nur Model Mapping | – | – | – | – | – | nur Model Mapping |
| Codex | Wechsel | ✓ | ✓ | ✓ | ✓ | AGENTS.md | ✓ | ✓ |
| Gemini CLI | Wechsel | ✓ | ✓ | ✓ | ✓ | GEMINI.md | ✓ | ✓ |
| Grok Build | Wechsel | ✓ | ✓ | ✓ | ✓ | AGENTS.md | ✓ | ✓ |
| OpenCode | Parallel | – | – | ✓ | ✓ | AGENTS.md | ✓ | ✓ |
| OpenClaw | Parallel | – | – | – | – | Workspace-Editor | ✓ | – |
| Hermes | Parallel | – | – | ✓ | ✓ | Memory-Verwaltung | ✓ | – |
| Pi | Parallel | – | – | – | ✓ | AGENTS.md, SYSTEM.md, Prompt-Vorlagen | ✓ | ✓ |
| MiniMax Code | Parallel | – | – | ✓ | ✓ | AGENTS.md | ✓ | ✓ |

- **Wechsel**: Es ist jeweils nur ein Anbieter aktiv; **Parallel**: Mehrere Anbieter werden gleichzeitig in die eigene Konfiguration des Werkzeugs geschrieben; welcher verwendet wird, wählen Sie im Werkzeug aus.
- **Lokales Routing**: CC Switch leitet Anfragen auf Ihrem Rechner weiter und konvertiert dabei die Schnittstellenformate, siehe [Lokales Routing & Failover](#lokales-routing--failover) weiter unten. Für Anbieter von Claude Desktop können Sie „Direct“ oder „Model Mapping“ wählen; bei „Model Mapping“ laufen die Anfragen über das lokale Routing.
- **Sessions**: Sitzungsverlauf durchsehen und durchsuchen, Befehl zum Fortsetzen kopieren und das Gespräch weiterführen (Sessions von OpenClaw und Hermes lassen sich derzeit nicht fortsetzen). Um Hermes-Sessions zu sehen, wählen Sie im Session Manager „All“.
- **Nutzungsstatistik**: Ohne lokales Routing wird sie aus den lokalen Sitzungsprotokollen der einzelnen Werkzeuge erstellt; Anfragen über das lokale Routing werden ebenfalls erfasst.
- Die auf der Claude-Desktop-Seite geöffneten Panels für MCP, Skills, Prompts und Sessions wirken auf Claude Code.

### Anbieterverwaltung

- **90+ Anbieter-Presets** — Preset auswählen und Schlüssel eintragen, um einen Anbieter hinzuzufügen; alternativ können Sie eine eigene Konfiguration erstellen
- **Nur Kernfelder** — Beim Wechsel werden nur die Verbindungsdaten wie Endpunkt, Schlüssel und Modell ersetzt; Plugins, Hooks, MCP, selbst hinzugefügte Einstellungen und Kommentare bleiben unverändert
- **Projekte** — Speichern Sie den aktuellen Anbieter sowie MCP, Skills und Prompt-Dateien von Claude Code oder Codex als Projekt (bei Claude Desktop nur den Anbieter) und wechseln Sie später über den Projektumschalter oben auf der Hauptseite oder über das System-Tray mit einem Klick die gesamte Konfiguration; beim Wechsel zu einem anderen Projekt wird der aktuelle Zustand automatisch im bisherigen Projekt gespeichert
- **OAuth Authentication Center (Beta)** — Melden Sie sich unter „Settings → Auth“ bei mehreren GitHub-Copilot-, ChatGPT- und xAI-(Grok-)Konten an und nutzen Sie die Abonnements als Anbieter in Claude Code, Claude Desktop und Codex (außer bei OpenAI Official in Codex ist dafür jeweils das lokale Routing erforderlich). Die Nutzung von Abonnements außerhalb der offiziellen Clients kann gegen die Nutzungsbedingungen des Herstellers verstoßen — bitte schätzen Sie das Risiko selbst ein
- **Claude Desktop mit Drittanbietern** — Direkte Verbindung zu Anthropic-kompatiblen Endpunkten möglich; für Nicht-Claude-Modelle wählen Sie „Model Mapping“, dann bildet das lokale Routing Stufen wie Sonnet, Opus und Haiku auf die tatsächlichen Modelle des Anbieters ab
- **Universelle Anbieter** — Eine Konfiguration synchronisiert sich mit Claude Code, Codex und Gemini CLI
- Umschaltung mit einem Klick, Schnellumschaltung über System-Tray (Claude Code, Codex, Gemini CLI, Grok Build), Sortierung per Drag-and-drop, Import/Export

### Lokales Routing & Failover

- **Formatkonvertierung** — Das lokale Routing konvertiert Anfragen zwischen Anthropic Messages, OpenAI Chat Completions, OpenAI Responses und Gemini Native: Claude Code und Claude Desktop können Anbieter im OpenAI- oder Gemini-Format nutzen, Codex und Grok Build Anbieter im Chat-Completions- oder Anthropic-Messages-Format
- **Pro Werkzeug aktivierbar** — Für Claude Code, Codex, Gemini CLI und Grok Build lässt sich das lokale Routing jeweils einzeln aktivieren; danach wirkt ein Anbieterwechsel sofort auf die folgenden Anfragen (ändert der Wechsel das Modell, kann bei Codex, Gemini CLI und Grok Build trotzdem ein Neustart nötig sein)
- **Automatisches Failover** — Konfigurieren Sie für jedes Werkzeug eine Failover-Warteschlange; schlägt eine Anfrage fehl, wird automatisch der nächste Anbieter in der Warteschlange verwendet — ergänzt durch Circuit Breaker und Anbieter-Health-Monitoring
- **Request-Rectifier** — Korrigiert automatisch bestimmte Anfragen, die mit dem Upstream nicht kompatibel sind (z. B. Thinking-Signaturen, Herabstufung, wenn keine Bilder unterstützt werden)
- Offizielle Anbieter (z. B. Claude Official) können nicht über das lokale Routing laufen (ausgenommen OpenAI Official von Codex)
- Anleitungen (auf Englisch): [GPT in Claude Code nutzen](docs/guides/claude-codex-routing-guide-en.md) · [Claude in Codex nutzen](docs/guides/codex-claude-routing-guide-en.md)

### MCP, Prompts & Skills

- **Einheitliches MCP-Panel** — Alle MCP-Server an einer Stelle verwalten, pro Werkzeug per Häkchen synchronisieren, bestehende Konfigurationen aus den einzelnen Werkzeugen importieren, Import per Deep Link
- **Prompts** — Je Werkzeug separat verwaltete Prompt-Bibliothek mit Markdown-Editor; nach dem Aktivieren wird der Prompt in die Prompt-Datei des Werkzeugs geschrieben (CLAUDE.md / AGENTS.md / GEMINI.md), wobei der bisherige Inhalt der Datei vorher in die Prompt-Bibliothek zurückgesichert wird und nicht verloren geht. Bei Pi lassen sich außerdem SYSTEM.md, APPEND_SYSTEM.md und Prompt-Vorlagen bearbeiten
- **Skills** — skills.sh durchsuchen oder mit einem Klick aus GitHub-Repositorys bzw. ZIP-Dateien installieren; nach Updates suchen und alle mit einem Klick aktualisieren; Synchronisierung in die einzelnen Werkzeuge per Symlink oder Dateikopie, als Speicherort ist optional `~/.agents/skills` wählbar
- Alle drei Panels unterstützen die Suche; bei MCP und Skills können Sie zudem pro Werkzeug alle Einträge mit einem Klick aktivieren oder deaktivieren

### Nutzungs- & Kostenverfolgung

- **Nutzungs-Dashboard** — Funktioniert auch ohne lokales Routing: Standardmäßig werden die lokalen Sitzungsprotokolle der einzelnen Werkzeuge automatisch gescannt und Anfragen, Token, Cache-Trefferquote und Kosten nach Anbieter und Modell ausgewertet — mit Trenddiagrammen und einem Protokoll jeder einzelnen Anfrage
- **Kontingente & Guthaben** — Anbieterkarten und System-Tray zeigen direkt offizielle Abo-Kontingente (Claude, ChatGPT, Gemini, SuperGrok), 5-Stunden-, Wochen- und Monatskontingente von Coding Plans (Kimi, Zhipu GLM, MiniMax, Volcengine Ark u. a.) sowie Kontoguthaben (DeepSeek, OpenRouter, SiliconFlow u. a.) an; manche davon müssen zuerst über „Configure usage query“ auf der Anbieterkarte aktiviert werden. Für andere Anbieter können Sie ein eigenes Nutzungsskript schreiben
- **Eigene Preise** — Preise pro Modell festlegen, Import von models.dev möglich

### Session Manager & Workspace

- **Session Manager** — Gesprächsverlauf der einzelnen Werkzeuge durchsehen und durchsuchen, Befehl zum Fortsetzen kopieren und das Gespräch weiterführen; unter macOS lässt sich eine Session mit einem Klick im Terminal fortsetzen
- **Workspace-Editor** (OpenClaw) — Agent-Dateien (AGENTS.md, SOUL.md usw.) und „Daily Memory“ bearbeiten
- **Memory-Verwaltung** (Hermes) — MEMORY.md und USER.md von Hermes bearbeiten

### System & Plattform

- **Cloud-Synchronisierung** — Geräteübergreifende Synchronisierung über WebDAV (Jianguoyun, Nextcloud, Synology NAS usw.) oder S3-kompatiblen Speicher (AWS S3, Cloudflare R2, Alibaba Cloud OSS, Tencent Cloud COS usw.); alternativ können Sie das CC-Switch-Konfigurationsverzeichnis in einen Cloud-Speicher-Ordner wie Dropbox, OneDrive oder iCloud legen
- **CLI-Werkzeugverwaltung** — Auf der Seite „About“ sehen Sie die installierte und die neueste Version von Kommandozeilenwerkzeugen wie Claude Code und Codex, können sie mit einem Klick installieren, aktualisieren oder alle auf einmal aktualisieren und doppelte Installationen diagnostizieren; unter Windows lassen sich auch Werkzeuge in WSL verwalten (siehe FAQ)
- **Deep Link** (`ccswitch://`) — Anbieter, MCP-Server und Prompts per Link mit einem Klick importieren oder Skill-Repositorys hinzufügen
- **Hilfsprogramme** — Überspringen der Erststart-Bestätigung von Claude Code, Ausblenden der KI-Attribution, Übernahme des in CC Switch gewählten Anbieters durch die Claude-Code-Erweiterung für VS Code und mehr
- Dunkles / Helles / System-Theme, automatischer Start, automatischer Updater, atomare Schreibvorgänge, automatische Backups, i18n (zh/zh-TW/en/ja)

## FAQ

<details>
<summary><strong>Welche KI-Werkzeuge unterstützt CC Switch?</strong></summary>

CC Switch unterstützt zehn Werkzeuge: **Claude Code**, **Claude Desktop**, **Codex**, **Gemini CLI**, **Grok Build**, **OpenCode**, **OpenClaw**, **Hermes**, **Pi**, **MiniMax Code**. Jedes Werkzeug verfügt über dedizierte Anbieter-Presets und Konfigurationsverwaltung; welche Funktionen jeweils unterstützt werden, sehen Sie unter [Funktionen je Werkzeug](#funktionen-je-werkzeug).

</details>

<details>
<summary><strong>Muss ich das Terminal nach einem Anbieterwechsel neu starten?</strong></summary>

Das hängt vom Werkzeug ab:

- **Claude Code**: unterstützt Hot-Switching von Anbieterdaten — kein Neustart nötig.
- **Codex, Gemini CLI, Grok Build**: Starten Sie Ihr Terminal oder das CLI-Werkzeug neu, damit die Änderungen wirksam werden (CC Switch erinnert Sie nach dem Wechsel daran). Mit aktiviertem lokalem Routing gehen Anfragen sofort an den neuen Anbieter; ändert der Wechsel jedoch das Modell, kann bei allen drei Werkzeugen trotzdem ein Neustart nötig sein.
- **Claude Desktop**: Beenden Sie Claude Desktop vollständig und öffnen Sie es erneut; bei Verwendung von „Model Mapping“ muss CC Switch außerdem weiterlaufen.
- **OpenCode, OpenClaw, Hermes, Pi, MiniMax Code**: Dies sind Werkzeuge im Parallelmodus — ein Klick auf „Add“ (bei Pi „Enable“) trägt den Anbieter zusätzlich zu den bereits vorhandenen in die eigene Konfiguration des Werkzeugs ein; das gewünschte Modell wählen Sie anschließend im Werkzeug aus.

</details>

<details>
<summary><strong>Ändert ein Anbieterwechsel meine Plugins, Hooks oder andere Einstellungen?</strong></summary>

Nein. Beim Anbieterwechsel für Claude Code, Codex, Gemini CLI oder Grok Build ersetzt CC Switch in der Konfigurationsdatei nur die **Kernfelder**: Endpunkt, Schlüssel, Modellname und API-Protokoll (bei Codex zusätzlich die Reasoning-Stufe, bei Gemini CLI die Authentifizierungsmethode) sowie einige Kompatibilitätsoptionen, die zum Anbieter gehören (etwa „Disable Artifact Tool“ bei Claude Code und das Kontextfenster). Plugins, Hooks, Berechtigungen, MCP, selbst hinzugefügte Umgebungsvariablen, Kommentare und Formatierung bleiben unverändert und gelten für alle Anbieter.

Diese gemeinsamen Einstellungen können Sie direkt im Werkzeug ändern oder die Konfigurationsdatei von Hand bearbeiten. Sie können auch einen beliebigen Anbieter in CC Switch bearbeiten: Der Editor zeigt, „wie die Konfigurationsdatei nach dem Wechsel zu diesem Anbieter aussieht“. Beim Speichern werden die Kernfelder in diesem Anbieter gespeichert; alle anderen Änderungen werden in die Konfigurationsdatei geschrieben und gelten für alle Anbieter.

Das frühere „Common Config Snippet“ wird daher nicht mehr gebraucht, und die zugehörigen Schaltflächen wurden entfernt. Einstellungen, die vor dem Upgrade im Snippet standen, wurden beim Wechseln bereits in die Konfigurationsdatei geschrieben und bleiben dort erhalten. Bevor CC Switch eine Konfigurationsdatei zum ersten Mal umschreibt, sichert es außerdem das Original unter `~/.cc-switch/backups/live-first-write/`.

</details>

<details>
<summary><strong>Ich habe im Werkzeug das Modell gewechselt — warum ist es nach dem Hin- und Zurückwechseln wieder das alte?</strong></summary>

Das Modell ist ein Kernfeld und gehört zum Anbieter. Ein im Werkzeug gewähltes Modell (etwa mit `/model` in Claude Code) gilt bis zum nächsten Wechsel; beim Wechsel wird das Modell in der Konfigurationsdatei durch das im Zielanbieter gespeicherte ersetzt, und CC Switch speichert das im Werkzeug gewählte Modell nicht im vorherigen Anbieter. Wenn Sie ein Modell dauerhaft nutzen möchten, bearbeiten Sie diesen Anbieter in CC Switch.

Ältere Versionen haben beim Wegwechseln die gesamte Konfigurationsdatei in den Anbieter zurückgeschrieben. Das passiert nicht mehr: Dadurch wurden Plugins und andere gemeinsame Einstellungen in einem einzelnen Anbieter eingefroren und gingen beim Wechsel zu einem anderen Anbieter verloren.

</details>

<details>
<summary><strong>Warum kann ich den aktuell aktiven Anbieter nicht löschen?</strong></summary>

CC Switch folgt dem Designprinzip der „minimalen Eingriffstiefe“ — selbst wenn Sie die App deinstallieren, funktionieren Ihre Werkzeuge weiterhin normal.

Bei Werkzeugen mit jeweils einem aktiven Anbieter (Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build) behält das System daher immer eine aktive Konfiguration bei, da das Löschen aller Konfigurationen das entsprechende Werkzeug unbrauchbar machen würde. Werkzeuge im Parallelmodus wie OpenCode, OpenClaw, Hermes, Pi und MiniMax Code sind davon nicht betroffen — dort können Sie jeden Anbieter direkt löschen. Wenn Sie ein Werkzeug selten verwenden, können Sie es in den Einstellungen ausblenden. Wie Sie zurück zum offiziellen Login wechseln, erfahren Sie in der nächsten Frage.

</details>

<details>
<summary><strong>Wie wechsle ich zurück zum offiziellen Login?</strong></summary>

In CC Switch enthält die Anbieterliste von Claude Code, Claude Desktop, Codex, Gemini CLI und Grok Build jeweils bereits einen offiziellen Anbieter (**Claude Official**, **Claude Desktop Official**, **OpenAI Official**, **Google Official**, **Grok Official**); falls Sie ihn gelöscht haben, fügen Sie ihn aus den Presets wieder hinzu. Folgen Sie nach dem Wechsel zum offiziellen Anbieter dem Login-Vorgang des Werkzeugs (z. B. `/login` in Claude Code, `codex login` für Codex); anschließend können Sie frei zwischen dem offiziellen Anbieter und Drittanbietern wechseln.

Codex kann sich in CC Switch außerdem über „Sign in with ChatGPT“ bei mehreren ChatGPT-Konten anmelden; für jede **OpenAI Official**-Karte wählen Sie dann unter „Account to use“ ein Konto aus, sodass der Wechsel zwischen mehreren Plus-, Pro- oder Team-Konten mit einem Klick gelingt. Karten mit „Follow Codex login“ verwenden weiterhin den eigenen Login der Codex CLI.

Hinweis: Solange das lokale Routing aktiviert ist, kann nicht zu offiziellen Anbietern gewechselt werden — ausgenommen die OpenAI-Official-Karten von Codex.

</details>

<details>
<summary><strong>Warum steht nach dem Aktivieren des lokalen Routings 127.0.0.1 als Adresse in der Konfigurationsdatei?</strong></summary>

Bei aktiviertem lokalem Routing sendet das Werkzeug seine Anfragen zunächst an das lokale Routing von CC Switch (standardmäßig `http://127.0.0.1:15721`), und CC Switch leitet sie an den ausgewählten Anbieter weiter. Deshalb enthält die Konfigurationsdatei des Werkzeugs nur die lokale Adresse und den Platzhalterschlüssel `PROXY_MANAGED`; bei Claude Code wird der Modellname außerdem als fester Alias wie `claude-sonnet-5` eingetragen (im `/model`-Menü wird weiterhin der tatsächliche Modellname angezeigt). Die tatsächliche Anbieteradresse, der Schlüssel und das Modell sind in CC Switch gespeichert.

Unter „Settings → Usage Statistics → Request Logs“ sehen Sie für jede Anfrage „angefragtes Modell → tatsächliches Modell“.

Solange das lokale Routing aktiv ist, wechseln Sie den Anbieter, den das lokale Routing verwendet; der Anbieter, den Sie vor dem Aktivieren genutzt haben, bleibt unverändert und ist auf seiner Karte mit „Direct“ gekennzeichnet. Nach dem Deaktivieren des lokalen Routings wird die Konfigurationsdatei auf die Konfiguration dieses direkten Anbieters zurückgeschrieben. Auch beim Beenden von CC Switch wird zuerst der direkte Anbieter zurückgeschrieben; beim nächsten Start verbindet sich das lokale Routing wieder.

</details>

<details>
<summary><strong>Kann ich in Claude Code OpenAI-kompatible Schnittstellen, Gemini oder lokale Modelle verwenden?</strong></summary>

Ja, dafür muss jedoch das lokale Routing aktiviert sein. Wählen Sie beim Bearbeiten des Anbieters unter „Advanced Options“ im Feld „Upstream Format“ das Schnittstellenformat, das der Anbieter verwendet: Für Dienste, die nur eine Chat-Completions-Schnittstelle anbieten (was bei vielen lokalen Modelldiensten der Fall ist), wählen Sie „OpenAI Chat Completions“, für Dienste mit Responses-Schnittstelle „OpenAI Responses API“ und für Gemini „Gemini Native generateContent“. Aktivieren Sie anschließend wie in Schritt 5 des [Schnellstarts](#schnellstart) beschrieben das lokale Routing für Claude Code. Ist das falsche Format gewählt oder das lokale Routing nicht aktiviert, erscheint in der Regel ein 404- oder 405-Fehler.

Umgekehrt können Sie in Codex oder Grok Build unter „Upstream Format“ die Option „Anthropic Messages“ wählen, um Anbieter im Claude-Format zu nutzen — auch dafür muss das lokale Routing aktiviert sein. Details finden Sie in den Anleitungen [GPT in Claude Code nutzen](docs/guides/claude-codex-routing-guide-en.md) und [Claude in Codex nutzen](docs/guides/codex-claude-routing-guide-en.md) (auf Englisch).

</details>

<details>
<summary><strong>Der „Connectivity check“ war erfolgreich — warum schlagen Anfragen trotzdem fehl?</strong></summary>

Der „Connectivity check“ auf der Anbieterkarte prüft nur, ob die Anbieteradresse erreichbar ist, und sendet keine echte Modellanfrage; ob API-Schlüssel und Modellname korrekt sind, lässt sich damit also nicht überprüfen. Wenn Anfragen fehlschlagen, prüfen Sie Schlüssel, Modellname und Upstream-Format; bei aktiviertem lokalem Routing finden Sie die konkrete Fehlermeldung außerdem unter „Settings → Usage Statistics → Request Logs“.

</details>

<details>
<summary><strong>Wo werden meine Daten gespeichert?</strong></summary>

Standardmäßig liegen alle Daten im Ordner `.cc-switch` in Ihrem Benutzerverzeichnis (unter Windows `C:\Users\<Benutzername>\.cc-switch`):

- **Datenbank**: `cc-switch.db` (SQLite — Anbieter, MCP, Prompts, Skills, Projekte, Nutzungsdaten usw.)
- **Lokale Einstellungen**: `settings.json` (gerätebezogene Einstellungen, z. B. die Konfigurationsverzeichnisse der einzelnen Werkzeuge, Backup-Richtlinie, Verbindungsdaten für die Cloud-Synchronisierung)
- **Backups**: `backups/` (standardmäßig automatisch alle 24 Stunden, die 10 neuesten werden behalten; anpassbar unter „Settings → Advanced → Backup & Restore“)
- **Skills**: `skills/` (in den Einstellungen auf `~/.agents/skills` umstellbar); standardmäßig per Symlink mit den einzelnen Werkzeugen synchronisiert; schlägt das fehl, wird stattdessen kopiert
- **Skill-Backups**: `skill-backups/` (vor dem Deinstallieren oder Aktualisieren eines Skills automatisch erstellt, die 20 neuesten werden behalten)
- **OAuth-Anmeldedaten**: `copilot_auth.json`, `codex_oauth_auth.json`, `xai_oauth_auth.json`
- **Logs**: `logs/cc-switch.log` und `crash.log` — bitte fügen Sie sie bei Problemmeldungen bei
- **Gerätezustand**: `live-state.json` (ob jedes Werkzeug direkt oder über das lokale Routing verbunden ist und was zuletzt geschrieben wurde), `codex-login-stash.json` (der offizielle Codex-Login, der beim Wechsel zu einem Drittanbieter beiseitegelegt und beim Zurückwechseln zu einem offiziellen Anbieter wiederhergestellt wird)
- **Original-Konfigurationsdateien**: `backups/live-first-write/` (die Konfigurationsdateien der Werkzeuge, bevor CC Switch sie zum ersten Mal umgeschrieben hat)

Wenn Sie unter „Settings → Advanced → Configuration Directory“ das „CC Switch Configuration Directory“ ändern, werden alle oben genannten Dateien außer `settings.json`, dem Gerätezustand und den Original-Konfigurationsdateien im neuen Verzeichnis abgelegt. CC Switch verschiebt vorhandene Dateien nicht automatisch; kopieren Sie sie vorher manuell dorthin. `settings.json`, der Gerätezustand und die Original-Konfigurationsdateien gehören nur zu diesem Rechner: Sie bleiben immer im Standardverzeichnis und werden nicht per Cloud synchronisiert.

</details>

<details>
<summary><strong>Wie verwalte ich unter Windows Werkzeuge in WSL?</strong></summary>

CC Switch erkennt WSL nicht automatisch. Ändern Sie unter „Settings → Advanced → Configuration Directory → Configuration Directory Override (Advanced)“ das Verzeichnis des jeweiligen Werkzeugs auf einen Pfad in WSL, z. B. `\\wsl.localhost\Ubuntu\home\<Benutzername>\.claude`; nach dem Speichern liest und schreibt CC Switch die Konfiguration in WSL (einstellbar für Claude Code, Codex, Gemini CLI, Grok Build, OpenCode, OpenClaw, Hermes und Pi). Anschließend erkennt und aktualisiert auch die Seite „About“ das Werkzeug in der entsprechenden WSL-Distribution.

Hinweis: Das lokale Routing trägt als Adresse `127.0.0.1` in die Konfiguration ein. Im standardmäßigen NAT-Netzwerkmodus von WSL2 erreicht `127.0.0.1` in WSL das lokale Routing unter Windows nicht; wechseln Sie daher in den Mirrored-Netzwerkmodus von WSL.

</details>

<details>
<summary><strong>Gibt es eine Kommandozeilen- oder Headless-Version?</strong></summary>

CC Switch selbst gibt es nur als Desktop-Version mit grafischer Oberfläche (Systemanforderungen siehe [Download & Installation](#download--installation)). Für Server, SSH-Remote-Sitzungen oder Rechner ohne Desktop-Umgebung empfehlen wir das von der Community gepflegte **[CC Switch CLI](https://github.com/SaladDay/cc-switch-cli)**: Es bietet sowohl eine interaktive Terminaloberfläche (TUI) als auch eine Kommandozeilenschnittstelle, unterstützt Claude Code, Codex, Gemini CLI, OpenCode, OpenClaw, Hermes und Pi und lässt sich über Homebrew (`brew install cc-switch-cli`) oder ein Installationsskript installieren.

CC Switch CLI verwendet standardmäßig dasselbe Datenverzeichnis `~/.cc-switch` wie die Desktop-Version und ist auch mit deren WebDAV-Synchronisierung kompatibel. Die beiden Projekte werden unabhängig voneinander veröffentlicht, daher kann die von der CLI-Version unterstützte Datenbankversion zeitweise hinter der Desktop-Version zurückliegen; erscheint der Hinweis, dass die Datenbankversion zu neu ist, aktualisieren Sie die CLI-Version oder warten Sie, bis sie nachzieht.

</details>

<details>
<summary><strong>Linux (Wayland + NVIDIA): Klicks im Webinhalt reagieren nicht, schwarzer Bildschirm beim Größenändern</strong></summary>

Das AppImage erzwingt `GDK_BACKEND=x11` (XWayland), um einen historischen nativen Wayland-Absturz zu vermeiden. Auf neueren Wayland-+-NVIDIA-Systemen kann das dazu führen, dass der Webinhalt nicht anklickbar ist (die Titelleisten-Schaltflächen funktionieren weiterhin) und das Fenster beim Größenändern schwarz wird. Starten Sie mit dem optionalen Notausgang, um zu nativem Wayland zu wechseln:

```bash
CC_SWITCH_GDK_BACKEND=wayland ./CC-Switch-*.AppImage
```

Wenn Sie über ein Desktop-Symbol starten, fügen Sie es der `Exec=`-Zeile der `.desktop`-Datei hinzu (z. B. `env CC_SWITCH_GDK_BACKEND=wayland /pfad/zum/AppImage`) oder setzen Sie es in Ihrer Sitzungsumgebung. Die Variable ist generisch: Auf Tiling-Wayland-Compositors (sway/Hyprland), bei denen Klicks nicht reagieren, versuchen Sie umgekehrt `CC_SWITCH_GDK_BACKEND=x11`. Bleibt sie ungesetzt, bleibt das Standardverhalten erhalten.

</details>

Weitere Fragen und Antworten finden Sie in den [FAQ des Benutzerhandbuchs](docs/user-manual/en/5-faq/5.2-questions.md) (auf Englisch).

## Mitwirken

Wir freuen uns über Issues mit Fehlerberichten und Vorschlägen! Bitte eröffnen Sie vor der Entwicklung einer neuen Funktion zunächst ein Issue, um die Umsetzung zu besprechen; Feature-PRs, die nicht zum Projekt passen, können geschlossen werden.

Entwicklungsumgebung, Prüfungen vor dem Einreichen und Architekturbeschreibung finden Sie in [CONTRIBUTING.md](CONTRIBUTING.md) (auf Englisch); bei Fragen zur Nutzung lesen Sie bitte zuerst [SUPPORT.md](SUPPORT.md); Sicherheitslücken melden Sie bitte vertraulich gemäß [SECURITY.md](SECURITY.md).

**Tech-Stack**: Tauri 2 · Rust · React 18 · TypeScript · SQLite

## Lizenz

MIT © Jason Young
