import { applyProjectCommand, type ProjectCommand } from './commands.js';
import { cloneProject, serializeProject } from './project.js';
import type { PixelfProject } from './types.js';
import { validateProject } from './validation.js';

const MAX_HISTORY_STATES = 50;
const MERGE_WINDOW_MILLISECONDS = 500;

export type EditorHistoryPosition = 'current' | 'future' | 'past';

export interface EditorHistoryItem {
  id: number;
  label: string;
  position: EditorHistoryPosition;
  saved: boolean;
  time: number;
}

interface HistoryState {
  id: number;
  label: string;
  mergeKey?: string;
  project: PixelfProject;
  selection: string[];
  time: number;
}

interface Transaction {
  before: PixelfProject;
  label: string;
}

export class EditorState {
  private current: PixelfProject;
  private historyCursor = 0;
  private mergeBlocked = false;
  private nextHistoryId = 1;
  private savedSource: string;
  private readonly states: HistoryState[];
  private transaction: Transaction | null = null;

  readonly selectedNodeIds: string[] = [];
  readonly openPanels = new Set<string>();
  playbackTime = 0;
  playing = false;
  rendererStatus = 'idle';

  constructor(project: PixelfProject, options: { initialLabel?: string; now?: number } = {}) {
    validateProject(project);
    this.current = cloneProject(project);
    this.savedSource = serializeProject(project);
    this.states = [
      {
        id: 0,
        label: options.initialLabel ?? 'Open composite',
        project: cloneProject(project),
        selection: [],
        time: options.now ?? Date.now(),
      },
    ];
  }

  get project(): PixelfProject {
    return this.current;
  }

  get dirty(): boolean {
    return serializeProject(this.current) !== this.savedSource;
  }

  get canUndo(): boolean {
    return this.historyCursor > 0;
  }

  get canRedo(): boolean {
    return this.historyCursor < this.states.length - 1;
  }

  get history(): readonly EditorHistoryItem[] {
    return this.states.map((state, index) => ({
      id: state.id,
      label: state.label,
      position:
        index === this.historyCursor ? 'current' : index < this.historyCursor ? 'past' : 'future',
      saved: serializeProject(state.project) === this.savedSource,
      time: state.time,
    }));
  }

  get currentHistoryId(): number {
    const state = this.states[this.historyCursor];
    if (state === undefined) throw new Error('History cursor is outside the state list');
    return state.id;
  }

  private appendState(label: string, project: PixelfProject, time: number): void {
    this.states.splice(this.historyCursor + 1);
    this.states.push({
      id: this.nextHistoryId++,
      label,
      project: cloneProject(project),
      selection: [...this.selectedNodeIds],
      time,
    });
    this.historyCursor = this.states.length - 1;
    const overflow = this.states.length - MAX_HISTORY_STATES;
    if (overflow > 0) {
      this.states.splice(0, overflow);
      this.historyCursor -= overflow;
    }
    this.mergeBlocked = false;
  }

  private restoreState(state: HistoryState): void {
    this.current = cloneProject(state.project);
    this.selectedNodeIds.splice(0, this.selectedNodeIds.length, ...state.selection);
    this.mergeBlocked = true;
  }

  dispatch(
    command: ProjectCommand,
    options: { label?: string; mergeKey?: string; now?: number } = {},
  ): void {
    if (this.transaction !== null) throw new Error('Dispatch is unavailable during a transaction');
    const after = applyProjectCommand(this.current, command);
    if (serializeProject(after) === serializeProject(this.current)) {
      this.current = after;
      return;
    }
    const time = options.now ?? Date.now();
    const previous = this.states[this.historyCursor];
    const canMerge =
      !this.mergeBlocked &&
      this.historyCursor === this.states.length - 1 &&
      options.mergeKey !== undefined &&
      previous?.mergeKey === options.mergeKey &&
      time - previous.time <= MERGE_WINDOW_MILLISECONDS;
    if (canMerge && previous !== undefined) {
      previous.label = options.label ?? command.type;
      previous.project = cloneProject(after);
      previous.selection = [...this.selectedNodeIds];
      previous.time = time;
    } else {
      this.appendState(options.label ?? command.type, after, time);
      const appended = this.states[this.historyCursor];
      if (appended !== undefined) appended.mergeKey = options.mergeKey;
    }
    this.current = after;
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
    this.appendState(transaction.label, this.current, now);
  }

  cancelTransaction(): void {
    if (this.transaction === null) throw new Error('No transaction is active');
    this.current = this.transaction.before;
    this.transaction = null;
  }

  undo(): boolean {
    if (this.transaction !== null) throw new Error('Undo is unavailable during a transaction');
    if (!this.canUndo) return false;
    this.historyCursor -= 1;
    const state = this.states[this.historyCursor];
    if (state === undefined) throw new Error('Undo history state is unavailable');
    this.restoreState(state);
    return true;
  }

  redo(): boolean {
    if (this.transaction !== null) throw new Error('Redo is unavailable during a transaction');
    if (!this.canRedo) return false;
    this.historyCursor += 1;
    const state = this.states[this.historyCursor];
    if (state === undefined) throw new Error('Redo history state is unavailable');
    this.restoreState(state);
    return true;
  }

  goToHistoryState(id: number): boolean {
    if (this.transaction !== null) throw new Error('History is unavailable during a transaction');
    const index = this.states.findIndex(state => state.id === id);
    if (index < 0) return false;
    const state = this.states[index];
    if (state === undefined) return false;
    this.historyCursor = index;
    this.restoreState(state);
    return true;
  }

  markSaved(): void {
    this.savedSource = serializeProject(this.current);
    this.mergeBlocked = true;
  }

  select(nodeIds: readonly string[]): void {
    this.selectedNodeIds.splice(0, this.selectedNodeIds.length, ...nodeIds);
    const currentState = this.states[this.historyCursor];
    if (currentState !== undefined) currentState.selection = [...nodeIds];
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
