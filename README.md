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

**Francy Lamp Factory → Esempi stili**: carichi una foto d'esempio e per ognuno dei 3 stili (Fedele,
Vetrata, Anime) premi **Genera** (un ridisegno a pagamento, una volta sola) oppure **Carica il tuo**.
Nel configuratore, sotto i pulsanti degli stili, il cliente vede "Foto → risultato" dello stile selezionato,
senza spendere ridisegni. Si nasconde da Impostazioni → Prompt. File pubblici in `uploads/francy-lamp-esempi/`.

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

Il cliente sceglie tra tre stili: **Fedele** (predefinito: conversione di stile che blocca posa, espressione e
composizione), **Vetrata** (vetrata da cattedrale: tessere di colore pieno divise da piombature nere, perfetta retroilluminata) e **Anime** (atmosfera da film
d'animazione giapponese classico, sempre a colori piatti stampabili; si spegne da Impostazioni). I tre prompt
si modificano in Impostazioni → Francy Lamp; se il testo è quello predefinito non viene salvato, così gli
aggiornamenti del plugin migliorano anche il tuo prompt.

Sotto gli stili c'è l'interruttore **Rimuovi lo sfondo**: se acceso compare il menu **Nuovo sfondo** (Bianco,
Vetrata da cattedrale, Cielo stile anime, Raggi di luce, Onde giapponesi, Tinta unita) e all'IA viene chiesto di
togliere lo sfondo della foto e metterci quello scelto. L'elenco si modifica in Impostazioni → Sfondo, una riga per
sfondo nel formato `Nome | descrizione in inglese`; lo sfondo scelto finisce nel riepilogo del progetto.

Se il principale dà errore si passa da soli al fornitore di riserva. Per aggiungere un fornitore:
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
