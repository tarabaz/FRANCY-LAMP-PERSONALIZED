# Francy Lamp – plugin WordPress

Configuratore delle lampade "tombino" personalizzate di FrancyStore3D, con ridisegno IA opzionale.
Il repository è direttamente il plugin: `francy-lamp.php` sta nella root.

## Installazione

1. Su GitHub: **Code → Download ZIP** (lo zip contiene una sola cartella con il plugin dentro, come vuole WordPress).
2. WordPress → Plugin → Aggiungi nuovo → Carica plugin → scegli lo zip → Attiva.
3. Il configuratore è già online alla **pagina dedicata** `tuosito.it/lampade-personalizzate/` (a schermo intero,
   senza tema). Indirizzo, titolo e descrizione si cambiano in Impostazioni → Pagina del configuratore.
   In alternativa c'è lo shortcode `[francy_lamp]` da mettere in una pagina normale.
4. Menu **Francy Lamp Factory → Impostazioni**: inserisci la chiave API e scegli il fornitore.
5. Menu **Francy Lamp Factory → Filamenti**: incolla il catalogo delle tue bobine (`Nome | #rrggbb`, una per riga).

Il pulsante "Ridisegna in stile tombino" compare solo se il ridisegno è attivo e c'è almeno una chiave.

## Pagina dedicata

- Indirizzo impostabile (`lampade-personalizzate` di default), creato dal plugin con una regola di riscrittura:
  dopo averlo cambiato basta salvare le impostazioni. Se la pagina dà 404, vai in Impostazioni → Permalink e
  premi "Salva" (rigenera gli indirizzi). Dalla 0.5.1 il plugin riconosce l'indirizzo anche senza regole aggiornate e le rigenera da solo dopo ogni aggiornamento.
- "Script del sito" attivo = carica Pixel/analytics/banner cookie degli altri plugin (`wp_head`/`wp_footer`).
- Ogni file JS ha la sua versione (importmap con `?ver=versione-data`): dopo un aggiornamento del plugin il
  browser carica sempre i file nuovi. `assets/.htaccess` chiede anche di ricontrollare JS e CSS (Apache).

## Disco predefinito

In Impostazioni → **Disco predefinito** scegli come si apre il disco: colore della banda, colore delle scritte e
i 4 testi (1 alto sinistra, 2 alto destra, 3 basso sinistra, 4 basso destra; vuoto = non mostrato).
Di default: "Testo 2" e "Testo 3". Il cliente poi può cambiare tutto.

## Regolazioni predefinite

In Impostazioni → **Regolazioni predefinite** scegli i valori di partenza degli slider: modalità iniziale
(Foto / disegno o Grafica pronta), colori, spessore contorni, contorni mancanti, ingrossa nero,
semplificazione, dettaglio minimo, area minima, risoluzione. Il cliente può sempre cambiarli.

## Esempi degli stili IA

**Francy Lamp Factory → Esempi stili**: per ogni stile (Fedele, Ritratto, Anime) scegli la **foto originale** e il
**risultato**. L'originale può essere quello dello stile (es. un volto per Ritratto, un animale per Anime) oppure la
**foto comune** usata dagli stili senza foto propria. Il risultato si genera con l'IA (**Genera con IA**, una volta sola)
oppure si carica a mano (**Carica risultato**). Nel configuratore, sotto i pulsanti degli stili, il cliente vede
"originale → risultato" dello stile selezionato senza spendere ridisegni. Si nasconde da Impostazioni → Prompt.
File pubblici in `uploads/francy-lamp-esempi/`.

## Il flusso

1. Il cliente personalizza il disco e preme **"Convalida il mio disco"** (nome, email, telefono, note, consenso).
   Non può scaricare file: SVG, STL e PNG li scarichi solo tu (da admin, sul configuratore o dalla tabella).
