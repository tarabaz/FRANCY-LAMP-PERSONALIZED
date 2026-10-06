# Francy Lamp – plugin WordPress

Configuratore delle lampade "tombino" personalizzate di FrancyStore3D, con ridisegno IA opzionale.
Il repository è direttamente il plugin: `francy-lamp.php` sta nella root.

## Installazione

1. Su GitHub: **Code → Download ZIP** (lo zip contiene una sola cartella con il plugin dentro, come vuole WordPress).
2. WordPress → Plugin → Aggiungi nuovo → Carica plugin → scegli lo zip → Attiva.
3. Crea una pagina e inserisci lo shortcode `[francy_lamp]`.
4. Menu **Francy Lamp Factory → Impostazioni**: inserisci la chiave API e scegli il fornitore.
5. Menu **Francy Lamp Factory → Filamenti**: incolla il catalogo delle tue bobine (`Nome | #rrggbb`, una per riga).

Il pulsante "Ridisegna in stile tombino" compare solo se il ridisegno è attivo e c'è almeno una chiave.

## Il flusso

1. Il cliente personalizza il disco e preme **"Convalida il mio disco"** (nome, email, telefono, note, consenso).
   Non può scaricare file: SVG, STL e PNG li scarichi solo tu (da admin, sul configuratore o dalla tabella).
2. Il browser prepara uno **zip completo** e lo invia al sito:
   - `01_anteprime/` anteprima spenta e accesa
   - `02_immagini/` originale caricato, eventuale ridisegno IA, ritaglio usato
   - `03_vettoriale/` `disco.svg` e `disco.eps` (modificabili a mano)
   - `04_stl/` un STL per colore, stessa origine, col nome della bobina nel file
   - `LEGGIMI-filamenti.txt` e `riepilogo.json`: bobine da montare, ruolo di ogni colore, area
3. In **Francy Lamp Factory → Progetti** compare la voce con codice (es. `FL-2026-0001`), anteprima, cliente,
   filamenti, stato (Nuovo / In lavorazione / Stampato / Consegnato / Annullato) e il pulsante **Scarica zip**.
   Ti arriva anche una mail di notifica.

I file stanno in `wp-content/uploads/francy-lamp/<cartella casuale>/`, protetti da `.htaccess`
(su Nginx la cartella casuale li rende comunque non indovinabili). Si scaricano solo da admin.
Cancellando definitivamente un progetto si cancellano anche i suoi file.

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

Il cliente sceglie tra **Fedele al soggetto** (predefinito: mantiene volto, occhi, sorriso, pettinatura) e
**Più stilizzato** (forme più semplici, utile per sfondi e oggetti). I due prompt si modificano in
Impostazioni → Francy Lamp; se il testo è quello predefinito non viene salvato, così gli aggiornamenti del
plugin migliorano anche il tuo prompt.

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
