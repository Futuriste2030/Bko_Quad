# BKO Quad Hub — Règles de style

> Fichier de référence pour toute interface du Hub BKO Quad (PWA agence, puis app client).
> Toute modification d'écran ou de composant doit respecter ces règles. En cas de doute, ce fichier prime sur les habitudes du Hub Digi Com : la structure (layout, rôles, composants) peut être réutilisée, mais l'habillage (couleurs, polices, logo) est celui de BKO Quad.

---

## 1. Identité

Le logo est **noir et blanc** : un pilote sur un quad en pleine action, au-dessus du texte « BKO QUAD » en lettres rondes, très grasses, avec une **ombre dure décalée** (effet relief). L'esprit : énergie, aventure, robustesse, un peu rétro.

Le Hub reprend ces trois idées :

1. **Contraste fort** : noir et blanc dominants, une seule couleur d'accent.
2. **Ombre dure** : l'ombre décalée du logo devient la signature des boutons principaux et des cartes importantes (section 4).
3. **Lettres rondes et grasses** : réservées aux titres de marque, jamais au texte courant.

### Règles d'usage du logo

| Règle | Détail |
| --- | --- |
| Fond clair | Logo noir sur blanc ou sable (`--bko-sand`) |
| Fond sombre | Version blanche (inversée) sur noir ; ne jamais poser le logo noir sur fond sombre |
| Couleur | Jamais recolorié, jamais de dégradé, jamais d'ombre ajoutée |
| Proportions | Jamais étiré ni déformé ; toujours `object-fit: contain` |
| Zone de protection | Vide autour du logo au moins égal à la hauteur de la lettre « B » |
| Taille minimale | Logo complet : 96 px de large. En dessous, utiliser le pictogramme (quad seul) |
| Fond photo | Interdit sans bandeau uni noir ou blanc derrière le logo |

### Où l'utiliser

- **En-tête (mobile)** : pictogramme + « BKO QUAD » en texte, hauteur 32 px.
- **Écran de connexion** : logo complet centré.
- **Documents PDF** (factures, reçus, fiches de paie) : logo complet en haut à gauche, noir sur blanc.
- **Icône PWA et favicon** : pictogramme seul (le texte devient illisible en petit).
- **Messages WhatsApp / SMS** : texte « BKO Quad », pas d'image.

---

## 2. Couleurs

Le logo n'impose aucune couleur : l'**orange** ci-dessous est une proposition d'accent (poussière et soleil), à valider avec la direction.

### Jetons CSS (à copier dans `src/styles/tokens.css`)

```css
:root {
  /* Palette de base */
  --bko-black: #0a0a0a;
  --bko-white: #ffffff;
  --bko-sand: #f5f3ef;
  --bko-sand-2: #e9e4da;
  --bko-grey-600: #5c5c5c;
  --bko-orange: #e8590c;

  /* Rôles (thème clair) */
  --bg: var(--bko-sand);              /* fond de page */
  --surface: var(--bko-white);        /* cartes, champs, feuilles */
  --surface-2: var(--bko-sand-2);     /* zones secondaires, lignes de tableau alternées */
  --ink: var(--bko-black);            /* texte principal, bordures fortes */
  --ink-muted: var(--bko-grey-600);   /* texte secondaire */
  --border: #d9d4cb;                  /* séparateurs discrets */
  --border-strong: var(--bko-black);  /* contours des boutons et cartes clés */
  --accent: var(--bko-orange);        /* fond d'accent ; texte dessus = noir */
  --focus: var(--bko-orange);

  /* États (texte blanc dessus, sauf warning : texte noir) */
  --success: #17703d;
  --warning: #f2b01e;
  --danger:  #c62828;
  --info:    #1d5fd1;

  /* Rayons */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 999px;

  /* Ombre signature (écho du logo) */
  --shadow-hard: 3px 3px 0 var(--ink);
  --shadow-hard-pressed: 1px 1px 0 var(--ink);

  /* Espacement : multiples de 4 px */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;

  /* Typographie */
  --font-display: 'Caprasimo', 'Cooper Black', Georgia, serif;
  --font-body: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --text-sm: 0.875rem;   /* 14 */
  --text-base: 1rem;     /* 16, minimum pour les champs sur mobile */
  --text-lg: 1.125rem;   /* 18 */
  --text-xl: 1.25rem;    /* 20 */
  --text-2xl: 1.5rem;    /* 24 */
  --text-3xl: 1.875rem;  /* 30 */
  --touch-min: 48px;
}

/* Thème sombre : suit le système, ou forcé par data-theme="dark" */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0a0a0a;
    --surface: #161616;
    --surface-2: #222222;
    --ink: #f5f3ef;
    --ink-muted: #b5b0a6;
    --border: #333333;
    --border-strong: #f5f3ef;
    --success: #4cc38a;
    --danger: #ff6b6b;
    --info: #6ea0ff;
  }
}
:root[data-theme='dark'] {
  --bg: #0a0a0a;
  --surface: #161616;
  --surface-2: #222222;
  --ink: #f5f3ef;
  --ink-muted: #b5b0a6;
  --border: #333333;
  --border-strong: #f5f3ef;
  --success: #4cc38a;
  --danger: #ff6b6b;
  --info: #6ea0ff;
}
```

