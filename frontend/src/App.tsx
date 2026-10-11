import { useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import BottomTabs from './components/BottomTabs';
import { login } from './lib/api';
import Home from './screens/Home';
import NewBooking from './screens/NewBooking';
import Placeholder from './screens/Placeholder';
import Reservations from './screens/Reservations';
import './styles/tokens.css';
import './styles/app.css';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const nav = useNavigate();

  async function submit() {
    setError('');
    try {
      await login(username, password);
      nav('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion impossible.');
    }
  }

  return (
    <div className="main">
      <h1>BKO Quad Hub</h1>
      {error && <div className="alert-error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="u">Identifiant (obligatoire)</label>
        <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </div>
      <div className="field">
        <label htmlFor="p">Mot de passe (obligatoire)</label>
        <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      <button className="btn btn-primary" onClick={submit}>Se connecter</button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <img src="/android-chrome-192x192.png" alt="" aria-hidden="true" />
          <strong>BKO QUAD</strong>
        </header>
        <Routes>
          <Route path="/connexion" element={<Login />} />
          <Route path="/" element={<Home />} />
          <Route path="/calendrier" element={<Placeholder title="Calendrier" text="La grille des créneaux arrive à la prochaine tranche." />} />
          <Route path="/reservations" element={<Reservations />} />
          <Route path="/reservations/nouvelle" element={<NewBooking />} />
          <Route path="/appels" element={<Placeholder title="Appels à traiter" text="Le journal d’appels arrive à la prochaine tranche." />} />
          <Route path="/plus" element={<Placeholder title="Plus" text="Caisse, paie, rapports et paramètres selon votre rôle." />} />
        </Routes>
        <BottomTabs />
      </div>
    </BrowserRouter>
  );
}
