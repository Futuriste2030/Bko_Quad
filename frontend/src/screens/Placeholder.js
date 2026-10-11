import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function Placeholder({ title, text }) {
    return (_jsx("div", { className: "main", children: _jsxs("div", { className: "card", children: [_jsx("h2", { children: title }), _jsx("p", { children: text })] }) }));
}