### Règles de contraste

| Combinaison | Verdict |
| --- | --- |
| Noir sur blanc ou sable | Texte de tout format |
| **Noir sur orange** | Autorisé (contraste suffisant) |
| **Blanc sur orange** | **Interdit** pour le texte (contraste insuffisant) ; l'orange sert en fond avec texte noir, en contour, ou en texte de 18 px gras et plus sur fond sombre |
| Blanc sur succès, danger, info | Autorisé |
| Noir sur warning (jaune) | Obligatoire |
| Gris `--ink-muted` sur blanc ou sable | Texte secondaire uniquement, jamais pour une information critique |

Règle d'or : **l'orange est rare**. Un seul élément orange fort par écran (l'action principale ou l'alerte à voir en premier).

### Couleurs des statuts de réservation

| Statut | Jeton | Badge (texte noir sauf indication) |
| --- | --- | --- |
| En attente d'acompte | `--warning` | Fond jaune, texte noir |
| Confirmée | `--success` | Fond vert, texte blanc |
| Arrivée validée | `--info` | Fond bleu, texte blanc |
| Terminée | `--ink-muted` | Contour gris, fond transparent |
| Annulée | `--danger` | Contour rouge, fond transparent, texte rouge |
| Absent | `--danger` | Fond rouge, texte blanc |
| Expirée | `--ink-muted` | Contour gris pointillé |
| Anomalie (appel ou client sans réservation) | `--danger` | Fond rouge, texte blanc, remonte en tête des listes |

Un statut n'est **jamais indiqué par la couleur seule** : toujours le texte, et une icône si la place le permet.

---

## 3. Typographie

| Usage | Police | Taille | Graisse |
| --- | --- | --- | --- |
| Titre de marque (écran de connexion, en-tête de documents) | `--font-display` (Caprasimo) | `--text-3xl` | 400 (une seule graisse existe) |
| Titres d'écran (H1) | `--font-body` | `--text-2xl` | 700 |
| Titres de section (H2, H3) | `--font-body` | `--text-xl`, `--text-lg` | 700, 600 |
| Texte courant | `--font-body` | `--text-base` | 400 |
| Libellés de champ, légendes | `--font-body` | `--text-sm` | 500 |
| Montants et chiffres de tableau de bord | `--font-body` | selon le contexte | 700 |

Règles :

- La police d'affichage ressemble à une lettre ronde et grasse proche de celle du logo ; la vérifier visuellement à côté du logo avant de la généraliser. Elle ne sert que pour 1 à 2 occurrences par écran, jamais pour du texte courant ni des boutons.
- Le texte courant utilise la **pile système** : zéro octet à télécharger, rapide sur Android d'entrée de gamme et réseau lent.
- Si Caprasimo est utilisée : auto-hébergée, sous-ensemble latin, `font-display: swap`.
- Les montants et heures utilisent `font-variant-numeric: tabular-nums` pour s'aligner en colonne.
- Pas de texte en majuscules sauf sigles (FCFA, QR) et le mot-symbole « BKO QUAD ».
- Longueur de ligne maximale : 70 caractères.

---

## 4. Forme, bordures, ombres

- Rayons : champs et boutons `--radius-md`, cartes `--radius-lg`, badges `--radius-full`.
- **Contour fort** (2 px, `--border-strong`) sur les boutons, les cartes interactives et les champs en focus ; **contour discret** (1 px, `--border`) pour les séparateurs.
- **Ombre dure** (`--shadow-hard`) réservée à :
  - le bouton principal de l'écran ;
  - les cartes de chiffres du tableau de bord ;
  - la feuille d'action en bas d'écran.
  Au toucher, le bouton s'enfonce : `transform: translate(2px, 2px)` et `--shadow-hard-pressed`.
