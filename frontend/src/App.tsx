import { Navigate, BrowserRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth, type Role } from './lib/auth';
import { allowedSeg } from './lib/sitepath';
import { CompanyProvider } from './lib/company';
import { NotifyProvider } from './lib/notify';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import Calendar from './screens/Calendar';
import Reservations from './screens/Reservations';
import NewBooking from './screens/NewBooking';
import Calls from './screens/Calls';
import Closing from './screens/Closing';
import Cash from './screens/Cash';
import Bank from './screens/Bank';
import Clients from './screens/Clients';
import Communication from './screens/Communication';
import Expenses from './screens/Expenses';
import Fleet from './screens/Fleet';
import MaintenanceList from './screens/Maintenance';
import Payroll from './screens/Payroll';
import HR from './screens/HR';
import HRContractEditor from './screens/HRContractEditor';
import HRLetterEditor from './screens/HRLetterEditor';
import MyDocuments from './screens/MyDocuments';
import Slots from './screens/Slots';
import Scanner from './screens/Scanner';
import Document from './screens/Document';
import Invoices from './screens/Invoices';
import Recette from './screens/Recette';
import Exports from './screens/Exports';
import Profile from './screens/Profile';
import Settings from './screens/Settings';
import Applications from './screens/Applications';
import SyncScreen from './screens/Sync';
import { SyncWatcher } from './lib/sync';
import Menu from './screens/Menu';
import Onboarding from './screens/Onboarding';
import './styles/tokens.css';
import './styles/app.css';
import { useState, type JSX } from 'react';

const ONBOARDED_KEY = 'bko.onboarded';

function loadOnboarded(): boolean {
  try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch { return true; }
}

/* Première utilisation : présentation + autorisations avant le login. */
function OnboardingGate({ children }: { children: JSX.Element }) {
  const [done, setDone] = useState(loadOnboarded);
  if (done) return children;
  return (
    <Onboarding
      onDone={() => {
        try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* stockage indisponible */ }
        setDone(true);
      }}
    />
  );
}

function Guard({ roles, children }: { roles?: Role[]; children: JSX.Element }) {
  const { role, can, ready } = useAuth();
  if (!ready) return <div className="content"><div className="skeleton" /></div>;
  if (!role) return <Navigate to="/connexion" replace />;
  if (roles && !can(...roles)) return <Navigate to=".." replace />;
  return children;
}

/* Anciennes adresses /reservations… : on les replonge dans le contexte
 * site courant (/s/{seg}) en conservant chemin et paramètres. */
function LegacyJump() {
  const loc = useLocation();
  const { user } = useAuth();
  const role = user?.role ?? null;
  return <Navigate to={`/s/${allowedSeg(user, role)}${loc.pathname}${loc.search}`} replace />;
}

/* Vérification du segment site : un compte de terrain ne peut pas afficher
 * un autre site dans l'URL — redirection silencieuse vers le sien (les
 * données restent de toute façon filtrées par le serveur). */
function SiteTree({ children }: { children: JSX.Element }) {
  const { seg } = useParams();
  const loc = useLocation();
  const { user, role, ready } = useAuth();
  if (!ready) return <div className="content"><div className="skeleton" /></div>;
  if (!role) return <Navigate to="/connexion" replace />;
  const mine = allowedSeg(user, role ?? null);
  if (mine !== 'reseau' && (seg === 'reseau' || /^\d+$/.test(seg ?? ''))) {
    /* L'utilisateur a un site : le segment est verrouillé sur ce site. */
    if (seg !== mine) {
      const rest = loc.pathname.replace(/^\/s\/[^/]+/, '') || '';
      return <Navigate to={`/s/${mine}${rest}${loc.search}`} replace />;
    }
  }
  return children;
}

