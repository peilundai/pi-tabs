import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { readConfiguration } from "./configuration";
import { EXTENSION_NAME } from "./constants";
import { planDropInterception } from "./dropInterception";
import {
  assessExecutable,
  firstExistingExecutable,
  isExplicitPath,
  missingExecutableMessage,
  type ExecutableAvailability,
} from "./executableLookup";
import {
  buildLaunchPlan,
  profileExitCommand,
  terminalEnvironment,
  windowsCmdShimLaunch,
} from "./launch";
import { formatMentions, resourceFsPath } from "./pathMentions";
import { PiPseudoterminal } from "./piPseudoterminal";
import {
  buildBridgeLaunch,
  locatePythonWithPty,
  wrapProfileWithBridge,
} from "./pythonBridge";
import { columnForUnplacedTerminal } from "./sessionPlacement";
import {
  shouldDisposeExitedTerminal,
  shouldNotifyTerminalFailure,
  terminalFailureMessage,
} from "./terminalExit";
import type {
  CwdMode,
  EditorKind,
  EditorRestore,
  ExtensionConfiguration,
  ResourceTabSnapshot,
  WorkspaceFolderDescriptor,
} from "./types";
import { chooseWorkingDirectory } from "./workingDirectory";

interface PiSession {
  terminal: vscode.Terminal;
  cwd?: string;
  viewColumn: number;
  lastUsed: number;
  startedAt: number;
}

