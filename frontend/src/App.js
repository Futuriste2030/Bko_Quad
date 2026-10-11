import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import BottomTabs from './components/BottomTabs';
import { login } from './lib/api';
import Calls from './screens/Calls';
import Calendar from './screens/Calendar';
import Closing from './screens/Closing';
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
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Connexion impossible.');
        }
    }
    return (_jsxs("div", { className: "main", children: [_jsx("h1", { children: "BKO Quad Hub" }), error && _jsx("div", { className: "alert-error", role: "alert", children: error }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "u", children: "Identifiant (obligatoire)" }), _jsx("input", { id: "u", value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username" })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "p", children: "Mot de passe (obligatoire)" }), _jsx("input", { id: "p", type: "password", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: "current-password" })] }), _jsx("button", { className: "btn btn-primary", onClick: submit, children: "Se connecter" })] }));
}
export default function App() {
    return (_jsx(BrowserRouter, { children: _jsxs("div", { className: "app", children: [_jsxs("header", { className: "header", children: [_jsx("img", { src: "/android-chrome-192x192.png", alt: "", "aria-hidden": "true" }), _jsx("strong", { children: "BKO QUAD" })] }), _jsxs(Routes, { children: [_jsx(Route, { path: "/connexion", element: _jsx(Login, {}) }), _jsx(Route, { path: "/", element: _jsx(Home, {}) }), _jsx(Route, { path: "/calendrier", element: _jsx(Calendar, {}) }), _jsx(Route, { path: "/reservations", element: _jsx(Reservations, {}) }), _jsx(Route, { path: "/reservations/nouvelle", element: _jsx(NewBooking, {}) }), _jsx(Route, { path: "/appels", element: _jsx(Calls, {}) }), _jsx(Route, { path: "/cloture", element: _jsx(Closing, {}) }), _jsx(Route, { path: "/plus", element: _jsx(Placeholder, { title: "Plus", text: "Caisse, paie, rapports et param\u00E8tres selon votre r\u00F4le." }) })] }), _jsx(BottomTabs, {})] }) }));
}
