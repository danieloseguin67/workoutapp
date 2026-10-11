import { CommonModule } from '@angular/common';
import { Component, HostListener, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import seedWorkoutsFr from './workouts.json';
import seedWorkoutsEn from './workouts.en.json';
import { I18N, I18nKey, Lang, LANGS } from './i18n';
import { DriveFile, GOOGLE_CLIENT_ID, GoogleDrive } from './google-drive';

interface Exercise { id: string; name: string; phase: string; seconds: number; rounds?: number; tip: string; video?: string; }
interface Workout { id: string; name: string; subtitle: string; duration: number; level: string; color: string; optional?: boolean; exercises: Exercise[]; }
interface Profile { name: string; age: number | null; objective: 'Remise en forme' | 'Force'; weightLoss: number | null; }
interface ExerciseLog { name: string; startedAt: string; endedAt: string; }
interface SessionLog { workoutName: string; startedAt: string; endedAt: string; exercises: ExerciseLog[]; }
interface RunExercise { exercise: Exercise; round: number; }
interface Settings { lang: Lang; autoSave: boolean; googleClientId?: string; }
type SaveFilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
interface AppData { workouts: Workout[]; logs: SessionLog[]; profile: Profile; }
interface Backup extends AppData { id: string; createdAt: string; }
interface ActiveSessionState { workout: Workout; exerciseIndex: number; remaining: number; sessionStartedAt: string; exerciseLogs: ExerciseLog[]; }
type View = 'home' | 'workouts' | 'history' | 'config';
interface AiRequest { duration: number; level: string; intensity: string; focus: string; impact: string; equipment: string; space: string; notes: string; }

// Phases, levels and objectives are stored with their canonical (French) values and translated for display.
const PHASES = ['Échauffement', 'Bloc principal', 'Retour au calme'];
const PHASE_KEYS: Record<string, I18nKey> = { 'Échauffement': 'phase.warmup', 'Bloc principal': 'phase.main', 'Retour au calme': 'phase.cooldown' };
const LEVELS = ['Débutant', 'Modéré', 'Avancé'];
const LEVEL_KEYS: Record<string, I18nKey> = { 'Débutant': 'level.beginner', 'Modéré': 'level.moderate', 'Avancé': 'level.advanced' };
const OBJECTIVE_KEYS: Record<string, I18nKey> = { 'Remise en forme': 'objective.fitness', 'Force': 'objective.strength' };
const COLORS = ['mint', 'peach', 'lavender', 'blue'];
const SEEDS: Record<Lang, Workout[]> = { fr: seedWorkoutsFr as Workout[], en: seedWorkoutsEn as Workout[] };
const KEYS = { workouts: 'mouvement.workouts', profile: 'mouvement.profile', logs: 'mouvement.logs', settings: 'mouvement.settings', backups: 'mouvement.backups', active: 'mouvement.activeSession' };
const DATA_KEYS = [KEYS.workouts, KEYS.profile, KEYS.logs, KEYS.active];
const MAX_BACKUPS = 10;
const PHASE_DEFAULT_VIDEOS = ['marche-active.mp4', 'course-sur-place.mp4', 'respiration.mp4'];
// English and French words mapped to the French tokens used in video file names.
const VIDEO_SYNONYMS: Record<string, string[]> = {
  walk: ['marche'], walking: ['marche'], march: ['marche'], marching: ['marche'], brisk: ['active'], slow: ['lente', 'lents'], stretch: ['etirement'], stretching: ['etirement'],
  jog: ['course'], jogging: ['course'], run: ['course'], running: ['course'], courir: ['course'], trot: ['course'], knee: ['knees'], genoux: ['knees', 'high'],
  jack: ['jacks'], butt: ['talons', 'fesses'], kick: ['talons', 'fesses'], kicks: ['talons', 'fesses'], heel: ['talons'], heels: ['talons'], side: ['lateraux'], lateral: ['lateraux'], shuffle: ['lateraux', 'pas'],
  shoulder: ['epaules'], shoulders: ['epaules'], arm: ['bras'], arms: ['bras'], hip: ['hanches'], hips: ['hanches'], calf: ['mollets', 'pointe'], calves: ['mollets'], hamstring: ['ischios'], hamstrings: ['ischios'],
  quad: ['quadriceps'], quads: ['quadriceps'], back: ['dos'], leg: ['jambes'], legs: ['jambes'], breathing: ['respiration'], breath: ['respiration'], breathe: ['respiration'], respirer: ['respiration'],
  plank: ['planche'], pushup: ['planche'], push: ['planche'], pompes: ['planche'], climber: ['climbers', 'mountain'], recovery: ['recuperation'], rest: ['recuperation'], pause: ['recuperation'],
  twist: ['rotation', 'tronc'], torso: ['tronc'], trunk: ['tronc'], circles: ['cercles'], circle: ['cercles'], mobility: ['mobilite'], wave: ['ondule'], dance: ['ondule', 'code'], danse: ['ondule', 'code'],
  raise: ['pointe'], toe: ['pointe'], toes: ['pointe'], squats: ['squat'], lunge: ['squat'], fentes: ['squat'], stair: ['step', 'montee', 'marche'], up: ['up'], skater: ['lateraux'], boxing: ['course'], boxe: ['course'], punch: ['course'], cool: ['marche', 'lente']
};

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.component.html' })
export class AppComponent implements OnInit, OnDestroy {
  readonly langs = LANGS;
  readonly phases = PHASES;
  readonly levels = LEVELS;
  readonly colors = COLORS;
  readonly objectives = Object.keys(OBJECTIVE_KEYS);
  readonly aiOptions = {
    intensity: ['gentle', 'moderate', 'sustained', 'hiit'], focus: ['general', 'burn', 'endurance', 'strength', 'dance', 'walk'],
    impact: ['low', 'medium', 'jumps'], equipment: ['none', 'chair', 'step', 'wall', 'all'], space: ['small', 'medium', 'large']
  };
  settings: Settings = { lang: 'fr', autoSave: true };
  workouts: Workout[] = [];
  profile: Profile = { name: 'Alex', age: null, objective: 'Remise en forme', weightLoss: null };
  logs: SessionLog[] = [];
  backups: Backup[] = [];
  dirty = false;
  storagePersisted = false;
  canShareFiles = false;
  readonly canSaveAs = typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  private readonly zone = inject(NgZone);
  readonly drive = new GoogleDrive(fn => this.zone.run(fn));
  driveFiles: DriveFile[] = [];
  driveBusy = false;
  driveError = '';
  clientIdDraft = '';
  view: View = 'home';
  videoLibrary: string[] = [];
  previewVideo: string | null = null;
  modal: 'profile' | 'workout' | 'ai' | null = null;
  aiRequest: AiRequest = this.blankAiRequest();
  aiPrompt = '';
  aiResponse = '';
  aiError = '';
  aiPreview: Workout | null = null;
  aiGuessedVideos = new Set<string>();
  aiCopied = false;
  editingId: string | null = null;
  draft: Workout = this.blankWorkout();
  activeWorkout: Workout | null = null;
  runExercises: RunExercise[] = [];
  exerciseIndex = 0;
  currentRound = 1;
  running = false;
  remaining = 0;
  sessionStartedAt = '';
  exerciseStartedAt = '';
  exerciseLogs: ExerciseLog[] = [];
  notice = '';
  private intervalId: number | undefined;
  private noticeTimeout: number | undefined;

  get lang(): Lang { return this.settings.lang; }
  get locale(): string { return this.lang === 'fr' ? 'fr-CA' : 'en-CA'; }

  ngOnInit(): void {
    const stored = this.load<Partial<Settings>>(KEYS.settings, {});
    this.settings = { lang: stored.lang === 'en' ? 'en' : 'fr', autoSave: stored.autoSave !== false, googleClientId: typeof stored.googleClientId === 'string' ? stored.googleClientId : '' };
    this.clientIdDraft = this.settings.googleClientId ?? '';
    try { this.canShareFiles = !!navigator.canShare?.({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] }); } catch { this.canShareFiles = false; }
    this.workouts = this.load(KEYS.workouts, SEEDS[this.lang]);
    this.profile = this.load(KEYS.profile, this.profile);
    this.logs = this.load(KEYS.logs, []);
    this.backups = this.load(KEYS.backups, []);
    if (this.attachMissingVideos()) this.save(KEYS.workouts, this.workouts);
    this.applyDocumentLang();
    this.restoreActiveSession();
    navigator.storage?.persisted?.().then(value => this.storagePersisted = value).catch(() => undefined);
    fetch('videos/index.json').then(response => response.ok ? response.json() : []).then((files: unknown) => { if (Array.isArray(files)) this.videoLibrary = files.filter((file): file is string => typeof file === 'string'); }).catch(() => this.videoLibrary = []);
  }
  ngOnDestroy(): void { this.stopClock(); if (this.noticeTimeout) window.clearTimeout(this.noticeTimeout); }
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void { if (this.dirty) { event.preventDefault(); event.returnValue = this.t('confirm.unsaved'); } }

  // ---------- i18n ----------
  t(key: I18nKey, params?: Record<string, string | number>): string {
    let text = I18N[this.lang][key] ?? I18N.fr[key] ?? key;
    if (params) for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
    return text;
  }
  phaseLabel(phase: string): string { return PHASE_KEYS[phase] ? this.t(PHASE_KEYS[phase]) : phase; }
  levelLabel(level: string): string { return LEVEL_KEYS[level] ? this.t(LEVEL_KEYS[level]) : level; }
  objectiveLabel(objective: string): string { return OBJECTIVE_KEYS[objective] ? this.t(OBJECTIVE_KEYS[objective]) : objective; }
  colorLabel(color: string): string { return this.t(`color.${color}` as I18nKey); }
  aiOptionLabel(group: keyof AppComponent['aiOptions'], value: string): string { return this.t(`ai.${group}.${value}` as I18nKey); }
  setLang(lang: Lang): void {
    if (lang === this.lang) return;
    const previous = this.lang;
    this.settings = { ...this.settings, lang };
    this.writeKey(KEYS.settings, this.settings);
    // Untouched default workouts follow the selected language; user-edited workouts are kept as-is.
    if (JSON.stringify(this.workouts) === JSON.stringify(SEEDS[previous])) { this.workouts = structuredClone(SEEDS[lang]); this.save(KEYS.workouts, this.workouts); }
    this.applyDocumentLang();
    if (this.aiPrompt) this.buildAiPrompt();
    this.aiError = '';
  }
  private applyDocumentLang(): void { document.documentElement.lang = this.lang; document.title = this.t('app.title'); }

  // ---------- storage ----------
  private load<T>(key: string, fallback: T): T { try { const data = localStorage.getItem(key); return data ? JSON.parse(data) as T : structuredClone(fallback); } catch { return structuredClone(fallback); } }
  private writeKey(key: string, value: unknown): boolean {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { this.toast(this.t('toast.storageFull')); return false; }
  }
  /** Saves user data; when auto-save is off, data stays in memory until "Save now". */
  private save(key: string, value: unknown): void {
    if (!this.settings.autoSave && DATA_KEYS.includes(key)) { this.dirty = true; return; }
    this.writeKey(key, value);
  }
  private persistAll(): void {
    this.save(KEYS.workouts, this.workouts); this.save(KEYS.logs, this.logs); this.save(KEYS.profile, this.profile); this.save(KEYS.active, this.activeSessionState());
  }
  saveNow(): void {
    const ok = [this.writeKey(KEYS.workouts, this.workouts), this.writeKey(KEYS.logs, this.logs), this.writeKey(KEYS.profile, this.profile), this.writeKey(KEYS.active, this.activeSessionState())].every(Boolean);
    if (ok) { this.dirty = false; this.toast(this.t('toast.saved')); }
  }
  toggleAutoSave(enabled: boolean): void {
    this.settings = { ...this.settings, autoSave: enabled };
    this.writeKey(KEYS.settings, this.settings);
    if (enabled) { this.saveNow(); this.toast(this.t('toast.autoOn')); } else this.toast(this.t('toast.autoOff'));
  }
  get storageUsed(): string {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith('mouvement.')) chars += key.length + (localStorage.getItem(key)?.length ?? 0); }
    const bytes = chars * 2;
    return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
  }
  async requestPersistentStorage(): Promise<void> {
    try { this.storagePersisted = (await navigator.storage?.persist?.()) ?? false; } catch { this.storagePersisted = false; }
    this.toast(this.t(this.storagePersisted ? 'toast.persistOk' : 'toast.persistNo'));
  }
  private snapshot(): AppData { return structuredClone({ workouts: this.workouts, logs: this.logs, profile: this.profile }); }
  private applyData(data: AppData): void {
    this.workouts = data.workouts; this.logs = data.logs; this.profile = { ...this.profile, ...data.profile };
    this.attachMissingVideos(); this.persistAll();
  }
  createBackup(): void {
    const backup: Backup = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...this.snapshot() };
    const backups = [backup, ...this.backups].slice(0, MAX_BACKUPS);
    if (this.writeKey(KEYS.backups, backups)) { this.backups = backups; this.toast(this.t('toast.backupCreated')); }
  }
  restoreBackup(backup: Backup): void {
    if (!window.confirm(this.t('confirm.restoreBackup'))) return;
    this.applyData(structuredClone({ workouts: backup.workouts, logs: backup.logs, profile: backup.profile })); this.toast(this.t('toast.backupRestored'));
  }
  deleteBackup(backup: Backup): void {
    if (!window.confirm(this.t('confirm.deleteBackup'))) return;
    this.backups = this.backups.filter(item => item.id !== backup.id); this.writeKey(KEYS.backups, this.backups); this.toast(this.t('toast.backupDeleted'));
  }
  dateTime(iso: string): string { return new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
  private backupPayload(): string {
    return JSON.stringify({ app: 'mouvement', version: 1, exportedAt: new Date().toISOString(), settings: { lang: this.settings.lang, autoSave: this.settings.autoSave }, ...this.snapshot() }, null, 2);
  }
  private backupFileName(): string { return `mouvement-backup-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json`; }
  exportAll(): void { this.downloadText(this.backupPayload(), this.backupFileName()); this.toast(this.t('toast.exported')); }
  async saveAsFile(): Promise<void> {
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (!picker) { this.exportAll(); return; }
    try {
      const handle = await picker({ suggestedName: this.backupFileName(), types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
      const writable = await handle.createWritable();
      await writable.write(new Blob([this.backupPayload()], { type: 'application/json' })); await writable.close();
      this.toast(this.t('toast.exported'));
    } catch (error) { if ((error as DOMException)?.name !== 'AbortError') this.toast(this.t('toast.exportFailed')); }
  }
  async shareBackup(): Promise<void> {
    const file = new File([this.backupPayload()], this.backupFileName(), { type: 'application/json' });
    try { await navigator.share({ files: [file], title: 'Mouvement' }); }
    catch (error) { if ((error as DOMException)?.name !== 'AbortError') { this.exportAll(); } }
  }
  openGoogleDriveSite(): void { window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener'); }
  importAll(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { this.importBackupText(String(reader.result)); input.value = ''; };
    reader.readAsText(file);
  }
  private importBackupText(text: string): boolean {
    try {
      const parsed = JSON.parse(text) as Partial<AppData & { app: string; settings: Partial<Settings> }>;
      if (!parsed || parsed.app !== 'mouvement' || !this.isWorkoutList(parsed.workouts) || !Array.isArray(parsed.logs ?? []) || typeof (parsed.profile ?? {}) !== 'object') throw new Error('invalid');
      if (!window.confirm(this.t('confirm.importAll'))) return false;
      this.applyData({ workouts: parsed.workouts, logs: (parsed.logs ?? []) as SessionLog[], profile: (parsed.profile ?? this.profile) as Profile });
      if (parsed.settings?.lang === 'fr' || parsed.settings?.lang === 'en') this.setLang(parsed.settings.lang);
      this.toast(this.t('toast.allImported'));
      return true;
    } catch { this.toast(this.t('toast.badBackup')); return false; }
  }

  // ---------- Google Drive ----------
  get googleClientId(): string { return (this.settings.googleClientId || GOOGLE_CLIENT_ID).trim(); }
  get originUrl(): string { return location.origin; }
  saveClientId(): void {
    const value = this.clientIdDraft.trim();
    if (value && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(value)) { this.driveError = this.t('drive.badClientId'); return; }
    this.driveError = '';
    if (!value) this.drive.disconnect();
    this.settings = { ...this.settings, googleClientId: value }; this.writeKey(KEYS.settings, this.settings);
    this.toast(this.t(value ? 'drive.clientSaved' : 'drive.clientRemoved'));
  }
  private async driveTask(task: () => Promise<void>): Promise<void> {
    this.driveBusy = true; this.driveError = '';
    try {
      if (!this.drive.connected) await this.drive.connect(this.googleClientId);
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.driveError = this.t('drive.error', { detail: message === 'not-connected' ? this.t('drive.expired') : message });
    } finally { this.zone.run(() => { this.driveBusy = false; }); }
  }
  connectDrive(): Promise<void> { return this.driveTask(async () => { this.driveFiles = await this.drive.list(); this.toast(this.t('drive.connected')); }); }
  disconnectDrive(): void { this.drive.disconnect(); this.driveFiles = []; this.toast(this.t('drive.disconnected')); }
  refreshDrive(): Promise<void> { return this.driveTask(async () => { this.driveFiles = await this.drive.list(); }); }
  saveToDrive(): Promise<void> {
    return this.driveTask(async () => {
      const file = await this.drive.upload(this.backupFileName(), this.backupPayload());
      this.driveFiles = [file, ...this.driveFiles.filter(item => item.id !== file.id)];
      this.toast(this.t('drive.saved', { name: file.name }));
    });
  }
  restoreFromDrive(file: DriveFile): Promise<void> { return this.driveTask(async () => { this.importBackupText(await this.drive.download(file.id)); }); }
  deleteFromDrive(file: DriveFile): Promise<void> {
    if (!window.confirm(this.t('drive.confirmDelete', { name: file.name }))) return Promise.resolve();
    return this.driveTask(async () => { await this.drive.remove(file.id); this.driveFiles = this.driveFiles.filter(item => item.id !== file.id); this.toast(this.t('drive.deleted')); });
  }
  fileSize(size?: string): string { const bytes = Number(size ?? 0); return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
  clearAllData(): void {
    if (!window.confirm(this.t('confirm.clear'))) return;
    this.stopClock(); this.activeWorkout = null; this.running = false;
    Object.values(KEYS).filter(key => key !== KEYS.settings).forEach(key => localStorage.removeItem(key));
    this.workouts = structuredClone(SEEDS[this.lang]); this.logs = []; this.backups = []; this.profile = { name: 'Alex', age: null, objective: 'Remise en forme', weightLoss: null };
    this.dirty = false; this.persistAll(); this.toast(this.t('toast.cleared'));
  }
  clearHistory(): void {
    if (!window.confirm(this.t('confirm.clearHistory'))) return;
    this.logs = []; this.save(KEYS.logs, this.logs); this.toast(this.t('toast.historyCleared'));
  }
  private download(value: unknown, fileName: string): void { this.downloadText(JSON.stringify(value, null, 2), fileName); }
  private downloadText(text: string, fileName: string): void {
    const file = new Blob([text], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(file); link.download = fileName; link.click(); URL.revokeObjectURL(link.href);
  }
  private isWorkoutList(value: unknown): value is Workout[] {
    return Array.isArray(value) && value.every(item => typeof item === 'object' && item !== null && typeof (item as Workout).name === 'string' && Array.isArray((item as Workout).exercises));
  }

  // ---------- videos ----------
  private attachMissingVideos(): boolean {
    const byName = this.videoByExerciseName;
    let changed = false;
    for (const exercise of this.workouts.flatMap(workout => workout.exercises)) {
      if (exercise.video === undefined) { const match = byName.get(this.normalizeName(exercise.name)); if (match) { exercise.video = match; changed = true; } }
    }
    return changed;
  }
  videoUrl(file: string | undefined | null): string { return file ? 'videos/' + encodeURIComponent(file) : ''; }
  videoUsage(file: string): number { return this.workouts.reduce((count, workout) => count + workout.exercises.filter(exercise => exercise.video === file).length, 0); }
  get missingVideoCount(): number { return this.workouts.flatMap(workout => workout.exercises).filter(exercise => !exercise.video).length; }
  get totalExercises(): number { return this.workouts.reduce((sum, workout) => sum + workout.exercises.length, 0); }
  private slug(value: string): string { return this.normalizeName(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  suggestVideo(exercise: Exercise): void {
    if (exercise.video || !exercise.name.trim()) return;
    const guess = this.resolveVideo(exercise.name, exercise.phase, undefined);
    if (guess.video && !guess.guessed) exercise.video = guess.video;
  }
  private normalizeName(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim(); }
  private get videoByExerciseName(): Map<string, string> {
    const map = new Map<string, string>();
    for (const exercise of [...SEEDS.fr, ...SEEDS.en, ...this.workouts].flatMap(workout => workout.exercises)) if (exercise.video && !map.has(this.normalizeName(exercise.name))) map.set(this.normalizeName(exercise.name), exercise.video);
    return map;
  }
  /** Display name of the movement shown in each video, in the current language. */
  private get videoDescriptions(): Map<string, string> {
    const map = new Map<string, string>();
    for (const exercise of SEEDS[this.lang].flatMap(workout => workout.exercises)) if (exercise.video && !map.has(exercise.video)) map.set(exercise.video, exercise.name);
    return map;
  }
  private tokens(value: string): string[] {
    const words = this.normalizeName(value).split(/[^a-z0-9]+/).filter(word => word.length > 1);
    return [...new Set(words.flatMap(word => [word, word.replace(/s$/, ''), ...(VIDEO_SYNONYMS[word] ?? VIDEO_SYNONYMS[word.replace(/s$/, '')] ?? [])]))];
  }
  /** Picks an MP4 for an exercise: ChatGPT's choice, then name match, then keyword similarity, then a default per phase. */
  private resolveVideo(name: string, phase: string, suggested: unknown): { video?: string; guessed: boolean } {
    const library = this.videoLibrary;
    if (!library.length) return { guessed: false };
    if (typeof suggested === 'string' && suggested.trim()) {
      const file = suggested.trim().split(/[\\/]/).pop()!.toLowerCase();
      const candidate = file.endsWith('.mp4') ? file : file + '.mp4';
      const match = library.find(item => item.toLowerCase() === candidate || item.toLowerCase() === this.slug(file.replace(/\.mp4$/, '')) + '.mp4');
      if (match) return { video: match, guessed: false };
    }
    const byName = this.videoByExerciseName.get(this.normalizeName(name));
    if (byName && library.includes(byName)) return { video: byName, guessed: false };
    const slug = this.slug(name) + '.mp4';
    if (library.includes(slug)) return { video: slug, guessed: false };
    const wanted = new Set(this.tokens(name));
    const described = new Map<string, string[]>();
    for (const exercise of [...SEEDS.fr, ...SEEDS.en].flatMap(workout => workout.exercises)) if (exercise.video) described.set(exercise.video, [...(described.get(exercise.video) ?? []), exercise.name]);
    let best: { file: string; score: number } | null = null;
    for (const file of library) {
      const fileTokens = new Set([...this.tokens(file.replace(/\.mp4$/, '').replace(/-/g, ' ')), ...(described.get(file) ?? []).flatMap(label => this.tokens(label))]);
      const score = [...wanted].filter(token => fileTokens.has(token)).length;
      if (score > 0 && (!best || score > best.score)) best = { file, score };
    }
    if (best) return { video: best.file, guessed: true };
    const fallback = PHASE_DEFAULT_VIDEOS[Math.max(0, PHASES.indexOf(phase))];
    return { video: library.includes(fallback) ? fallback : library[0], guessed: true };
  }

  // ---------- workouts ----------
  duplicateWorkout(workout: Workout): void {
    const copy: Workout = { ...structuredClone(workout), id: crypto.randomUUID(), name: workout.name + this.t('toast.copySuffix') };
    copy.exercises = copy.exercises.map(exercise => ({ ...exercise, id: crypto.randomUUID() }));
    this.workouts = [...this.workouts, copy]; this.save(KEYS.workouts, this.workouts); this.toast(this.t('toast.duplicated'));
  }
  moveWorkout(index: number, delta: number): void {
    const target = index + delta; if (target < 0 || target >= this.workouts.length) return;
    const list = [...this.workouts]; [list[index], list[target]] = [list[target], list[index]];
    this.workouts = list; this.save(KEYS.workouts, this.workouts);
  }
  resetWorkouts(): void {
    if (!window.confirm(this.t('confirm.reset'))) return;
    this.workouts = structuredClone(SEEDS[this.lang]); this.save(KEYS.workouts, this.workouts); this.toast(this.t('toast.restored'));
  }
  private blankWorkout(): Workout { return { id: '', name: '', subtitle: '', duration: 20, level: LEVELS[0], color: 'mint', exercises: [{ id: crypto.randomUUID(), name: '', phase: PHASES[1], seconds: 45, tip: '' }] }; }
  openNewWorkout(): void { this.editingId = null; this.draft = this.blankWorkout(); this.modal = 'workout'; }
  openEditWorkout(workout: Workout): void { this.editingId = workout.id; this.draft = structuredClone(workout); this.modal = 'workout'; }
  addExercise(): void { this.draft.exercises.push({ id: crypto.randomUUID(), name: '', phase: PHASES[1], seconds: 45, tip: '' }); }
  removeExercise(index: number): void { if (this.draft.exercises.length > 1) this.draft.exercises.splice(index, 1); }
  saveWorkout(): void {
    const clean = structuredClone(this.draft);
    clean.name = clean.name.trim();
    if (!clean.name || clean.exercises.some(exercise => !exercise.name.trim())) { this.toast(this.t('toast.needNames')); return; }
    clean.id = this.editingId ?? crypto.randomUUID();
    clean.exercises = clean.exercises.map(exercise => ({ ...exercise, id: exercise.id || crypto.randomUUID(), name: exercise.name.trim(), seconds: Math.max(10, Number(exercise.seconds) || 45), tip: exercise.tip.trim(), video: exercise.video?.trim() || undefined }));
    if (this.editingId) this.workouts = this.workouts.map(workout => workout.id === this.editingId ? clean : workout);
    else this.workouts = [...this.workouts, clean];
    this.save(KEYS.workouts, this.workouts); this.modal = null; this.toast(this.t(this.editingId ? 'toast.edited' : 'toast.created'));
  }
  deleteWorkout(workout: Workout): void {
    if (!window.confirm(this.t('confirm.delete', { name: workout.name }))) return;
    this.workouts = this.workouts.filter(item => item.id !== workout.id); this.save(KEYS.workouts, this.workouts); this.toast(this.t('toast.deleted'));
  }
  exportWorkouts(): void { this.download(this.workouts, this.lang === 'fr' ? 'mes-seances-mouvement.json' : 'my-mouvement-workouts.json'); }
  importWorkouts(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        if (!this.isWorkoutList(parsed)) throw new Error('invalid');
        this.workouts = parsed; this.attachMissingVideos(); this.save(KEYS.workouts, this.workouts); this.toast(this.t('toast.imported'));
      } catch { this.toast(this.t('toast.badImport')); }
      input.value = '';
    };
    reader.readAsText(file);
  }

  // ---------- ChatGPT assistant ----------
  private blankAiRequest(): AiRequest { return { duration: 20, level: LEVELS[0], intensity: 'gentle', focus: 'general', impact: 'low', equipment: 'none', space: 'small', notes: '' }; }
  openAiAssistant(): void { this.aiPrompt = ''; this.aiResponse = ''; this.aiError = ''; this.aiPreview = null; this.aiCopied = false; this.modal = 'ai'; }
  buildAiPrompt(): void {
    const r = this.aiRequest; const p = this.profile;
    const library = this.videoLibrary.length ? this.videoLibrary : [...new Set([...this.videoDescriptions.keys()])];
    const descriptions = this.videoDescriptions;
    const example = { name: this.t('prompt.exName'), subtitle: this.t('prompt.exSubtitle'), duration: r.duration, level: this.levelLabel(r.level), color: 'mint', exercises: [
      { name: descriptions.get('marche-active.mp4') ?? 'Marche active', phase: this.phaseLabel(PHASES[0]), seconds: 60, tip: this.t('prompt.exTip'), video: 'marche-active.mp4' },
      { name: descriptions.get('jumping-jacks-doux.mp4') ?? 'Jumping jacks', phase: this.phaseLabel(PHASES[1]), seconds: 45, rounds: 3, tip: this.t('prompt.exTip'), video: 'jumping-jacks-doux.mp4' },
      { name: descriptions.get('etirement-quadriceps.mp4') ?? 'Quad stretch', phase: this.phaseLabel(PHASES[2]), seconds: 60, tip: this.t('prompt.exTip'), video: 'etirement-quadriceps.mp4' }] };
    this.aiPrompt = [
      this.t('prompt.intro'),
      '', this.t('prompt.profile'),
      ...(p.age ? [this.t('prompt.age', { age: p.age })] : []), this.t('prompt.objective', { objective: this.objectiveLabel(p.objective) }), ...(p.weightLoss ? [this.t('prompt.weight', { kg: p.weightLoss })] : []),
      '', this.t('prompt.prefs'),
      this.t('prompt.duration', { value: r.duration }), this.t('prompt.level', { value: this.levelLabel(r.level) }),
      this.t('prompt.intensity', { value: this.aiOptionLabel('intensity', r.intensity) }), this.t('prompt.focus', { value: this.aiOptionLabel('focus', r.focus) }),
      this.t('prompt.impact', { value: this.aiOptionLabel('impact', r.impact) }), this.t('prompt.equipment', { value: this.aiOptionLabel('equipment', r.equipment) }),
      this.t('prompt.space', { value: this.aiOptionLabel('space', r.space) }),
      ...(r.notes.trim() ? [this.t('prompt.notes', { value: r.notes.trim() })] : []),
      '', this.t('prompt.rules'),
      this.t('prompt.rulePhases'), this.t('prompt.ruleRounds'), this.t('prompt.ruleTotal', { value: r.duration }), this.t('prompt.ruleSeconds'), this.t('prompt.ruleTip'), this.t('prompt.ruleLevel'), this.t('prompt.ruleVideo'),
      '', this.t('prompt.videoList'),
      ...library.map(file => `- ${file}${descriptions.has(file) ? ' → ' + descriptions.get(file) : ''}`),
      '', this.t('prompt.answer'), this.t('prompt.answerRules'),
      '```json', JSON.stringify(example, null, 2), '```'
    ].join('\n');
    this.aiCopied = false;
  }
  async copyAiPrompt(): Promise<void> {
    if (!this.aiPrompt) this.buildAiPrompt();
    this.aiCopied = true;
    try { await navigator.clipboard.writeText(this.aiPrompt); }
    catch {
      const area = document.createElement('textarea'); area.value = this.aiPrompt; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    this.toast(this.t('toast.copied'));
  }
  openChatGpt(): void { window.open('https://chatgpt.com/', '_blank', 'noopener'); }
  private extractJson(text: string): { data: unknown } | { error: string } {
    const clean = text.replace(/^\uFEFF/, '').replace(/[\u00A0\u202F\u2007]/g, ' ').replace(/[\u200B-\u200D\u2060]/g, '');
    const candidates: string[] = [];
    for (const m of clean.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)) candidates.push(m[1]);
    const unclosed = /```[a-zA-Z]*\s*([\s\S]*)$/.exec(clean.replace(/```[a-zA-Z]*\s*[\s\S]*?```/g, ''));
    if (unclosed) candidates.push(unclosed[1]);
    candidates.push(clean);
    const sliced = candidates.map(c => {
      const start = c.search(/[[{]/); const end = Math.max(c.lastIndexOf('}'), c.lastIndexOf(']'));
      return start >= 0 && end > start ? c.slice(start, end + 1) : '';
    }).filter(Boolean);
    // Each repair step is applied cumulatively; parsing is retried after every step.
    const repairs: ((s: string) => string)[] = [
      s => s,
      // Markdown-escaped characters (\[ \] \_ \* …) copied from the ChatGPT interface.
      s => s.replace(/\\(["\\/bfnrtu])|\\/g, (_m, keep?: string) => keep ? '\\' + keep : ''),
      s => s.replace(/[“”«»„]/g, '"').replace(/[‘’‚]/g, "'"),
      s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"\\])\/\/[^\n]*/g, '$1'),
      s => s.replace(/,\s*([}\]])/g, '$1'),
      s => s.replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":'),
      s => s.replace(/'((?:[^'\\\n]|\\.)*)'(?=\s*[:,}\]])/g, (_m, v: string) => JSON.stringify(v.replace(/\\'/g, "'"))),
      s => s.replace(/}\s*{/g, '},{').replace(/]\s*\[/g, '],['),
    ];
    let firstError = '';
    for (const candidate of sliced) {
      let s = candidate;
      for (const repair of repairs) {
        s = repair(s);
        try { return { data: JSON.parse(s) }; }
        catch (e) { if (!firstError) firstError = e instanceof Error ? e.message : String(e); }
      }
    }
    return { error: firstError || this.t('error.noJsonBlock') };
  }
  private canonicalPhase(value: unknown): string {
    const text = this.normalizeName(String(value ?? ''));
    if (text.includes('chauff') || text.includes('warm')) return PHASES[0];
    if (text.includes('calme') || text.includes('retour') || text.includes('cool')) return PHASES[2];
    return PHASES[1];
  }
  private canonicalLevel(value: unknown): string | null {
    const text = this.normalizeName(String(value ?? ''));
    if (text.startsWith('deb') || text.startsWith('begin')) return LEVELS[0];
    if (text.startsWith('mod') || text.startsWith('inter')) return LEVELS[1];
    if (text.startsWith('ava') || text.startsWith('adv')) return LEVELS[2];
    return null;
  }
  parseAiResponse(): void {
    this.aiError = ''; this.aiPreview = null; this.aiGuessedVideos = new Set();
    const text = this.aiResponse.trim();
    if (!text) { this.aiError = this.t('error.empty'); return; }
    const result = this.extractJson(text);
    if ('error' in result) { this.aiError = this.t('error.invalidJson', { detail: result.error }); return; }
    let data: unknown = result.data;
    if (Array.isArray(data)) data = data[0];
    if (data && typeof data === 'object' && 'workout' in data) data = (data as { workout: unknown }).workout;
    const raw = data as Partial<Record<string, unknown>> | null;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw['exercises']) || !raw['exercises'].length) { this.aiError = this.t('error.noExercisesList'); return; }
    const exercises: Exercise[] = [];
    for (const item of raw['exercises'] as Record<string, unknown>[]) {
      const name = typeof item?.['name'] === 'string' ? item['name'].trim() : '';
      if (!name) continue;
      const phase = this.canonicalPhase(item['phase']);
      const seconds = Math.min(600, Math.max(10, Math.round(Number(item['seconds']) || 45)));
      const rounds = phase === PHASES[1] ? Math.min(10, Math.max(1, Math.round(Number(item['rounds']) || 1))) : undefined;
      const { video, guessed } = this.resolveVideo(name, phase, item['video']);
      const id = crypto.randomUUID();
      if (guessed) this.aiGuessedVideos.add(id);
      exercises.push({ id, name, phase, seconds, ...(rounds ? { rounds } : {}), tip: typeof item['tip'] === 'string' ? item['tip'].trim() : '', ...(video ? { video } : {}) });
    }
    if (!exercises.length) { this.aiError = this.t('error.noExercises'); return; }
    const mainRounds = Math.max(1, ...exercises.filter(e => e.phase === PHASES[1]).map(e => e.rounds ?? 1));
    exercises.forEach(e => { if (e.phase === PHASES[1]) e.rounds = mainRounds; });
    this.aiPreview = {
      id: '', name: typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim() : this.t('ai.defaultName'),
      subtitle: typeof raw['subtitle'] === 'string' ? raw['subtitle'].trim() : this.t('ai.defaultSubtitle'),
      duration: Math.max(1, Math.round(Number(raw['duration']) || this.aiRequest.duration)),
      level: this.canonicalLevel(raw['level']) ?? this.aiRequest.level,
      color: COLORS.includes(String(raw['color'])) ? String(raw['color']) : COLORS[this.workouts.length % COLORS.length],
      exercises
    };
  }
  estimatedMinutes(workout: Workout): number {
    const rounds = Math.max(1, ...workout.exercises.filter(e => e.phase === PHASES[1]).map(e => e.rounds ?? 1));
    return Math.round(workout.exercises.reduce((sum, e) => sum + e.seconds * (e.phase === PHASES[1] ? rounds : 1), 0) / 60);
  }
  previewPhase(phase: string): Exercise[] { return this.aiPreview?.exercises.filter(e => e.phase === phase) ?? []; }
  get aiPreviewRounds(): number { return this.aiPreview ? Math.max(1, ...this.previewPhase(PHASES[1]).map(e => e.rounds ?? 1)) : 1; }
  get aiPreviewVideoCount(): number { return this.aiPreview?.exercises.filter(e => e.video).length ?? 0; }
  acceptAiWorkout(): void {
    if (!this.aiPreview) return;
    const workout = { ...structuredClone(this.aiPreview), id: crypto.randomUUID() };
    this.workouts = [...this.workouts, workout]; this.save(KEYS.workouts, this.workouts);
    this.modal = null; this.view = 'workouts'; this.toast(this.t('toast.added', { name: workout.name }));
  }
  editAiWorkout(): void { if (!this.aiPreview) return; this.editingId = null; this.draft = structuredClone(this.aiPreview); this.modal = 'workout'; }

  // ---------- profile & stats ----------
  get firstName(): string { return this.profile.name.trim().split(/\s+/)[0] || this.t('profile.you'); }
  get completedSessions(): number { return this.logs.length; }
  get totalMinutes(): number { return Math.round(this.logs.reduce((sum, log) => sum + (Date.parse(log.endedAt) - Date.parse(log.startedAt)) / 60000, 0)); }
  get recentLogs(): SessionLog[] { return [...this.logs].reverse(); }
  get todayLabel(): string { return new Intl.DateTimeFormat(this.locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()); }
  setView(view: View): void { this.view = view; this.previewVideo = null; }
  openProfile(): void { this.modal = 'profile'; }
  saveProfile(): void { this.save(KEYS.profile, this.profile); this.modal = null; this.toast(this.t('toast.profile')); }

  // ---------- session runner ----------
  get activeExercise(): Exercise | null { return this.runExercises[this.exerciseIndex]?.exercise ?? null; }
  get activeWorkoutRounds(): number { return Math.max(1, ...(this.activeWorkout?.exercises.filter(item => item.phase === PHASES[1]).map(item => item.rounds ?? 1) ?? [])); }
  get progress(): number { return this.runExercises.length ? Math.round((this.exerciseIndex / this.runExercises.length) * 100) : 0; }
  get nextExercise(): Exercise | null { return this.runExercises[this.exerciseIndex + 1]?.exercise ?? null; }
  private buildRun(workout: Workout): RunExercise[] {
    const warmup = workout.exercises.filter(exercise => exercise.phase === PHASES[0]);
    const main = workout.exercises.filter(exercise => exercise.phase === PHASES[1]);
    const cooldown = workout.exercises.filter(exercise => exercise.phase === PHASES[2]);
    const rounds = Math.max(1, ...main.map(exercise => exercise.rounds ?? 1));
    const run = [...warmup.map(exercise => ({ exercise, round: 0 })), ...Array.from({ length: rounds }, (_, round) => main.map(exercise => ({ exercise, round: round + 1 }))).flat(), ...cooldown.map(exercise => ({ exercise, round: 0 }))];
    return run.length ? run : workout.exercises.map(exercise => ({ exercise, round: 0 }));
  }
  startWorkout(workout: Workout): void {
    if (!workout.exercises.length) return;
    this.activeWorkout = structuredClone(workout); this.exerciseIndex = 0; this.exerciseLogs = []; this.running = false;
    this.runExercises = this.buildRun(this.activeWorkout);
    this.currentRound = this.runExercises[0].round;
    this.remaining = this.activeExercise?.seconds ?? 45; this.sessionStartedAt = new Date().toISOString(); this.exerciseStartedAt = ''; this.view = 'home';
    this.persistActiveSession();
  }
  private activeSessionState(): ActiveSessionState | null {
    return this.activeWorkout ? { workout: this.activeWorkout, exerciseIndex: this.exerciseIndex, remaining: this.remaining, sessionStartedAt: this.sessionStartedAt, exerciseLogs: this.exerciseLogs } : null;
  }
  private persistActiveSession(): void { this.save(KEYS.active, this.activeSessionState()); }
  private restoreActiveSession(): void {
    const state = this.load<ActiveSessionState | null>(KEYS.active, null);
    if (!state?.workout?.exercises?.length) return;
    this.activeWorkout = state.workout; this.runExercises = this.buildRun(state.workout);
    this.exerciseIndex = Math.min(Math.max(0, state.exerciseIndex), this.runExercises.length - 1);
    this.currentRound = this.runExercises[this.exerciseIndex].round;
    this.remaining = state.remaining > 0 ? state.remaining : this.activeExercise?.seconds ?? 45;
    this.sessionStartedAt = state.sessionStartedAt; this.exerciseLogs = state.exerciseLogs ?? []; this.exerciseStartedAt = ''; this.running = false;
    this.toast(this.t('toast.resumed'));
  }
  toggleRun(): void {
    if (!this.activeWorkout || !this.activeExercise) return;
    if (this.running) { this.running = false; this.stopClock(); this.persistActiveSession(); return; }
    this.running = true;
    if (!this.exerciseStartedAt) this.exerciseStartedAt = new Date().toISOString();
    this.intervalId = window.setInterval(() => {
      if (this.remaining > 1) { this.remaining--; if (this.remaining % 5 === 0) this.persistActiveSession(); }
      else this.advanceExercise();
    }, 1000);
  }
  skipExercise(): void { this.advanceExercise(); }
  private advanceExercise(): void {
    if (!this.activeWorkout || !this.activeExercise) return;
    const continueRunning = this.running;
    this.stopClock(); this.running = false;
    if (this.exerciseStartedAt) this.exerciseLogs.push({ name: this.activeExercise.name, startedAt: this.exerciseStartedAt, endedAt: new Date().toISOString() });
    this.exerciseStartedAt = '';
    if (this.exerciseIndex + 1 < this.runExercises.length) {
      this.exerciseIndex++; this.currentRound = this.runExercises[this.exerciseIndex].round || 1; this.remaining = this.activeExercise?.seconds ?? 45;
      this.persistActiveSession();
      if (continueRunning) this.toggleRun();
    } else this.finishWorkout();
  }
  previousExercise(): void {
    if (!this.activeWorkout || this.exerciseIndex === 0) return;
    this.stopClock(); this.running = false; this.exerciseIndex--; this.currentRound = this.runExercises[this.exerciseIndex].round || 1; this.remaining = this.activeExercise?.seconds ?? 45; this.exerciseStartedAt = '';
    this.persistActiveSession();
  }
  finishWorkout(): void {
    if (!this.activeWorkout) return;
    const endedAt = new Date().toISOString();
    this.logs = [...this.logs, { workoutName: this.activeWorkout.name, startedAt: this.sessionStartedAt, endedAt, exercises: this.exerciseLogs }];
    this.save(KEYS.logs, this.logs); this.activeWorkout = null; this.running = false; this.persistActiveSession(); this.toast(this.t('toast.finished'));
  }
  cancelWorkout(): void { this.stopClock(); this.activeWorkout = null; this.running = false; this.persistActiveSession(); }
  private stopClock(): void { if (this.intervalId !== undefined) { window.clearInterval(this.intervalId); this.intervalId = undefined; } }

  // ---------- formatting ----------
  clock(seconds: number): string { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }
  time(iso: string): string { return new Intl.DateTimeFormat(this.locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
  date(iso: string): string { return new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'short' }).format(new Date(iso)); }
  sessionSeconds(log: SessionLog): number { return Math.max(0, Math.round((Date.parse(log.endedAt) - Date.parse(log.startedAt)) / 1000)); }
  exerciseIcon(name: string): string {
    const value = this.normalizeName(name);
    if (/etirement|mobilite|stretch|mobility/.test(value)) return '↗';
    if (value.includes('squat')) return '↕';
    if (/marche|step|course|walk|jog|run/.test(value)) return '⇄';
    if (/planche|plank|mountain|burpee/.test(value)) return '◈';
    if (/respiration|breath/.test(value)) return '〰';
    if (/rotation|cercles|circle|twist/.test(value)) return '⤾';
    return '↑';
  }
  workoutSymbol(color: string): string { return color === 'peach' ? '◌' : color === 'lavender' ? '✳' : color === 'blue' ? '↗' : '⌁'; }
  private toast(message: string): void {
    this.zone.run(() => { this.notice = message; if (this.noticeTimeout) window.clearTimeout(this.noticeTimeout); this.noticeTimeout = window.setTimeout(() => this.notice = '', 3000); });
  }
}