export class PiTerminalManager implements vscode.Disposable {
  private readonly sessions = new Map<vscode.Terminal, PiSession>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly reaper: ReturnType<typeof setInterval>;
  private sequence = 0;
  private pythonCache: string | null | undefined;
  private handlingTabMove = false;
  private readonly executableVerdicts = new Map<string, ExecutableAvailability>();
  private readonly notedExits = new WeakSet<vscode.Terminal>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        this.sessions.delete(terminal);
      }),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.rememberActiveSession(terminal);
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        void this.handleTabChanges(event).catch((error: unknown) => {
          this.reportError("Could not process the dropped editor", error, false);
        });
      }),
    );

    this.reaper = setInterval(() => this.disposeExitedTerminals(), 1_000);
    this.reaper.unref?.();
  }

  dispose(): void {
    clearInterval(this.reaper);
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const { terminal } of [...this.sessions.values()]) {
      if (vscode.window.terminals.includes(terminal)) {
        terminal.dispose();
      }
    }
    this.sessions.clear();
  }

  async open(): Promise<void> {
    const session = this.preferredSession();
    if (session) {
      this.reveal(session);
      return;
    }
    await this.createSession();
  }

  async newChat(): Promise<void> {
    await this.createSession();
  }

  async insertPaths(uri?: vscode.Uri, selected?: readonly vscode.Uri[]): Promise<void> {
    const resources =
      selected && selected.length > 0
        ? selected
        : uri
          ? [uri]
          : this.activeResources();
    const paths = resources
      .map((resource) => resourceFsPath(resource))
      .filter((item): item is string => Boolean(item));
    if (paths.length === 0) {
      void vscode.window.showInformationMessage(
        "Select a file or folder to insert into the Pi chat.",
      );
      return;
    }
    let session = this.preferredSession();
    const created = !session;
    if (!session) {
      session = await this.createSession();
    }
    if (!session) {
      return;
    }
    if (created) {
      try {
        await session.terminal.processId;
      } catch {
        return;
      }
    }
    await this.insertIntoSession(session, paths);
  }

  private async createSession(): Promise<PiSession | undefined> {
    const configuration = readConfiguration();
    if (!this.ensureExecutable(configuration)) {
      return undefined;
    }
    const cwd = await this.resolveWorkingDirectory(configuration.cwdMode);
    if (cwd === "cancelled") {
      return undefined;
    }

    const launch = this.launchForSession(configuration);
    const python = this.pythonWithPty();
    const bridgeScript = this.context.asAbsolutePath("scripts/pi-pty-bridge.py");
    const bridge = python
      ? buildBridgeLaunch(launch, {
          python,
          bridgeScript,
          cwd,
          titleMaxLength: configuration.titleMaxLength,
        })
      : undefined;
    const viewColumn = this.targetViewColumn();
    const iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "pi-coding-agent-light.svg",
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "pi-coding-agent-dark.svg",
      ),
    };

    let terminal: vscode.Terminal;
    if (bridge) {
      terminal = vscode.window.createTerminal({
        name: EXTENSION_NAME,
        pty: new PiPseudoterminal({
          ...bridge,
          cwd,
          environment: terminalEnvironment({
            ...process.env,
            PYTHONUNBUFFERED: "1",
          }),
          titleMaxLength: configuration.titleMaxLength,
        }),
        iconPath,
        isTransient: true,
        location: { viewColumn, preserveFocus: false },
      });
    } else {
      const options: vscode.TerminalOptions = {
        name: EXTENSION_NAME,
        cwd,
        iconPath,
        isTransient: true,
        env: { COLORTERM: "truecolor" },
        location: { viewColumn, preserveFocus: false },
      };
      if (launch.kind === "loginShell") {
        const shim = this.windowsShim(configuration);
        options.shellPath = shim?.shellPath ?? launch.executable;
        options.shellArgs = [...(shim?.shellArgs ?? launch.args)];
      }
      terminal = vscode.window.createTerminal(options);
    }

    const session: PiSession = {
      terminal,
      cwd,
      viewColumn,
      lastUsed: ++this.sequence,
      startedAt: Date.now(),
    };
    this.sessions.set(terminal, session);
    terminal.show(false);
    // `ViewColumn.Beside` is a placement sentinel (-2), not the concrete
    // column that VS Code creates. Rebind immediately after reveal so the
    // next chat reuses the resulting editor group even when activation events
    // are coalesced by a compatible editor.
    this.rememberActiveSession(terminal);

    if (launch.kind === "profile") {
      const command =
        python && process.platform !== "win32"
          ? wrapProfileWithBridge(launch.commandLine, {
              python,
              bridgeScript,
              cwd,
              titleMaxLength: configuration.titleMaxLength,
              shell:
                process.env.SHELL ||
                (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
            })
          : profileExitCommand(launch.commandLine, process.platform);
      terminal.sendText(command, true);
    }

    this.output.appendLine(
      `Opened a Pi chat using ${launch.kind} mode${cwd ? "" : " in the terminal default directory"}.`,
    );
    return session;
  }

  private launchForSession(
    configuration: ExtensionConfiguration,
  ): ReturnType<typeof buildLaunchPlan> {
    const launch = buildLaunchPlan(configuration, process.platform, process.env);
    if (
      launch.kind !== "loginShell" ||
      process.platform !== "win32" ||
      this.windowsShim(configuration)
    ) {
      return launch;
    }
    const resolved = firstExistingExecutable(
      configuration.command,
      "win32",
      process.env,
      fs.existsSync,
    );
    if (!resolved || /\.(cmd|bat)$/i.test(resolved)) {
      return launch;
    }
    return { ...launch, executable: resolved };
  }

  private windowsShim(
    configuration: ExtensionConfiguration,
  ): { shellPath: string; shellArgs: readonly string[] } | undefined {
    if (process.platform !== "win32" || configuration.launchMode !== "loginShell") {
      return undefined;
    }
    const command = configuration.command.trim() || "pi";
    const script = isExplicitPath(command, "win32")
      ? /\.(cmd|bat)$/i.test(command) && fs.existsSync(command)
        ? command
        : undefined
      : firstExistingExecutable(command, "win32", process.env, fs.existsSync);
    if (!script || !/\.(cmd|bat)$/i.test(script)) {
      return undefined;
    }
    return windowsCmdShimLaunch(script, configuration.args, process.env.ComSpec);
  }

  private ensureExecutable(configuration: ExtensionConfiguration): boolean {
    const key = `${process.platform}\0${configuration.launchMode}\0${configuration.command}`;
    let verdict = this.executableVerdicts.get(key);
    if (!verdict) {
      verdict = assessExecutable(
        configuration.command,
        process.platform,
        process.env,
        configuration.launchMode,
        {
          exists: fs.existsSync,
          run: (executable, args, timeoutMilliseconds) =>
            spawnSync(executable, [...args], {
              timeout: timeoutMilliseconds,
              encoding: "utf8",
              windowsHide: true,
              input: "",
            }),
        },
      );
      if (verdict !== "unverified") {
        this.executableVerdicts.set(key, verdict);
      }
    }
    if (verdict !== "missing") {
      return true;
    }
    this.output.appendLine("Pi executable was not found.");
    void vscode.window.showErrorMessage(
      missingExecutableMessage(configuration.command, process.platform),
    );
    return false;
  }

  private targetViewColumn(): vscode.ViewColumn {
    return this.preferredSession()?.viewColumn ?? vscode.ViewColumn.Beside;
  }

  private preferredSession(): PiSession | undefined {
    this.pruneSessions();
    const active = vscode.window.activeTerminal;
    const activeSession = active ? this.sessions.get(active) : undefined;
    if (activeSession && this.isAlive(activeSession.terminal)) {
      return activeSession;
    }
    return [...this.sessions.values()]
      .filter((session) => this.isAlive(session.terminal))
      .sort((left, right) => right.lastUsed - left.lastUsed)[0];
  }

  private sessionInColumn(viewColumn: number): PiSession | undefined {
    const active = vscode.window.activeTerminal;
    const activeSession = active ? this.sessions.get(active) : undefined;
    if (activeSession?.viewColumn === viewColumn && this.isAlive(activeSession.terminal)) {
      return activeSession;
    }
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.viewColumn === viewColumn && this.isAlive(session.terminal),
      )
      .sort((left, right) => right.lastUsed - left.lastUsed)[0];
  }

  private reveal(session: PiSession): void {
    session.lastUsed = ++this.sequence;
    session.terminal.show(false);
  }

  private rememberActiveSession(terminal: vscode.Terminal | undefined): void {
    if (!terminal) {
      return;
    }
    const session = this.sessions.get(terminal);
    if (!session) {
      return;
    }
    session.lastUsed = ++this.sequence;
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    if (activeGroup.activeTab?.input instanceof vscode.TabInputTerminal) {
      session.viewColumn = activeGroup.viewColumn;
    }
  }

  private async insertIntoSession(
    session: PiSession | undefined,
    paths: readonly string[],
  ): Promise<void> {
    if (!session) {
      void vscode.window.showInformationMessage("No Pi chat is open.");
      return;
    }
    const input = formatMentions(paths, session.cwd);
    if (!input) {
      return;
    }
    this.reveal(session);
    session.terminal.sendText(input, false);
  }

  private async handleTabChanges(event: vscode.TabChangeEvent): Promise<void> {
    this.bindUnplacedSession(event);
    if (this.handlingTabMove || event.opened.length === 0) {
      return;
    }
    this.rememberActiveSession(vscode.window.activeTerminal);
    const plan = planDropInterception(
      event.opened.map(tabSnapshot),
      event.closed.map(tabSnapshot),
      new Set([...this.sessions.values()].map((session) => session.viewColumn)),
    );
    if (!plan) {
      return;
    }
    const session = this.sessionInColumn(plan.destinationColumn);
    if (!session) {
      return;
    }
    const insert = formatMentions(plan.paths, session.cwd);
    if (!insert) {
      return;
    }

    const uris = new Map<string, vscode.Uri>();
    const tabsToClose: vscode.Tab[] = [];
    for (const tab of event.opened) {
      const uri = resourceUri(tab);
      if (!uri) {
        continue;
      }
      const key = uri.toString();
      uris.set(key, uri);
      if (plan.closeResourceKeys.includes(key)) {
        tabsToClose.push(tab);
      }
    }
    if (tabsToClose.length === 0) {
      return;
    }

    this.handlingTabMove = true;
    try {
      await vscode.window.tabGroups.close(tabsToClose, true);
      for (const restore of plan.restore) {
        const uri = uris.get(restore.resourceKey);
        if (uri) {
          await restoreEditor(uri, restore);
        }
      }
      this.reveal(session);
      session.terminal.sendText(insert, false);
    } finally {
      this.handlingTabMove = false;
    }
  }

  private activeResources(): readonly vscode.Uri[] {
    const activeEditor = vscode.window.activeTextEditor?.document.uri;
    if (activeEditor && resourceFsPath(activeEditor)) {
      return [activeEditor];
    }
    const uri = resourceUri(vscode.window.tabGroups.activeTabGroup.activeTab);
    return uri && resourceFsPath(uri) ? [uri] : [];
  }

  private async resolveWorkingDirectory(
    mode: CwdMode,
  ): Promise<string | undefined | "cancelled"> {
    const folders: WorkspaceFolderDescriptor[] = (
      vscode.workspace.workspaceFolders ?? []
    ).map((folder) => ({ name: folder.name, fsPath: folder.uri.fsPath }));
    const choice = chooseWorkingDirectory(folders, activeResourcePath(), mode);
    if (choice.kind === "unavailable") {
      void vscode.window.showWarningMessage(
        `${EXTENSION_NAME}: no workspace or home directory is available.`,
      );
      return undefined;
    }
    if (choice.kind === "path") {
      return choice.fsPath;
    }
    const selected = await vscode.window.showQuickPick(
      choice.folders.map((folder) => ({
        label: folder.name,
        description: folder.fsPath,
        fsPath: folder.fsPath,
      })),
      { placeHolder: "Choose the workspace folder for this Pi chat" },
    );
    return selected?.fsPath ?? "cancelled";
  }

  private pythonWithPty(): string | undefined {
    if (this.pythonCache !== undefined) {
      return this.pythonCache ?? undefined;
    }
    const located = locatePythonWithPty({
      platform: process.platform,
      environment: process.env,
      exists: fs.existsSync,
      run: (executable, args, timeoutMilliseconds) =>
        spawnSync(executable, [...args], { timeout: timeoutMilliseconds }),
    });
    this.pythonCache = located ?? null;
    if (!located && process.platform !== "win32") {
      this.output.appendLine(
        "Python 3 with Unix PTY support was not found; advanced titles and modifier-drop rewriting are disabled.",
      );
    }
    return located;
  }

  private isAlive(terminal: vscode.Terminal): boolean {
    return vscode.window.terminals.includes(terminal) && !terminal.exitStatus;
  }

  private pruneSessions(): void {
    for (const terminal of this.sessions.keys()) {
      if (!vscode.window.terminals.includes(terminal)) {
        this.sessions.delete(terminal);
      }
    }
  }

  private bindUnplacedSession(event: vscode.TabChangeEvent): void {
    const openedTerminalColumns = event.opened
      .filter((tab) => tab.input instanceof vscode.TabInputTerminal)
      .map((tab) => tab.group.viewColumn);
    const unplaced = [...this.sessions.values()].filter(
      (session) =>
        session.viewColumn === vscode.ViewColumn.Beside &&
        this.isAlive(session.terminal),
    );
    const column = columnForUnplacedTerminal(
      openedTerminalColumns,
      unplaced.length,
      vscode.ViewColumn.Beside,
    );
    if (column === undefined || unplaced.length !== 1) {
      return;
    }
    unplaced[0].viewColumn = column;
  }

  private disposeExitedTerminals(): void {
    for (const session of this.sessions.values()) {
      const status = session.terminal.exitStatus;
      if (!vscode.window.terminals.includes(session.terminal) || !status) {
        continue;
      }
      if (shouldDisposeExitedTerminal(status.code)) {
        session.terminal.dispose();
        continue;
      }
      if (this.notedExits.has(session.terminal)) {
        continue;
      }
      this.notedExits.add(session.terminal);
      const code = status.code ?? 1;
      this.output.appendLine(`Pi chat exited with code ${code}.`);
      if (shouldNotifyTerminalFailure(code, Date.now() - session.startedAt)) {
        void vscode.window.showErrorMessage(terminalFailureMessage(code));
      }
    }
  }

  private reportError(context: string, error: unknown, notify: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`${context}: ${message}`);
    if (notify) {
      void vscode.window.showErrorMessage(`${context}: ${message}`);
    }
  }
}

function resourceUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputNotebook ||
    input instanceof vscode.TabInputCustom
  ) {
    return input.uri;
  }
  return undefined;
}

function editorKind(tab: vscode.Tab): EditorKind {
  if (tab.input instanceof vscode.TabInputNotebook) {
    return { kind: "notebook" };
  }
  if (tab.input instanceof vscode.TabInputCustom) {
    return { kind: "custom", viewType: tab.input.viewType };
  }
  return { kind: "text" };
}

function tabSnapshot(tab: vscode.Tab): ResourceTabSnapshot {
  const uri = resourceUri(tab);
  return {
    viewColumn: tab.group.viewColumn,
    resourceKey: uri?.toString(),
    fsPath: uri ? resourceFsPath(uri) : undefined,
    editorKind: uri ? editorKind(tab) : undefined,
  };
}

async function restoreEditor(uri: vscode.Uri, restore: EditorRestore): Promise<void> {
  const options = {
    viewColumn: restore.viewColumn,
    preview: true,
    preserveFocus: true,
  };
  if (restore.editorKind.kind === "notebook") {
    const document = await vscode.workspace.openNotebookDocument(uri);
    await vscode.window.showNotebookDocument(document, options);
  } else if (restore.editorKind.kind === "custom") {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      restore.editorKind.viewType,
      options,
    );
  } else {
    await vscode.window.showTextDocument(uri, options);
  }
}

function activeResourcePath(): string | undefined {
  const activeEditor = vscode.window.activeTextEditor?.document.uri;
  if (activeEditor) {
    const path = resourceFsPath(activeEditor);
    if (path) {
      return path;
    }
  }
  const groups = [
    vscode.window.tabGroups.activeTabGroup,
    ...vscode.window.tabGroups.all.filter((group) => !group.isActive),
  ];
  for (const group of groups) {
    const uri = resourceUri(group.activeTab);
    if (uri) {
      const path = resourceFsPath(uri);
      if (path) {
        return path;
      }
    }
  }
  return undefined;
}
