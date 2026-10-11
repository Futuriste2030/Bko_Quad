import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
export default function Home() {
    return (_jsxs("div", { className: "main", children: [_jsxs("section", { className: "card", children: [_jsx("h2", { children: "Planning du jour" }), _jsx("p", { children: "Les r\u00E9servations du jour s\u2019afficheront ici." }), _jsx(Link, { to: "/reservations/nouvelle", children: _jsx("button", { className: "btn btn-accent", children: "Nouvelle r\u00E9servation" }) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Appels \u00E0 traiter" }), _jsx("p", { children: "Aucun appel en attente pour le moment." })] })] }));
}