2. Il browser prepara uno **zip completo** e lo invia al sito:
   - `01_anteprime/` anteprima spenta e accesa
   - `02_immagini/` originale caricato, eventuale ridisegno IA, ritaglio usato
   - `03_vettoriale/` `disco.svg` e `disco.eps` (modificabili a mano)
   - `04_stl/` un STL per colore, stessa origine, col nome della bobina nel file
   - `05_bambu/disco-lampada.3mf` progetto Bambu Studio per H2C: parti già separate e filamenti già
     assegnati (filamento 1 = bianco sulla bobina fissa dell'ugello 1, gli altri sull'ugello 2 con gli AMS).
     Le impostazioni di stampa vengono dal tuo progetto di riferimento (`assets/bambu/h2c-template.json`).
   - `LEGGIMI-filamenti.txt` e `riepilogo.json`: bobine da montare, ruolo di ogni colore, area
3. In **Francy Lamp Factory → Progetti** compare la voce con codice (es. `FL-2026-0001`), anteprima, cliente,
   filamenti, stato (Nuovo / In lavorazione / Stampato / Consegnato / Annullato) e il pulsante **Scarica zip**.
   Ti arriva anche una mail di notifica.

I file stanno in `wp-content/uploads/francy-lamp/<cartella casuale>/`, protetti da `.htaccess`
(su Nginx la cartella casuale li rende comunque non indovinabili). Si scaricano solo da admin.
Cancellando definitivamente un progetto si cancellano anche i suoi file.

**Disegni pronti:** in **Francy Lamp Factory → Disegni pronti** aggiungi un disegno con nome e "Immagine del disco
(PNG)": PNG quadrato del disco frontale completo, cornice compresa, sfondo trasparente fuori dal disco
(consigliato 1200×1200 px o più). Pubblicato = visibile ai clienti, bozza = nascosto, "Ordine" = posizione.
Nel configuratore compare "Scegli un disegno pronto" (si spegne da Impostazioni → Disegni pronti): il cliente
vede il disegno applicato al disco in 2D/3D, spento e acceso, tutto il resto si blocca. Può convalidarlo:
in tabella risulta "Disegno pronto: nome" e lo zip contiene anteprime, PNG del disegno e riepilogo.

**Catalogo filamenti:** se c'è, il configuratore riduce ogni colore alla bobina più vicina (anteprima con i
colori reali) e i nomi delle bobine finiscono nello zip, nella tabella e nei nomi degli STL. Il cliente non
vede i nomi delle bobine.

**Limiti di upload:** ogni invio pesa circa 3–15 MB. Se `upload_max_filesize` o `post_max_size` del server
sono bassi, la pagina Impostazioni lo segnala in rosso.

## Aggiornare il plugin

Scarica di nuovo lo zip da GitHub. In WordPress → Plugin → Aggiungi nuovo → Carica plugin, scegli
"Sostituisci la versione corrente con quella caricata". Impostazioni e chiavi restano salvate.

## Struttura

- `francy-lamp.php` – file principale del plugin
- `includes/` – impostazioni, endpoint REST, fornitori IA, shortcode, progetti (`designs.php`), filamenti
- `assets/` – il configuratore (funziona anche da solo, vedi [assets/README.md](assets/README.md))

## Endpoint

`POST /wp-json/francy-lamp/v1/ridisegna`

- Body: `{ "image": "data:image/jpeg;base64,..." }`
- Header: `X-WP-Nonce`, stampato dallo shortcode.
- Risposta: `{ "image": "data:image/...;base64,...", "remaining": 2, "provider": "gemini" }`

Le chiavi API restano sul server e non arrivano mai al browser. Le immagini non vengono salvate.

## Fornitori

| Fornitore | Impostazione modello | Note |
|---|---|---|
| Google Gemini | `gemini-2.5-flash-image` | Free tier di AI Studio per i test |
| fal.ai | `fal-ai/flux-pro/kontext`, `fal-ai/qwen-image-edit`, `fal-ai/bytedance/seedream/v4/edit` … | Un'unica chiave per tanti modelli |

