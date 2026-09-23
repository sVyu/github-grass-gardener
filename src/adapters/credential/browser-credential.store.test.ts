import { describe, expect, it } from 'vitest';
import { BrowserCredentialStore } from './browser-credential.store';

describe('memory credential store', () => {
  it('keeps credentials only inside the instance and clears them', () => {
    const store = new BrowserCredentialStore();
    store.setToken('test-token');
    expect(store.getToken()).toBe('test-token');
    expect(new BrowserCredentialStore().getToken()).toBeNull();
    store.clear();
    expect(store.getToken()).toBeNull();
  });
});
