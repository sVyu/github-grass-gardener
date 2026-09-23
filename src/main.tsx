import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserCredentialStore } from './adapters/credential/browser-credential.store';
import { GitHubClient } from './adapters/github/github-client';
import { App } from './ui/App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
const credentials = new BrowserCredentialStore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App createClient={(token) => new GitHubClient(token)} credentialStore={credentials} />
    </QueryClientProvider>
  </React.StrictMode>,
);