**Impostazioni** è divisa in schede: *Panoramica* (ridisegni di oggi, fornitore e modello in uso, limiti del
server, collegamenti rapidi, utilizzo degli ultimi 30 giorni), *Pagina e aspetto* (pagina dedicata, colore dello
sfondo dell'anteprima, footer), *Intelligenza artificiale* (fornitori, chiavi, modello), *Stili e prompt*,
*Disco e regolazioni*, *Ordini e limiti*. L'ultima scheda aperta viene ricordata.

**Modello Gemini**: con **Controlla i modelli disponibili** il plugin chiede a Google l'elenco aggiornato dei modelli
"image" usabili con la tua chiave (stabili prima, anteprime dopo) e li mostra in una tabella: spunti quello che
vuoi e salvi. Resta il campo per scriverlo a mano. L'elenco resta in memoria 12 ore.

**Download e watermark** (Impostazioni → Pagina e aspetto): pacchetto completo, SVG e PNG senza watermark arrivano
al browser **solo agli amministratori** (per gli altri il blocco non viene nemmeno inviato). I clienti hanno solo
**"Scarica l'anteprima"**: un PNG ridotto (lato lungo massimo impostabile, predefinito 640 px) con il watermark.
Il watermark (logo dalla Libreria media oppure testo, colore, trasparenza, dimensione, inclinazione) si ripete
sopra l'anteprima a schermo in 2D/3D e sull'immagine scaricata; nelle impostazioni c'è un'anteprima dal vivo.

**Lampada 3D** (Impostazioni → Lampada 3D): carichi un file per pezzo (base, perni, tappo frontale, cover…) esportati
dalla stessa composizione. Lo STL viene convertito nel browser in un formato compatto (FLM): al sito non arriva mai lo
STL, i file stanno in `uploads/francy-lamp-parti/` (non accessibile dal web) e la pagina li riceve da un endpoint che
richiede il token della pagina. Per ogni pezzo: nome, colore (anche dal catalogo), materiale (opaco, lucido, silk,
metallico) e, se vuoi, i colori tra cui il cliente può scegliere; la scelta finisce nel progetto convalidato e nel
LEGGIMI dello zip. Consiglio: carica modelli "vetrina" (solo forma esterna, senza tolleranze e dettagli interni).
Il plugin non contiene più STL e blocca il download di file 3D dalla sua cartella.

**Nome pubblico delle bobine**: formato del catalogo `Nome vero | Nome pubblico | #rrggbb | TD` (nome pubblico e TD
facoltativi). Il cliente vede solo il nome pubblico (palette, tooltip); il nome vero con la marca non viene mai
inviato al suo browser: al suo posto c'è un codice neutro che il server, alla convalida, sostituisce con il nome vero
nello zip (STL, LEGGIMI, riepilogo, SVG, progetto 3MF) e nella scheda del progetto. L'admin vede sempre i nomi veri.

**Bobine speciali** (Filamenti → secondo elenco): silk, metal e simili per i pezzi della lampada (es. cilindri in PLA
Metal). Non entrano mai nel calcolo dei colori del disco (disegno, fascia, scritte): compaiono solo in Lampada 3D,
nel colore dei pezzi e tra le scelte del cliente, e il loro nome finisce nel progetto convalidato.

**Sfondo dell'anteprima**: un colore solo (Pagina e aspetto), uguale da spenta e da accesa, in 2D, 3D e nelle
immagini PNG; predefinito un grigio scuro che fa risaltare la luce senza nascondere il nero della cornice.

**All'IA va sempre la foto originale intera** (lato lungo max 1536 px, con luminosità/contrasto/saturazione già
applicati), non il ritaglio: il ridisegno torna nello stesso formato (1:1, 3:4, 4:3, 9:16…, il più vicino tra quelli
che Gemini restituisce) e viene rimesso con lo stesso zoom e spostamento, quindi si può ancora spostare e zoomare.
"Torna all'immagine originale" mantiene l'inquadratura attuale. Un nuovo ridisegno riparte sempre dalla foto originale.

