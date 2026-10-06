# Francy Lamp – plugin WordPress

Configuratore delle lampade "tombino" personalizzate di FrancyStore3D, con ridisegno IA opzionale.
Il repository è direttamente il plugin: `francy-lamp.php` sta nella root.

## Installazione

1. Su GitHub: **Code → Download ZIP** (lo zip contiene una sola cartella con il plugin dentro, come vuole WordPress).
2. WordPress → Plugin → Aggiungi nuovo → Carica plugin → scegli lo zip → Attiva.
3. Crea una pagina e inserisci lo shortcode `[francy_lamp]`.
4. Impostazioni → Francy Lamp: inserisci la chiave API e scegli il fornitore.

Il pulsante "Ridisegna in stile tombino" compare solo se il ridisegno è attivo e c'è almeno una chiave.

## Aggiornare il plugin

Scarica di nuovo lo zip da GitHub. In WordPress → Plugin → Aggiungi nuovo → Carica plugin, scegli
"Sostituisci la versione corrente con quella caricata". Impostazioni e chiavi restano salvate.

## Struttura

- `francy-lamp.php` – file principale del plugin
- `includes/` – impostazioni, endpoint REST, fornitori IA, shortcode
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
