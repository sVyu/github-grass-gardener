export interface CredentialStore {
  getToken(): string | null;
  setToken(token: string): void;
  clear(): void;
}