/* Écrans applicatifs relatifs au site courant (item "" = accueil). */
function ScreenRoutes() {
  return (
    <Routes>
      <Route index element={<Guard><Dashboard /></Guard>} />
      <Route path="calendrier" element={<Guard roles={['agent', 'guide', 'responsable', 'admin']}><Calendar /></Guard>} />
      <Route path="reservations" element={<Guard roles={['agent', 'responsable', 'admin', 'comptable']}><Reservations /></Guard>} />
      <Route path="reservations/nouvelle" element={<Guard roles={['agent', 'responsable', 'admin']}><NewBooking /></Guard>} />
      <Route path="creneaux" element={<Guard roles={['agent', 'guide', 'responsable', 'admin']}><Slots /></Guard>} />
      <Route path="clients" element={<Guard roles={['agent', 'responsable', 'admin']}><Clients /></Guard>} />
      <Route path="flotte" element={<Guard roles={['guide', 'responsable', 'admin']}><Fleet /></Guard>} />
      <Route path="maintenance" element={<Guard roles={['responsable', 'admin']}><MaintenanceList /></Guard>} />
      <Route path="appels" element={<Guard roles={['agent', 'responsable', 'admin']}><Calls /></Guard>} />
      <Route path="scanner" element={<Guard roles={['guide', 'responsable', 'admin']}><Scanner /></Guard>} />
      <Route path="documents/:id/:kind" element={<Guard roles={['agent', 'responsable', 'admin', 'comptable']}><Document /></Guard>} />
      <Route path="documents/:id" element={<Guard roles={['agent', 'responsable', 'admin', 'comptable']}><Document /></Guard>} />
      <Route path="factures" element={<Guard roles={['agent', 'responsable', 'admin', 'comptable']}><Invoices /></Guard>} />
      <Route path="cloture" element={<Guard roles={['agent', 'responsable', 'admin', 'comptable']}><Closing /></Guard>} />
      <Route path="synchronisation" element={<Guard><SyncScreen /></Guard>} />
      <Route path="caisse" element={<Guard roles={['responsable', 'admin', 'comptable']}><Cash /></Guard>} />
      <Route path="banque" element={<Guard roles={['responsable', 'admin', 'comptable']}><Bank /></Guard>} />
      <Route path="depenses" element={<Guard roles={['responsable', 'admin']}><Expenses /></Guard>} />
      <Route path="communication" element={<Guard><Communication /></Guard>} />
      <Route path="recette" element={<Guard roles={['responsable', 'admin', 'comptable']}><Recette /></Guard>} />
      <Route path="exports" element={<Guard roles={['agent', 'responsable', 'admin', 'comptable']}><Exports /></Guard>} />
      <Route path="paie" element={<Guard roles={['admin', 'comptable']}><Payroll /></Guard>} />
      <Route path="rh" element={<Guard roles={['responsable', 'admin']}><HR /></Guard>} />
      <Route path="rh/contrats/nouveau" element={<Guard roles={['responsable', 'admin']}><HRContractEditor /></Guard>} />
      <Route path="rh/contrats/:id" element={<Guard roles={['responsable', 'admin']}><HRContractEditor /></Guard>} />
      <Route path="rh/courriers/nouveau" element={<Guard roles={['responsable', 'admin']}><HRLetterEditor /></Guard>} />
      <Route path="rh/courriers/:id" element={<Guard roles={['responsable', 'admin']}><HRLetterEditor /></Guard>} />
      <Route path="mes-documents" element={<Guard><MyDocuments /></Guard>} />
      <Route path="applications" element={<Guard><Applications /></Guard>} />
      <Route path="profil" element={<Guard><Profile /></Guard>} />
      <Route path="parametres" element={<Guard><Settings /></Guard>} />
      <Route path="menu" element={<Guard><Menu /></Guard>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

function Public({ children }: { children: JSX.Element }) {
  const { role, ready } = useAuth();
  if (!ready) return <div className="content"><div className="skeleton" /></div>;
  if (role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <CompanyProvider>
          <NotifyProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <SyncWatcher />
            <OnboardingGate>
            <Routes>
              <Route path="/connexion" element={<Public><Login /></Public>} />
              <Route path="/s/:seg/*" element={<SiteTree><ScreenRoutes /></SiteTree>} />
              <Route path="*" element={<LegacyJump />} />
            </Routes>
            </OnboardingGate>
          </BrowserRouter>
          </NotifyProvider>
          </CompanyProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