Il cliente sceglie tra tre stili: **Fedele** (predefinito: conversione di stile che blocca posa, espressione e
composizione), **Ritratto** (per i volti: poster pop-art con la pelle in 3 toni netti e niente linee nere dentro il viso) e **Anime** (atmosfera da film
d'animazione giapponese classico, sempre a colori piatti stampabili; si spegne da Impostazioni). I tre prompt
si modificano in Impostazioni → Francy Lamp; se il testo è quello predefinito non viene salvato, così gli
aggiornamenti del plugin migliorano anche il tuo prompt.

Nel passo 1, sotto la foto, c'è lo switch **È un volto (ritratto)**, sempre visibile e indipendente dallo stile IA: il convertitore trova la pelle e le dà 3 toni dedicati (il resto
dell'immagine si divide gli altri colori), non disegna linee nere tra i toni della pelle (niente "cicatrici" sul viso),
assorbe le macchioline di pelle e protegge i dettagli circondati dalla pelle (occhi, sopracciglia, narici, bocca)
anche se piccoli. Si accende da solo appena il cliente sceglie lo stile IA **Ritratto** (e si può sempre spegnere).

Con lo switch acceso il configuratore **riconosce il volto** (MediaPipe Face Landmarker, gira nel browser del
cliente, la foto non esce dal dispositivo; ~17 MB scaricati solo la prima volta che si accende lo switch) e
disegna sempre: **occhi** con l'iride del suo colore preso dalla foto, pupilla nera, piccolo riflesso, bianco dove l'occhio
è chiaro e una sottile linea delle ciglia sopra (la palpebra si apre solo se serve per stamparla), **denti** bianchi dentro le labbra. Se il volto non viene trovato (animali, cartoni) restano le
altre regole del ritratto. Per la **pelle** si usano solo bobine color pelle del catalogo (pesca, beige, caramello,
marroni: mai grigi, rosa o colori freddi); se due toni finiscono sulla stessa bobina diventano una zona sola.
Consiglio: tieni in catalogo 3 bobine pelle (chiara, media, ombra).

Sotto lo zoom c'è **Regola immagine** (luminosità, contrasto, saturazione da -100 a +100, pulsante Ripristina):
si applica prima della riduzione dei colori, all'immagine mandata all'IA e al "ritaglio usato" nello zip; i valori
finiscono nel riepilogo del progetto. Con un'immagine nuova o un risultato IA si riparte da zero.

Sotto gli stili c'è l'interruttore **Rimuovi lo sfondo**: se acceso compare il menu **Nuovo sfondo** (Bianco,
Cielo stile anime, Raggi di luce, Onde giapponesi, Tinta unita) e all'IA viene chiesto di
togliere lo sfondo della foto e metterci quello scelto. L'elenco si modifica in Impostazioni → Sfondo, una riga per
sfondo nel formato `Nome | descrizione in inglese`; lo sfondo scelto finisce nel riepilogo del progetto.

Se Gemini risponde senza immagine (es. `IMAGE_OTHER`, un rifiuto senza motivo) il plugin riprova da solo fino a 3 volte
con impostazioni diverse; i tentativi a vuoto non generano immagini e costano pochissimo. Se il principale dà errore si passa da soli al fornitore di riserva. Per aggiungere un fornitore:
una funzione in `includes/providers.php` più una voce in `flc_providers()`.

## Limiti anti-abuso

- Ridisegni per visitatore al giorno (IP anonimizzato con hash, default 10).
- Tetto giornaliero totale (default 300): oltre la soglia il ridisegno si blocca.
- 0 = illimitato. Il contatore conta comunque, utile in fase di test.
- Contatori visibili: in cima alla pagina impostazioni (usati/rimanenti oggi, con barra) e nel
  configuratore sotto il pulsante ("per te X · sul sito Y"). Quando arrivano a zero il pulsante si disattiva.
  Endpoint: `GET /wp-json/francy-lamp/v1/stato`.
- Ogni tentativo conta, anche se fallisce.
- Nella pagina impostazioni c'è il riepilogo degli ultimi 30 giorni.

Nota sulla cache: se la pagina del configuratore viene messa in cache per più di 12 ore, il nonce
scade e il ridisegno risponde "Sessione scaduta". Escludi quella pagina dalla cache.
