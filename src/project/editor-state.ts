import { applyProjectCommand, type ProjectCommand } from './commands.js';
import { cloneProject, serializeProject } from './project.js';
import type { PixelfProject } from './types.js';
import { validateProject } from './validation.js';

interface HistoryEntry {
  after: PixelfProject;
  before: PixelfProject;
  label: string;
  mergeKey?: string;
  time: number;
}

interface Transaction {
  before: PixelfProject;
  label: string;
}

export class EditorState {
  private current: PixelfProject;
  private savedSource: string;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private transaction: Transaction | null = null;

  readonly selectedNodeIds: string[] = [];
  readonly openPanels = new Set<string>();
  playbackTime = 0;
  playing = false;
  rendererStatus = 'idle';

  constructor(project: PixelfProject) {
    validateProject(project);
    this.current = cloneProject(project);
    this.savedSource = serializeProject(project);
  }

  get project(): PixelfProject {
    return this.current;
  }

  get dirty(): boolean {
    return serializeProject(this.current) !== this.savedSource;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  dispatch(
    command: ProjectCommand,
    options: { label?: string; mergeKey?: string; now?: number } = {},
  ): void {
    if (this.transaction !== null) throw new Error('Dispatch is unavailable during a transaction');
    const before = this.current;
    const after = applyProjectCommand(before, command);
    const time = options.now ?? Date.now();
    const previous = this.undoStack.at(-1);
    if (
      options.mergeKey !== undefined &&
      previous?.mergeKey === options.mergeKey &&
      time - previous.time <= 500
    ) {
      previous.after = cloneProject(after);
      previous.time = time;
    } else {
      this.undoStack.push({
        after: cloneProject(after),
        before: cloneProject(before),
        label: options.label ?? command.type,
        mergeKey: options.mergeKey,
        time,
      });
    }
    this.current = after;
    this.redoStack.length = 0;
  }

  beginTransaction(label: string): void {
    if (this.transaction !== null) throw new Error('A transaction is already active');
    this.transaction = { before: cloneProject(this.current), label };
  }

  preview(command: ProjectCommand): void {
    if (this.transaction === null) throw new Error('Preview requires an active transaction');
    this.current = applyProjectCommand(this.current, command);
  }

  commitTransaction(now = Date.now()): void {
    const transaction = this.transaction;
    if (transaction === null) throw new Error('No transaction is active');
    this.transaction = null;
    if (serializeProject(transaction.before) === serializeProject(this.current)) return;
    this.undoStack.push({
      after: cloneProject(this.current),
      before: transaction.before,
      label: transaction.label,
      time: now,
    });
    this.redoStack.length = 0;
  }

  cancelTransaction(): void {
    if (this.transaction === null) throw new Error('No transaction is active');
    this.current = this.transaction.before;
    this.transaction = null;
  }

  undo(): void {
    if (this.transaction !== null) throw new Error('Undo is unavailable during a transaction');
    const entry = this.undoStack.pop();
    if (entry === undefined) return;
    this.current = cloneProject(entry.before);
    this.redoStack.push(entry);
  }

  redo(): void {
    if (this.transaction !== null) throw new Error('Redo is unavailable during a transaction');
    const entry = this.redoStack.pop();
    if (entry === undefined) return;
    this.current = cloneProject(entry.after);
    this.undoStack.push(entry);
  }

  markSaved(): void {
    this.savedSource = serializeProject(this.current);
  }

  select(nodeIds: readonly string[]): void {
    this.selectedNodeIds.splice(0, this.selectedNodeIds.length, ...nodeIds);
  }

  setPanelOpen(panel: string, open: boolean): void {
    if (open) this.openPanels.add(panel);
    else this.openPanels.delete(panel);
  }

  setPlayback(time: number, playing: boolean): void {
    this.playbackTime = time;
    this.playing = playing;
  }

  setRendererStatus(status: string): void {
    this.rendererStatus = status;
  }
}
