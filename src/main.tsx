import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __alexApplySwUpdate?: () => void;
    __alexSwUpdateReady?: boolean;
  }
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__alexSwUpdateReady = true;
    window.__alexApplySwUpdate = () => {
      void updateSW(true);
    };
    window.dispatchEvent(new CustomEvent('alex:sw-update-ready'));
  },
});

createRoot(document.getElementById('root')!).render(<App />);
