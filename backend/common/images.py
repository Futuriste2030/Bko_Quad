"""Images téléversées : conversion WebP (taille réduite, même contenu).

Tout envoi d'image (photos de flotte, cachet, signature, tampon paie) passe
ici : recadré à max_side, qualité 75, format WebP. Le fichier d'origine
n'est jamais stocké — économie de données mobiles.
"""

import io

from django.core.files.uploadedfile import UploadedFile

MAX_SIDE = 1280
QUALITY = 75


def to_webp(uploaded: UploadedFile, max_side: int = MAX_SIDE, quality: int = QUALITY):
    """Convertit une image téléversée en WebP. Lève si ce n'est pas une image."""
    from PIL import Image
    from django.core.files.base import ContentFile

    if not uploaded:
        return None
    img = Image.open(uploaded)
    img.load()
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if img.mode in ("P", "LA") else "RGB")
    if max_side and max(img.size) > max_side:
        img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality)
    buf.seek(0)
    name = uploaded.name.rsplit(".", 1)[0] or "image"
    return ContentFile(buf.getvalue(), name=f"{name}.webp")
