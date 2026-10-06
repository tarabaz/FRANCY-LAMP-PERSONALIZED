# Configuratore lampada – prototipo

Pagina statica che gira tutta nel browser: la foto del cliente non viene mai salvata sul server
(passa dal server solo se il cliente usa il ridisegno IA, e anche lì non viene salvata).
Il cliente carica l'immagine e ottiene il disco Ø200 mm ridotto a max 12 colori pieni e
vettorializzato, con cornice fissa e scritte sulla fascia. Vede l'anteprima 2D/3D spenta e accesa
e scarica l'SVG per la stampa.

## Avvio in locale (senza WordPress)

```bash
cd assets
python3 -m http.server 8765
# poi apri http://localhost:8765
```

Serve un server (anche quello sopra): aprendo `index.html` come file il browser blocca worker e moduli.

## Le due modalità

- **Foto / disegno**: riduce i colori (k-means in spazio Lab), semplifica con filtro Kuwahara e
  aggiunge i contorni neri tra le zone, stile vetrata. Funziona bene su disegni e cartoon; con
  dipinti e foto vere viene fuori un "patchwork".
- **Grafica pronta**: per immagini che hanno già i contorni neri (es. quelle rifatte con Gemini o
  Vector Magic). Riconosce il nero, unifica i neri simili e ingrossa le linee troppo sottili.

Pulizia per la stampa, in entrambe: niente zone sotto l'area minima, niente zone colorate più
strette del "dettaglio minimo" (diventano nere), contorni neri con spessore minimo.

## Pacchetto per Bambu Studio (.zip)

Lo zip si genera alla convalida del cliente e arriva all'admin (vedi README principale); da admin c'è anche
il pulsante "Scarica pacchetto completo". Contiene tra l'altro:
- un **STL per colore** (`01_BASE_bianco`, `02_NERO`, `03_COLORE_…`), tutti con la **stessa origine**: centro
  disco in X 100 / Y 100, Y in alto, Z da 0. Base 0–0,52 mm, colori 0,52–1,00 mm (`FRAME.baseThickness`,
  `FRAME.artThickness`);
- l'**SVG piatto** modificabile;
- `LEGGIMI.txt` con l'elenco file → colore.

In Bambu Studio selezioni tutti gli STL insieme e confermi "carica come singolo oggetto con più parti":
si posizionano da soli. Mesh chiuse e normali verso l'esterno (controllate con script); anello, banda e
contorno dell'asola sono forme uniche e non sovrapposte.

## Il file SVG esportato

- Unità in mm, centro del disco in (0,0), dimensione 200×200 mm.
- Un gruppo `<g>` per parte, con `data-colore`: `disegno-colore-N`, `disegno-nero`,
  `cornice-fascia`, `cornice-scritte`, `cornice-linea-interna`, `cornice-anello-nero`.
- Le scritte sono già convertite in tracciati (font M PLUS Rounded 1c ExtraBold, con il giapponese).
- Fascia e anello sono "bucati" con fill-rule evenodd. Il disegno va sotto la linea nera
  interna per 0,8 mm (sovrapposizione voluta, così non restano fessure).

## Quote della cornice

In `js/frame.js` → `FRAME`.

Tutte reali (disegno quotato in [`docs/quote-disco.png`](../docs/quote-disco.png)):
- Ø200, bordo nero esterno 9,25, banda colorata 12, bordino nero interno 3 → artwork Ø151,5.
- Fori laterali Ø10 con centro sul bordo a 2/3 dell'altezza.
- Asola in basso Ø10 con centro a 12 mm dal fondo, con contorno nero di 4 mm che attraversa la banda e si
  unisce al bordino interno. Banda e contorno sono forme esatte, senza sovrapposizioni.

## Struttura

- `js/worker.js` – conversione immagine → zone di colore → tracciati (Web Worker)
- `js/frame.js` – cornice, fori e scritte ad arco
- `js/preview3d.js` – anteprima Three.js: disco generato montato sul modello reale `models/lampada.stl`
  (COMPOSIZIONE_COMPLETA). Il disco sta 2 mm dietro il frontale della scocca, sotto il tappo. Le quote di
  allineamento sono in `LAMP_MODEL`.
- `js/app.js` – interfaccia, catalogo filamenti, pacchetto e convalida
- `js/export-stl.js` – STL per colore e zip compresso
- `js/export-eps.js` – EPS vettoriale
- `vendor/` – imagetracerjs (Unlicense), opentype.js (MIT), three.js (MIT)
- `fonts/` – M PLUS Rounded 1c (SIL OFL)

Parametri utili per i test: `?img=percorso.jpg&zoom=1.4&mode=keep&ai=/url-endpoint-finto`.