- Ailleurs : pas d'ombre floue, pas de dégradé, pas de transparence décorative. Un écran avec plus de trois ombres dures est trop chargé.
- Icônes : jeu **Lucide**, trait 2 px, 24 px, couleur `--ink`. Jamais d'emoji comme icône d'interface.
- Illustrations : style noir et blanc au trait, cohérent avec le logo.

---

## 5. Composants

### Boutons

| Variante | Fond | Texte | Contour | Usage |
| --- | --- | --- | --- | --- |
| Principal | `--ink` | `--bg` | 2 px `--ink` + ombre dure | Une action principale par écran (Enregistrer, Envoyer par WhatsApp) |
| Accent | `--accent` | noir | 2 px noir + ombre dure | Action à mettre en avant (Nouvelle réservation) |
| Secondaire | `--surface` | `--ink` | 2 px `--ink` | Actions alternatives |
| Danger | `--danger` | blanc | 2 px | Annuler, supprimer (toujours avec confirmation) |
| Discret | transparent | `--ink` | aucun | Actions tertiaires, liens |

- Hauteur minimale **48 px**, largeur pleine sur mobile pour l'action principale, placée **en bas de l'écran** dans la zone du pouce.
- Libellé = verbe à l'infinitif, concret : « Enregistrer la réservation », pas « OK ».
- État de chargement : spinner dans le bouton, bouton désactivé, libellé conservé.
- Focus visible : contour 3 px `--focus` avec décalage de 2 px.

### Champs de formulaire

- Hauteur 48 px, texte 16 px minimum (évite le zoom automatique sur mobile), libellé **au-dessus** du champ, jamais en simple placeholder.
- Clavier adapté : `type="tel"` et `inputmode="tel"` pour les numéros, `inputmode="numeric"` pour les quantités.
- Listes déroulantes et sélecteurs plutôt que texte libre dès qu'un choix existe (activité, créneau, motif).
- Erreur : contour `--danger` 2 px, message en dessous en langage clair, icône d'alerte. Le message dit **quoi faire** : « Ce créneau est complet, choisissez-en un autre ».
- Champs obligatoires marqués d'un astérisque et du mot « obligatoire » pour les lecteurs d'écran.

### Cartes et listes

- **Mobile : les tableaux deviennent des cartes empilées** (une carte = une réservation, un appel, une écriture). Jamais de défilement horizontal pour lire une ligne.
- **Ordinateur (responsable, direction)** : tableaux classiques à deux colonnes liste + détail.
- Une carte de réservation montre, dans cet ordre : heure et activité, nom du client, nombre de personnes, **badge de statut**, montant restant dû.

### Navigation

- **Mobile : barre d'onglets en bas**, 5 entrées maximum : Accueil, Calendrier, Réservations, Appels, Plus. Hauteur 64 px + zone de sécurité (`env(safe-area-inset-bottom)`). L'onglet actif : icône et libellé en `--ink` gras + trait supérieur 3 px `--accent`. Libellés 12 px minimum, toujours visibles.
- **Ordinateur** : barre latérale par département, comme le Hub Digi Com, aux couleurs BKO Quad.
- Les entrées visibles dépendent du rôle ; une entrée inaccessible n'est pas grisée, elle est absente.

### Alertes, bannières, toasts

| Type | Couleur | Exemple |
| --- | --- | --- |
| Information | `--info` | « Brouillon enregistré sur ce téléphone » |
| Succès | `--success` | « Réservation confirmée, message envoyé » |
| Attention | `--warning` | « Acompte non reçu, expire dans 2 h » |
| Erreur | `--danger` | « Connexion perdue, réessayez » |

Les anomalies de contrôle (appel sans réservation, écart de caisse) s'affichent en **bannière rouge persistante** en haut de l'accueil du responsable : elles ne disparaissent pas toutes seules.

### États vides, chargement, hors ligne

- Chargement : squelettes gris (`--surface-2`), pas de roue plein écran.
- État vide : pictogramme du quad au trait + une phrase + un bouton d'action.
- Hors ligne : bandeau fin « Hors ligne — vos saisies sont conservées » ; les brouillons se renvoient seuls au retour du réseau, avec l'état « À synchroniser » sur la carte concernée.

