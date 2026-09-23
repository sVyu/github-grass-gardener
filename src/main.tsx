import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return <main className="p-8 text-white">GitHub Grass Gardener</main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
