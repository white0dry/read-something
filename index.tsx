import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { hydrateReaderChatStore } from './utils/readerChatRuntime';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const mountApp = () => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

void hydrateReaderChatStore()
  .catch((error) => {
    console.error('Failed to hydrate reader chat store before mount', error);
  })
  .finally(() => {
    mountApp();
  });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(error => {
      console.error('Service worker registration failed:', error);
    });
  });
}