---

## 6. Mobile et PWA

- **Mobile-first** : concevoir à 360 px de large, puis élargir. Points de rupture : 640 px (tablette), 1024 px (ordinateur).
- Zones tactiles ≥ 48 px, espacement ≥ 8 px entre deux zones.
- Contenu clair de la barre système : `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` et marges `env(safe-area-inset-*)`.
- Manifeste PWA : `name` « BKO Quad Hub », `short_name` « BKO Hub », `theme_color` `#0a0a0a`, `background_color` `#ffffff`, `display` `standalone`, `lang` `fr`.
- Icônes : 192 px et 512 px, plus une version **maskable** (pictogramme du quad en blanc, centré dans la zone de sécurité de 80 %, sur fond noir).
- Poids : pas de bibliothèque d'icônes entière (importer à l'unité), images en WebP, aucune police ou ressource bloquante.

---

## 7. Contenu et formats

| Élément | Règle | Exemple |
| --- | --- | --- |
| Langue | Français | |
| Montants | Entier, espace fine insécable en séparateur, « FCFA » en suffixe | `50 000 FCFA` |
| Dates | `jj/mm/aaaa`, jour de la semaine abrégé dans les plannings | `Sam. 10/10/2026` |
| Heures | 24 h, `HH:mm` | `14:30` |
| Fuseau | Africa/Bamako | |
| Téléphone affiché | `+223` puis 4 groupes de 2 chiffres | `+223 78 80 30 72` |
| Téléphone stocké | Format international sans espaces | `+22378803072` |
| Codes de réservation | Majuscules, préfixe `BKO` | `BKO-261010-A7F3` |
| Ton interface interne | Neutre, verbes à l'infinitif sur les boutons | « Valider la journée » |
| Ton messages clients | Vouvoiement, court, poli | « Bonjour M. Traoré, votre réservation BKO-261010-A7F3 est confirmée… » |

Utilitaire de formatage de référence :

```ts
export const fcfa = (n: number) =>
  `${Math.round(n).toLocaleString('fr-FR').replace(/\s/g, '\u202f')} FCFA`;
```

Vocabulaire à employer de façon constante : **réservation** (jamais « booking »), **créneau**, **acompte**, **guide**, **clôture du jour**, **anomalie**, **bordereau**.

---

## 8. Accessibilité

- Contraste minimal 4,5:1 pour le texte, 3:1 pour les contours et icônes (voir section 2).
- Tout élément interactif au clavier et au lecteur d'écran : libellés explicites, ordre de tabulation logique, focus toujours visible.
- Images utiles avec `alt`, pictogrammes décoratifs avec `aria-hidden="true"`.
- Respecter `prefers-reduced-motion` : aucune animation hors transitions de 150 ms.
- Ne jamais bloquer le zoom du navigateur.

---

## 9. À ne pas faire

- Texte blanc sur fond orange.
- Plus d'un bouton principal par écran.
- Couleur seule pour porter un statut.
- Logo recolorié, étiré, avec ombre ou sur fond photo.
- Police d'affichage pour le texte courant.
- Ombres floues, dégradés, effets de verre.
- Tableaux qui obligent à défiler horizontalement sur mobile.
- Libellés techniques dans les messages d'erreur (« Error 500 », « null »).
- Écrans sans état vide, chargement ou erreur définis.

---

## 10. Assets à produire à partir du logo fourni

| Fichier | Contenu | Usage |
| --- | --- | --- |
| `logo-bko-quad.svg` | Logo complet, noir, fond transparent (vectorisé depuis l'image fournie) | Écran de connexion, PDF |
| `logo-bko-quad-white.svg` | Logo complet, blanc, fond transparent | Thème sombre |
| `pictogramme-quad.svg` | Quad et pilote seuls, noir | En-tête mobile, état vide |
| `pictogramme-quad-white.svg` | Quad et pilote seuls, blanc | Thème sombre, icône maskable |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Icônes PWA | Écran d'accueil du téléphone |
| `favicon.svg` | Pictogramme simplifié | Onglet du navigateur |

L'image fournie est un JPEG sur fond blanc : la vectoriser (ou refaire un PNG transparent haute résolution) avant toute intégration pour éviter les bords flous et le fond blanc visible en thème sombre.
