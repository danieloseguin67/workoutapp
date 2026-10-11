// Minimal Google Drive client (Google Identity Services + Drive REST v3).
// Uses the "drive.file" scope: the app only sees files it created itself.

/** Optional default OAuth Client ID (type "Web application"). It can also be entered in Configuration. */
export const GOOGLE_CLIENT_ID = '';

export interface DriveFile { id: string; name: string; modifiedTime: string; size?: string; }

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string; }
interface TokenClient { requestAccessToken(options?: { prompt?: string }): void; }
interface GoogleAccounts {
  oauth2: {
    initTokenClient(config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: { type?: string; message?: string }) => void }): TokenClient;
    revoke(token: string, done?: () => void): void;
  };
}
declare global { interface Window { google?: { accounts: GoogleAccounts } } }

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FILE_PREFIX = 'mouvement-backup';

export class GoogleDrive {
  /** Google callbacks fire outside Angular's zone; this re-enters it so the UI refreshes. */
  constructor(private readonly runInApp: <T>(fn: () => T) => T = fn => fn()) {}

  private token = '';
  private expiresAt = 0;
  private scriptPromise: Promise<void> | null = null;

  get connected(): boolean { return !!this.token && Date.now() < this.expiresAt; }

  private loadScript(): Promise<void> {
    if (window.google?.accounts) return Promise.resolve();
    this.scriptPromise ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL; script.async = true; script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => { this.scriptPromise = null; reject(new Error('Google script could not be loaded')); };
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }

  async connect(clientId: string): Promise<void> {
    await this.loadScript();
    const accounts = window.google?.accounts;
    if (!accounts) throw new Error('Google Identity Services unavailable');
    await new Promise<void>((resolve, reject) => {
      const client = accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: response => this.runInApp(() => {
          if (response.error || !response.access_token) { reject(new Error(response.error_description || response.error || 'No token')); return; }
          this.token = response.access_token;
          this.expiresAt = Date.now() + ((response.expires_in ?? 3600) - 60) * 1000;
          resolve();
        }),
        error_callback: error => this.runInApp(() => reject(new Error(error.message || error.type || 'Sign-in cancelled')))
      });
      client.requestAccessToken({ prompt: this.token ? '' : 'consent' });
    });
  }

  disconnect(): void {
    if (this.token) window.google?.accounts.oauth2.revoke(this.token);
    this.token = ''; this.expiresAt = 0;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.connected) throw new Error('not-connected');
    const response = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token}` } });
    if (response.status === 401) { this.token = ''; throw new Error('not-connected'); }
    if (!response.ok) throw new Error(`Google Drive ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return response;
  }

  async upload(fileName: string, content: string): Promise<DriveFile> {
    const boundary = 'mouvement' + Math.random().toString(36).slice(2);
    const metadata = { name: fileName, mimeType: 'application/json' };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const response = await this.request(`${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,size`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return response.json() as Promise<DriveFile>;
  }

  async list(): Promise<DriveFile[]> {
    const q = encodeURIComponent(`name contains '${FILE_PREFIX}' and trashed = false`);
    const response = await this.request(`${API}?q=${q}&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,modifiedTime,size)`);
    return ((await response.json()) as { files?: DriveFile[] }).files ?? [];
  }

  async download(id: string): Promise<string> { return (await this.request(`${API}/${encodeURIComponent(id)}?alt=media`)).text(); }

  async remove(id: string): Promise<void> { await this.request(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}
