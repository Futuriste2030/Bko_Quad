"""Contenu enrichi des documents RH.

Le brouillon est saisi dans un editeur contentEditable (meme principe que le
Hub Digi). Le serveur ne conserve qu'un sous-ensemble sur de balises, puis
convertit ce balisage vers ReportLab pour le PDF. Le texte simple deja stocke
reste lisible : il n'est jamais interprete comme du HTML.
"""

import html
import re
from html.parser import HTMLParser

MAX_CONTENT_LENGTH = 200_000

ALLOWED_TAGS = {
    "a", "b", "blockquote", "br", "div", "em", "h1", "h2", "h3", "hr",
    "i", "li", "ol", "p", "s", "span", "strike", "strong", "u", "ul",
}
VOID_TAGS = {"br", "hr"}
DROP_CONTENT_TAGS = {
    "embed", "iframe", "math", "noscript", "object", "script", "style",
    "svg", "template",
}
BLOCK_TAGS = {"blockquote", "div", "h1", "h2", "h3", "li", "ol", "p", "ul"}
ALLOWED_STYLE_PROPERTIES = {
    "background-color", "color", "font-style", "font-weight",
    "text-align", "text-decoration",
}
_SAFE_STYLE_VALUE = re.compile(r"^[#a-zA-Z0-9(),.%\s+-]+$")
_HTML_TAG = re.compile(r"<\s*/?\s*[a-zA-Z][^>]*>")


class HRContentError(ValueError):
    pass


def looks_like_html(value):
    return bool(_HTML_TAG.search(value or ""))


def _safe_href(value):
    value = (value or "").strip()
    if re.match(r"^(https?://|mailto:)", value, re.I):
        return value
    return ""


def _clean_style(value):
    declarations = []
    for declaration in (value or "").split(";"):
        if ":" not in declaration:
            continue
        prop, raw = declaration.split(":", 1)
        prop = prop.strip().lower()
        raw = raw.strip()
        if prop not in ALLOWED_STYLE_PROPERTIES:
            continue
        if not raw or not _SAFE_STYLE_VALUE.match(raw):
            continue
        lowered = raw.lower()
        if "url(" in lowered or "expression" in lowered or "javascript" in lowered:
            continue
        declarations.append(f"{prop}: {raw}")
    return "; ".join(declarations)


class _HTMLSanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.stack = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag not in ALLOWED_TAGS:
            return
        if tag in VOID_TAGS:
            self.parts.append(f"<{tag}>")
            return

        attributes = []
        values = dict(attrs)
        if tag == "a":
            href = _safe_href(values.get("href"))
            if not href:
                return
            attributes.append(("href", href))
            attributes.append(("target", "_blank"))
            attributes.append(("rel", "noopener noreferrer"))
        style = _clean_style(values.get("style"))
        if style:
            attributes.append(("style", style))

        rendered = "".join(
            f' {name}="{html.escape(value, quote=True)}"'
            for name, value in attributes
        )
        self.parts.append(f"<{tag}{rendered}>")
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS or self.skip_depth:
            return
        if tag in VOID_TAGS:
            self.parts.append(f"<{tag}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth or tag in VOID_TAGS:
            return
        if tag not in self.stack:
            return
        while self.stack:
            current = self.stack.pop()
            self.parts.append(f"</{current}>")
            if current == tag:
                break

    def handle_data(self, data):
        if self.skip_depth:
            return
        self.parts.append(html.escape(data, quote=False))

    def finish(self):
        while self.stack:
            self.parts.append(f"</{self.stack.pop()}>")
        return "".join(self.parts)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "hr":
            self.parts.append("\n")
        elif tag == "li":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth:
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.skip_depth:
            return
        self.parts.append(data)

    def text(self):
        value = "".join(self.parts)
        value = re.sub(r"[ \t]+", " ", value)
        value = re.sub(r"\n\s*\n\s*\n+", "\n\n", value)
        return value.strip()


class _ReportLabParser(HTMLParser):
    """Convertit le HTML nettoye en balisage Paragraph de ReportLab."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.inline = []
        self.inline_stack = []
        self.lists = []
        self.skip_depth = 0

    def _flush(self):
        value = "".join(self.inline).strip()
        if value:
            self.blocks.append(value)
        self.inline = []

    def _open_inline(self, tag):
        self.inline_stack.append(tag)
        self.inline.append(f"<{tag}>")

    def _close_inline(self, tag):
        if tag not in self.inline_stack:
            return
        while self.inline_stack:
            current = self.inline_stack.pop()
            self.inline.append(f"</{current}>")
            if current == tag:
                break

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag in ("p", "div"):
            self._flush()
        elif tag in ("h1", "h2", "h3"):
            self._flush()
            self._open_inline("b")
        elif tag == "blockquote":
            self._flush()
            self._open_inline("i")
        elif tag in ("ul", "ol"):
            self._flush()
            self.lists.append({"ordered": tag == "ol", "index": 0})
        elif tag == "li":
            self._flush()
            if self.lists:
                current = self.lists[-1]
                current["index"] += 1
                prefix = f"{current['index']}. " if current["ordered"] else "• "
            else:
                prefix = "• "
            self.inline.append(prefix)
        elif tag in ("strong", "b"):
            self._open_inline("b")
        elif tag in ("em", "i"):
            self._open_inline("i")
        elif tag == "u":
            self._open_inline("u")
        elif tag in ("s", "strike"):
            self._open_inline("strike")
        elif tag == "br":
            self.inline.append("<br/>")
        elif tag == "hr":
            self._flush()
            self.blocks.append("————————")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth:
            return
        if tag in ("p", "div", "li"):
            self._flush()
        elif tag in ("h1", "h2", "h3"):
            self._close_inline("b")
            self._flush()
        elif tag == "blockquote":
            self._close_inline("i")
            self._flush()
        elif tag in ("ul", "ol"):
            self._flush()
            if self.lists:
                self.lists.pop()
        elif tag in ("strong", "b"):
            self._close_inline("b")
        elif tag in ("em", "i"):
            self._close_inline("i")
        elif tag == "u":
            self._close_inline("u")
        elif tag in ("s", "strike"):
            self._close_inline("strike")

    def handle_data(self, data):
        if self.skip_depth:
            return
        value = re.sub(r"\s+", " ", data)
        if not value.strip() and not self.inline:
            return
        self.inline.append(html.escape(value, quote=False))

    def paragraphs(self):
        while self.inline_stack:
            self.inline.append(f"</{self.inline_stack.pop()}>")
        self._flush()
        return self.blocks


def sanitize_content(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    if len(value) > MAX_CONTENT_LENGTH:
        raise HRContentError("Le texte du document est trop long (200 000 caracteres maximum).")
    if not value:
        return ""
    parser = _HTMLSanitizer()
    try:
        parser.feed(value)
        parser.close()
    except Exception as exc:
        raise HRContentError("Le texte du document n'est pas lisible.") from exc
    return parser.finish().strip()


def html_to_text(value):
    if not value:
        return ""
    parser = _TextExtractor()
    try:
        parser.feed(value)
        parser.close()
    except Exception:
        return re.sub(r"<[^>]*>", " ", value)
    return parser.text()


def content_is_empty(value):
    return not html_to_text(value or "").strip()


def reportlab_paragraphs(value):
    if not value:
        return []
    parser = _ReportLabParser()
    try:
        parser.feed(value)
        parser.close()
    except Exception:
        return []
    return parser.paragraphs()
