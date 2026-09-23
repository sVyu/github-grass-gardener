import type { CredentialStore } from './credential-store.port';

export class BrowserCredentialStore implements CredentialStore {
  private token: string | null = null;

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string): void {
    if (!token.trim()) throw new Error('GitHub token is required');
    this.token = token.trim();
  }

  clear(): void {
    this.token = null;
  }
}
