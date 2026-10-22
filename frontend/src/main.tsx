import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/* En dev, aucun service worker : on désinscrit ceux d'un build précédent
   pour éviter les interceptions parasites (requêtes d'extensions, vieux cache). */
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => { void r.unregister(); }));
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
