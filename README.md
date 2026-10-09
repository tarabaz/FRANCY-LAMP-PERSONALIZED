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

## Il configuratore (lato cliente)

Il pannello sinistro è una sequenza di **passi a fisarmonica**, uno aperto alla volta, con un indicatore in alto
(numeri, ✓ per i passi fatti; si tocca per saltare a un passo):
1. **La tua immagine**: disegni pronti, caricamento, inquadratura, zoom, "Regola immagine", "È un volto".
2. **Ridisegno con IA** (facoltativo): stili, "È una carta da gioco", cambio sfondo, esempi. Il pulsante dice lo stile
   scelto ("Ridisegna in stile Tombino") e dopo il primo ridisegno diventa "Ridisegna di nuovo".
3. **Colori e contorni**: "Grafica con contorni" (predefinita: al primo caricamento dà il risultato più pulito) /
   "Foto o disegno", numero di colori, spessore, regolazioni avanzate.
   La conversione lavora a **10 px/mm** (1 pixel = 0,1 mm; regolabile 4–12, Impostazioni → Disco); le linee nere più
   sottili di ~0,45 mm (meno di una passata dell'ugello 0,4) diventano il colore accanto, così non restano filamenti
   neri quasi invisibili.
4. **Cornice e scritte**: colori di fascia, scritte e pezzi della lampada. 4 scritte (Sopra 1–2, Sotto 1–2, fino a
   40 caratteri) ognuna con uno **slider di posizione**: quelle di sopra scorrono nella metà superiore (fino a quasi
   mezzo cerchio di lunghezza), quelle di sotto nella metà inferiore fermandosi ai lati dell'asola. Se il testo è più
   lungo dello spazio le lettere si rimpiccioliscono; se due scritte si accavallano compare un avviso. Le posizioni
   finiscono nel riepilogo (`scritte.pos`, gradi: 0 = destra, -90 = in alto, 90 = in basso). Lo slider
   **Dimensione scritte** vale per tutte (35–85% dell'altezza della fascia, mostrato in mm; predefinito in
   Impostazioni → Disco → Dimensione delle scritte); un testo troppo lungo per il suo spazio si rimpicciolisce da solo.
   **Fai uscire parti del disegno sopra la fascia** (come nei Poké Lids veri): il cliente tocca sull'anteprima 2D le
   zone che devono uscire dal cerchio (tocco su una linea nera = zona colorata più vicina; di nuovo = la toglie).
   La zona esce fino all'anello nero esterno (che resta sempre sopra) con un contorno nero dello spessore delle linee;
   l'asola in basso resta libera. Il convertitore vettorializza insieme al disegno anche la "zona cornice" (fuori dal
   cerchio, tutto ciò che non esce): fascia, linea interna, scritte e contorno dell'asola vengono ristretti a quella
   zona (libreria polygon-clipping in `assets/vendor/`), quindi i bordi coincidono al millesimo con le parti che
   escono: niente fessure bianche e niente parti sovrapposte in STL/3MF. Gli archi vengono campionati ogni mezzo grado. Fuori dal cerchio conta solo dove c'è davvero l'immagine: serve un po' di zoom perché qualcosa sporga.
   Una zona che riempirebbe gran parte della fascia (sfondo) non esce; se una parte copre una scritta compare un
   avviso. Si spegne in Impostazioni → Disco → Sopra la fascia.
   Con l'interruttore acceso compare **Cornice trasparente** (acceso di serie): fascia, scritte e linea interna al 22% e
   sotto l'immagine com'è inquadrata, per vedere cosa c'è dietro e toccarlo. Solo a schermo: SVG, STL, 3MF, anteprime
   e 3D restano identici.
5. **Conferma**: riepilogo (immagine, stile, sfondo, colori, fascia, scritte), modulo di invio e "Scarica l'anteprima".

**Progetto .francy** (💾 Salva e 📂 Apri nella barra in alto): il cliente scarica sul suo computer un file `.francy`
(JSON compresso gzip) con dentro tutto il lavoro: immagine originale, ridisegno IA (con stile, sfondo e inquadratura
della foto, così "Torna all'originale" funziona ancora), zoom e posizione, regolazioni, modalità, numero di colori e
slider, colori calcolati dalla conversione (riaprendo escono identici), bobine bloccate, colorazioni a mano e penna,
parti sopra la fascia, grafiche aggiuntive (immagini incluse), fascia, scritte con posizione e dimensione, colori della
lampada, accesa/spenta. Con un disegno pronto salva il disegno e la cornice. Riaprendolo (anche su un altro
computer) il configuratore riparte da dove si era rimasti, senza passare dal server. 💾 compare quando c'è qualcosa
da salvare; si spegne in Impostazioni → Funzioni → Salva / apri progetto.

**Guida** (si spegne in Funzioni → Guida e punti interrogativi): il pulsante **❓ Guida** in alto apre una guida
completa in stile wiki **al posto dell'anteprima** (indice delle sezioni a sinistra, testo a destra, ricerca, grande
✕ per chiudere, anche Esc; il pulsante diventa "✕ Chiudi guida"). Su telefono è una pagina a tutto schermo con
l'indice a scorrimento orizzontale; chiudendola si torna esattamente dove si era. Spiega ogni passo e ogni opzione;
le parti di funzioni spente o non presenti sul sito (template, grafiche, sopra la fascia, colori lampada) non compaiono,
la sezione amministratore la vede solo l'admin. Il testo è in `assets/js/guide.js`. Accanto ai comandi meno ovvi c'è
un piccolo **?** con un popup (titolo, spiegazione e "Approfondisci nella guida →" che apre la sezione giusta); i
popup sono nell'elenco `HELP` in fondo a `assets/js/app.js`. Alla prima visita il pulsante Guida pulsa.
Sezioni: come funziona, com'è fatto il disco, i 5 passi, colori del disco, colora a mano, anteprima, salvataggio,
consigli, problemi comuni e soluzioni, glossario, domande frequenti (+ strumenti admin). I titoli della guida non sono
h2/h3/h4 ma elementi propri (`.w-title`, `.w-sub`) e tutto il configuratore ha font, maiuscole e spaziatura propri:
il CSS del tema di WordPress non li cambia.
**Immagini nella guida**: 13 screenshot dell'interfaccia in `assets/img/guida/*.webp` (barra dei passi, inquadratura,
galleria, stili IA, modalità, colori del disco, sostituisci, colora a mano, penna, grafiche, scritte, sopra la fascia,
barra in alto), sostituibili uno per uno in **Impostazioni → Guida** con un'immagine della Libreria media ("Ripristina"
torna a quella del plugin; impostazione `guide_imgs`). Si aggiornano da sole, prese dal sito: gallerie dei template
(primi 8), esempi prima/dopo degli stili IA, esempi degli sfondi, grafiche aggiuntive; e lo **schema del disco** con le
didascalie delle parti, disegnato sul disco che il cliente sta creando.
Nel passo 1 un consiglio spiega che il risultato migliore arriva da un disegno a colori pieni con contorni neri (anche
fatto con un'IA esterna: si carica e si va dritti ai colori, senza consumare ridisegni); per le foto c'è il passo 2.

**Avviso da telefono**: solo su telefono (schermo touch con lato corto sotto 600 px; tablet e PC no) compare in alto
una striscia gialla che consiglia PC o tablet; si chiude con un tocco e non torna fino alla visita successiva.

**Penna** (in "Colora a mano", accanto al 🪣 Secchiello): ✏️ disegno a mano libera con la bobina scelta (pupille,
riflessi, piccoli ritocchi); punta da 0,5 a 6 mm. Il tratto diventa zona vera nei file, resta dopo i ricalcoli e si
toglie con Annulla. Per spostarsi mentre si usa la penna: due dita oppure Maiusc + trascina.

**Funzioni** (Impostazioni → Funzioni): un interruttore per ogni cosa che il cliente può fare (immagine, IA, colori,
cornice e scritte, anteprima, convalida). Le funzioni spente spariscono dal configuratore; la convalida spenta viene
rifiutata anche dal server. Gli interruttori che esistono anche in altre schede sono la stessa impostazione e restano
allineati. Per aggiungere una funzione: una riga in `flc_features()` (`includes/settings.php`, chiave `feat_*`,
accesa di default) e `feature('feat_*')` dove serve in `assets/js/app.js`.

**Ambientazione 3D** (Impostazioni → Anteprima e watermark → Anteprima 3D: ambientazione): nella vista 3D la lampada
è appoggiata su un tavolino da muro (piano in legno, gambe sottili), con il cavo che esce dal centro del retro della base a 2 cm dal piano (spinotto infilato 1,5 mm), passa
sul piano, scende dietro e arriva all'alimentatore 12 V inserito nella presa italiana sul muro, in basso a destra. Il muro
(con la presa) si dissolve quando la vista gira di lato o da dietro. Con 💡 Accesa una luce calda illumina muro e piano.
Tutto generato dal codice (nessun modello da scaricare).
**Insegna** sul tavolino, a sinistra della lampada e girata verso il centro (modello del plugin in
`assets/js/insegna-model.js`, 88 × 57 mm, dentro un modulo JS perché alcuni hosting bloccano i file `.flm`; oppure un
STL caricato in Impostazioni con **Carica STL**, convertito nel browser e servito dal sito come i pezzi della lampada,
`/scena/insegna`; la faccia grande è la superficie piana più estesa e viene girata verso chi guarda): colore, materiale (opaco, lucido, silk, metallico) e colore dell'oro in Impostazioni;
sulla faccia grande una **texture di sfondo** e sopra uno **strato oro metallizzato** dove la seconda texture (stessa
dimensione, proporzione 16:10, es. 1600 × 1000) ha il disegno: PNG trasparente = tutto ciò che non è trasparente; senza
trasparenza = il tono meno presente (nero su bianco o bianco su nero). Il colore del disegno non conta.
**Posizioni sul tavolo** (Impostazioni → Anteprima 3D: ambientazione): in cm rispetto al centro del tavolo e gradi —
lampada X e Y (si sposta il tavolo sotto la lampada, che resta al centro della vista; il cavo si ricalcola dallo spinotto al bordo dietro e alla presa), scatola X/Y/rotazione, targa X/Y/rotazione
(Y = verso il davanti). Predefiniti: lampada −17 / 0 (Y 0 = 7 cm dal bordo dietro) · scatola 30,5 / 2 / −12° · targa −40 / 1,2 / 25°.

**Scatola di spedizione** a destra della lampada (postale a libro, 30,2 × 23,3 × 8,8 cm a misura vera, girata di 12°
verso il centro): la grafica è lo **sviluppo intero** (fustella aperta) ritagliato al contorno esterno, e ogni faccia
prende il suo rettangolo (coperchio con la cerniera dietro, fronte, retro, fianchi, fondo; le linguette interne non
servono). Predefinita: `assets/img/scatola.webp`; si cambia in Impostazioni → Scatola: grafica (stessa fustella, anche
4000–6000 px). Con la scatola il tavolino diventa una console da ~1 m × 36 cm: la lampada sta a sinistra del tavolo, la scatola a ~20 cm alla sua destra, l'insegna all'estrema sinistra; l'inquadratura iniziale è centrata sul disco. Se le impostazioni erano state salvate da una pagina più vecchia (senza le caselle), ambientazione, insegna e scatola restano accese finché non si salva dalla scheda nuova. Impostazioni: accesa all'apertura sì/no, pulsante
"🏠 Ambientazione" per il cliente sì/no, texture del legno e del muro dalla Libreria media (vuote = legno generato e
muro chiaro in tinta unita).

**Disco nel modello 3D**: la posizione si calcola sul modello della lampada (raggi dal davanti dentro l'area del disco):
il disco sta 0,5 mm davanti alla superficie su cui appoggia (cover/diffusore), mai coincidente; senza modello vale
l'incasso delle impostazioni. Profondità logaritmica nel 3D: niente sfarfallio guardando da lontano.

**Curve lisce in 3D e nei file**: ogni curva viene divisa in base alla sua lunghezza (anteprima 3D un tratto ogni
1,2 mm, STL/3MF ogni 0,4 mm) invece che in un numero fisso di tratti: il bordo del disco e della fascia sono tondi
come in 2D, le curve piccole (lettere, contorni) restano leggere. Zip di stampa praticamente della stessa dimensione.

**Zoom dell'anteprima 2D** (l'anteprima occupa tutta l'area grigia: il disco sta centrato e, ingrandendo, il disegno si allarga nello spazio libero invece di restare in un quadrato; solo visualizzazione, SVG/PNG/STL/3MF restano il disco da 200 mm): rotellina del mouse (ingrandisce nel punto sotto il puntatore), pizzico a due dita su
telefono/tablet, pulsanti − + ⤢ nell'angolo (fino a 2000%, ⤢ = tutto il disco). Da ingranditi si trascina per
spostarsi (il trascinamento non colora e non seleziona). Maniglie delle grafiche e tratteggio delle zone restano della
stessa grandezza a schermo. Serve per toccare con precisione zone piccolissime con pennello e "sopra la fascia".

**Grafiche aggiuntive** (Impostazioni → Grafiche: immagini dalla Libreria media, meglio PNG trasparenti con colori
pieni e contorno nero): nel passo "Cornice e scritte" il cliente tocca una grafica per aggiungerla come livello.
Sul disegno la sposta trascinandola, la ingrandisce con la maniglia gialla e la ruota con quella bianca (o con gli
slider della lista); la lista dei livelli ha anche ordine (▲▼) ed elimina. Le grafiche possono andare sopra la fascia
fino all'anello nero esterno (sempre sopra), l'asola resta libera. Prima della conversione vengono disegnate
sull'immagine e convertite con le bobine come il resto (contorno nero e buco esatto nella fascia come "sopra la
fascia"), quindi in SVG/STL/3MF sono forme vere, separate per colore. I colori del disegno non cambiano: della grafica
si aggiungono solo i colori che nel disco mancano.

**Sostituisci un colore**: toccando un colore nell'elenco si sceglie un'altra bobina (anche una già presente): il
colore vecchio viene sostituito ovunque (zone del disegno, fascia, scritte, tocchi del pennello) e la scelta resta 🔒.
Scegliendo una bobina già usata, le zone diventano dello stesso colore e nei file si uniscono.
È una sostituzione, non un'aggiunta: anche con 13 colori su 13 si può scegliere una bobina nuova (il vecchio colore
sparisce). Il **🗑** accanto a ogni colore (non per nero contorni e bianco) lo toglie: le sue zone, e fascia, scritte e
pennellate di quel colore, diventano bianche; si ricolorano quando si vuole. Si spegne in Funzioni → Togli un colore.
L'elenco "Colori del disco" ha **una riga per bobina**: zone diverse sulla stessa bobina (sostituzione su una bobina
già usata, 🗑, toni della pelle) sono una riga sola con l'area sommata; toccarla, il 🗑 e il 🔒 valgono per tutte.
Sostituendo con una bobina già usata, le zone che l'avevano la tengono (🔒) invece di essere spostate su un'altra.

**Colori stabili**: i colori dell'immagine si ricalcolano solo se cambia qualcosa che li riguarda (immagine, numero di
colori, modalità, zoom, regolazioni…); grafiche, "sopra la fascia" e pennello riusano gli stessi colori.

**Le modifiche restano**: le parti sopra la fascia e le colorazioni a mano sono salvate come "punto toccato +
bobina" e vengono riapplicate da sole dopo ogni nuova conversione (accendere/spegnere "Fai uscire", numero di colori,
contorni, zoom…); si tolgono solo con Annulla, un nuovo tocco, "Togli tutte" o un'immagine nuova. Anche le bobine
assegnate in automatico restano ferme dopo ogni conversione: toccare parti o colorare a mano non le rimescola.

**Bobine bloccate**: quando il cliente sceglie a mano la bobina di un colore (tocco sul colore nell'elenco), la
scelta resta 🔒 anche se la conversione si rifà (numero di colori, contorni, zoom…): nella nuova palette si ritrova
la zona con il colore originale più simile e le si rimette quella bobina; le altre zone si adattano senza usarla.
Il lucchetto accanto al nome riporta il colore in automatico. Un'immagine nuova azzera i blocchi.

**Colora a mano** (pulsante 🖌️ nell'elenco "Colori del disco"): si sceglie il pennello tra tutte le bobine
disponibili (o tra i colori del disco) e si tocca sull'anteprima 2D: la zona toccata (com'era nella conversione,
anche dopo uno svuotamento: due zone vicine senza linea nera, es. il viola e la luce sul corpo di Gengar, restano
separate) prende quel colore, le linee nere restano. Mentre si colora, i confini di tutte le zone sono tratteggiati
in rosso sull'anteprima (solo a schermo, non nei file). **Svuota i colori** rende tutto bianco tranne
il nero, **Annulla** toglie l'ultimo tocco. Il colore cambia nella mappa delle zone e il disegno viene
ri-vettorializzato: in SVG, STL per colore e 3MF le zone ricolorate sono davvero forme del nuovo colore (es. la coda
rossa finisce nello STL del rosso). Le bobine oltre il limite dei 13 colori sono disattivate. Una nuova conversione
(immagine, colori o contorni) riparte da zero.

I passi chiusi mostrano un riassunto di una riga (es. "✓ Ridisegnata in stile Tombino") e ognuno ha **Avanti →**.
I colori senza nome pubblico della bobina prendono un nome generico italiano ("Verde lime", "Blu scuro"…) invece
di "Colore 3". Sotto l'anteprima c'è un messaggio che invita ad accendere la lampada.

**Su telefono** l'anteprima resta fissa in alto (metà schermo) mentre si scorrono i passi, l'indicatore resta
agganciato sotto e i colori del disco stanno dentro il passo "Colori e contorni".

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
**Elabora questo disegno** (solo amministratore): con un disegno pronto scelto, nella barra in alto compare
"⚙️ Elabora questo disegno". Il disegno diventa la sorgente di tutto il disco (Ø200, immagine presa pari pari): fascia,
scritte e anello disegnati nell'immagine vengono convertiti come il resto, la cornice del plugin non viene aggiunta;
resta solo la sagoma fisica del disco (contorno, fori laterali, asola). Colori, contorni, sostituzione colori,
pennello, penna e lucchetti funzionano come sempre e si esportano STL/3MF/SVG. Scritte, colore fascia, "sopra la
fascia" e grafiche sono nascosti; "✕ Esci dall'elaborazione" torna al normale.

**💾 Salva nel disegno pronto** (barra in alto, durante l'elaborazione): manda al sito il PNG del disco così com'è
adesso (1600 px, trasparente fuori dal disco), SVG, EPS, 3MF Bambu e il progetto `.francy`. Il PNG diventa la
versione che i clienti vedono nella galleria e nell'anteprima al posto dell'immagine caricata all'inizio, che resta
come immagine in evidenza; SVG/EPS/3MF/progetto vanno nella cartella protetta (`uploads/francy-lamp/disegni/…`) e si
scaricano solo da admin. Nell'elenco Disegni pronti la colonna **Pronto da stampare** mostra ✓ con data e link
(3MF · EPS · SVG · Progetto · PNG); nella modifica del disegno il riquadro omonimo ha anche "Rimuovi elaborazione"
(i clienti tornano a vedere l'originale). Rielaborando un disegno già salvato si riparte dal suo progetto (colori,
pennello, penna, lucchetti), non dal PNG. Salvando di nuovo l'elaborazione vecchia viene sostituita. Il pulsante
diventa "✓ Salvato" finché il disco non cambia. Se un cliente convalida un disegno pronto, nel LEGGIMI c'è scritto che
i file di stampa sono già in Disegni pronti. Endpoint: `POST /disegni/{id}/elaborato` (solo admin).

**📌 Crea template** (solo amministratore, barra in alto): un progetto fatto nel configuratore (anche riaperto da un
file `.francy`) diventa un nuovo disegno pronto. Si sceglie nome, categoria e se pubblicarlo subito; il template nasce
con immagine (disco completo, sfondo trasparente), 3MF, EPS, SVG e progetto, quindi è già "✓ Pronto da stampare" e
compare subito nella galleria. Dopo la creazione "💾 Salva nel disegno pronto" lo aggiorna; riaprendolo con
"⚙️ Elabora questo disegno" si riparte dal progetto vero (scritte, colori, pennellate), non dal PNG. L'immagine creata è
anche l'immagine in evidenza: "Rimuovi elaborazione" toglie solo i file di stampa. Endpoint: `POST /disegni/nuovo`.
**✏️ Apri nel configuratore** (Disegni pronti, colonna "Pronto da stampare" e riquadro nella modifica): apre in una
nuova scheda il configuratore con quel disegno già in elaborazione (dal suo progetto se c'è, anche se è in bozza);
"Progetto" accanto continua a scaricare il file `.francy`. Indirizzo: pagina del configuratore con `?flc_tpl=ID`.
**Progetti dei clienti con il .francy**: alla convalida il configuratore invia anche il progetto completo
(`progetto.francy`, salvato nella cartella protetta del progetto). In Progetti, colonna File e riquadro laterale:
**✏️ Apri nel configuratore** (nuova scheda, riapre il disco del cliente com'era: immagine, ridisegno IA, colori,
pennellate, scritte… da lì anche 📌 Crea template) e il download del `.francy`. Indirizzo: `?flc_prj=ID`. I progetti
inviati prima di questa versione non hanno il .francy.
**I miei progetti separati da quelli dei clienti**: un disco convalidato mentre sei loggato come amministratore viene
segnato come tuo. In Progetti la vista "Tutti" mostra prima il blocco **👤 I miei progetti** (righe evidenziate in
giallo, etichetta MIO) e sotto **🛒 Progetti dei clienti**; in alto ci sono anche i filtri "👤 I miei" e "🛒 Clienti".
I progetti già esistenti vengono riconosciuti dall'email (quella dell'admin o di un amministratore). Se uno finisce nel
gruppo sbagliato, nella scheda del progetto c'è la casella "👤 Progetto mio".

## Codici d'accesso (fiere, clienti fissi)

Codici che dai tu, senza account WordPress: valgono solo per il configuratore. Si gestiscono in **Impostazioni → Accessi**.

- **Profili** (es. Fiera, VIP): le funzioni si spuntano in **Impostazioni → Funzioni**, che ha una colonna per
  **Ospite** (chi entra senza codice, sono le spunte di sempre) e una per ogni profilo. Un profilo nuovo aggiunge da
  solo la sua colonna, la voce nei menu dei codici e il filtro in Progetti. Ogni profilo ha i limiti del ridisegno IA:
  **al giorno per persona** e **totali per ogni codice** (0 = senza limite). Eliminando un profilo con dei codici,
  chiede in quale profilo spostarli.
- **Codici**: "+ Nuovo codice" crea una riga con codice casuale (si adatta al nome, es. `LUCCA-K7M4`), profilo e
  scadenza a 30 giorni; i limiti vuoti usano quelli del profilo. Per ogni codice: attivo sì/no, uso (ridisegni,
  dischi inviati, accessi, ultimo accesso), **📱 QR** (PNG con QR e codice scritto sotto, oppure SVG) e **🔗 link**
  `…/configuratore/?accesso=CODICE` che fa entrare direttamente. Per una fiera finita meglio togliere "Attivo" che
  eliminare il codice.
- **Nel configuratore**: "🔑 Accedi" in alto a sinistra (codice, oppure "Sei l'amministratore del sito?" con utente e
  password di WordPress). Da dentro il pulsante mostra 🎟️ nome del codice (o 👤 per l'admin) ed "Esci". Se l'ospite non
  ha il ridisegno ma un profilo sì, il passo 2 mostra il lucchetto con "Ho un codice: accedi".
- **Sicurezza**: tutto è controllato dal server (ridisegno, limiti, convalida); il cookie è firmato e cambiando il
  codice chi era dentro esce; dopo 5 codici sbagliati dallo stesso IP blocco di 15 minuti. Con un codice valgono i
  limiti del codice e non quello per IP (in fiera tante persone hanno lo stesso wifi); il limite giornaliero di tutto
  il sito vale sempre. L'amministratore ha tutto ciò che è acceso in almeno una colonna.
- **Progetti**: colonna **Provenienza** (🎟️ codice · profilo, oppure Ospite), filtri per profilo accanto a
  "I miei / Clienti" e tendina "Tutti gli accessi". Il nome del codice resta sul disco anche se lo elimini.
**📌 Converti in template** (Progetti, colonna File "📌 Template" e riquadro laterale): apre il progetto del cliente nel
configuratore con la finestra "Crea template" già aperta (`?flc_prj=ID&flc_mk=1`). Solo per i progetti con il .francy.
Template, file di stampa e progetti si creano, modificano e scaricano solo da amministratore (pulsanti nascosti agli
altri e richieste rifiutate dal server). Gli indirizzi dei file per il configuratore non sono codificati per l'HTML
(prima `&amp;` faceva perdere la chiave di sicurezza: errore 403 aprendo un progetto o il progetto di un template).
La prima volta che si apre l'anteprima 3D la lampada è accesa.

**Importa in blocco** (Disegni pronti → "Importa in blocco (immagini o ZIP)", oppure menu → Importa disegni): si
trascinano più immagini (PNG/JPG/WEBP) e/o file ZIP; il nome del file diventa il nome del disegno (`_` e `-` diventano
spazi, modificabile prima di importare). Pubblica subito o bozza; se esiste già un disegno con lo stesso nome lo salta
o ne sostituisce l'immagine. Lo ZIP si apre nel browser e le immagini arrivano al sito una alla volta, quindi non
contano i limiti di upload dell'hosting.

**Sfondi IA, esempio caricato**: nella tabella degli sfondi (Impostazioni → Sfondi IA) ogni riga ha, oltre a
"✨ Genera prova", **📁 Carica immagine**: un'immagine dalla Libreria media diventa l'esempio di quello sfondo mostrato
ai clienti (ritagliata quadrata a 640 px, al posto della prova generata). Endpoint: `POST /sfondi/carica`.

**Galleria per tanti disegni** (anche centinaia): la finestra "Scegli un template pronto" è grande, con la barra fissa
in alto e la griglia che scorre sotto. Si può **cercare per nome** (senza accenti, più parole = tutte devono esserci,
vale anche il nome della categoria), filtrare per **categoria** (chip con il numero di disegni) e regolare la
**grandezza delle anteprime** con lo slider 🔎 (ricordata nel browser). Le immagini si caricano solo quando entrano
nello schermo. L'admin ha in più il filtro "✓ Pronti da stampare / Da elaborare" e il bollino ✓ 3MF sulle schede.
Su telefono la finestra è a schermo intero. **Categorie**: menu → Categorie disegni, oppure le caselle nella modifica
del disegno; nell'elenco admin c'è la colonna e il filtro per categoria. Nell'importazione in blocco si sceglie una
categoria per tutti, oppure riga per riga; con uno ZIP diviso in cartelle (`Pokemon/gengar.png`) la cartella diventa
la categoria.

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
- `includes/` – impostazioni, endpoint REST, fornitori IA, shortcode, progetti (`designs.php`), filamenti, codici d'accesso (`access.php`)
- `assets/vendor/qrcode.js` – generatore QR (Kazuhiko Arase, licenza MIT) per i codici d'accesso
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

**Impostazioni** ha un menu laterale con il sottotitolo di ogni sezione:
- *Panoramica*: la lista **È tutto a posto?** (pagina online, IA attiva, bobine, pezzi 3D, sfondi senza prova,
  stili senza esempio, limiti del server), ognuna con il link per sistemarla; ridisegni di oggi e collegamenti rapidi.
- *Pagina*: indirizzo, aspetto (colore di sfondo dell'anteprima), disegni pronti e footer.
- *Disco*: il disco di partenza; le regolazioni fini della conversione sono chiuse in "Avanzate".
- *Stili IA*: una card per stile con esempio, "Visibile ai clienti" e il prompt nascosto sotto "Modifica il prompt",
  con il badge originale/personalizzato e **↺ Ripristina il testo originale**. Ci sono anche le carte da gioco e gli esempi.
- *Sfondi IA*: la tabella degli sfondi con le prove.
- *Motore IA*: interruttore, chiave e modello Gemini, limiti di spesa; fal.ai e il fornitore di riserva stanno in "Avanzate".
- *Anteprima e watermark*, *Lampada 3D*, *Ordini*.

Se modifichi qualcosa compare "Hai modifiche non salvate" vicino a Salva, e il browser ti avvisa prima di uscire.
L'ultima sezione aperta viene ricordata.

**Modello Gemini**: con **Controlla i modelli disponibili** il plugin chiede a Google l'elenco aggiornato dei modelli
"image" usabili con la tua chiave (stabili prima, anteprime dopo) e li mostra in una tabella: spunti quello che
vuoi e salvi. Resta il campo per scriverlo a mano. L'elenco resta in memoria 12 ore.

**Download e watermark** (Impostazioni → Pagina e aspetto): pacchetto completo, SVG e PNG senza watermark arrivano
al browser **solo agli amministratori** (per gli altri il blocco non viene nemmeno inviato). I clienti hanno solo
**"Scarica l'anteprima"**: un PNG ridotto (lato lungo massimo impostabile, predefinito 640 px) con il watermark.
Il watermark (logo dalla Libreria media oppure testo, colore, trasparenza, dimensione, inclinazione) si ripete
solo sull'immagine scaricata: la vista del progetto resta pulita (si può accendere anche a schermo, ma è
sconsigliato). Nelle impostazioni c'è un'anteprima dal vivo.

**Lampada 3D** (Impostazioni → Lampada 3D): carichi un file per pezzo (base, perni, tappo frontale, cover…) esportati
dalla stessa composizione. Lo STL viene convertito nel browser in un formato compatto (FLM): al sito non arriva mai lo
STL, i file stanno in `uploads/francy-lamp-parti/` (non accessibile dal web) e la pagina li riceve da un endpoint che
richiede il token della pagina. Per ogni pezzo: nome, colore (anche dal catalogo), materiale (opaco, lucido, silk,
metallico) e, se vuoi, i colori tra cui il cliente può scegliere; la scelta finisce nel progetto convalidato e nel
LEGGIMI dello zip. Consiglio: carica modelli "vetrina" (solo forma esterna, senza tolleranze e dettagli interni).
Il plugin non contiene più STL e blocca il download di file 3D dalla sua cartella.

**Catalogo filamenti** (Francy Lamp Factory → Filamenti): tabella modificabile direttamente nelle celle (colore con
anteprima, HEX, nome vero, nome pubblico, TD, tipo Disco/Speciale, Disponibile), con ricerca, filtro, ordinamento,
"+ Aggiungi bobina" e un solo "Salva modifiche". Le bobine non disponibili restano in elenco ma il configuratore non
le usa. Sotto, "Importa / esporta come testo" per caricare tante bobine in una volta.
In alto si scelgono le **bobine fisse**: il bianco della base (ugello 1, es. Bambu PLA Matte Ivory White) e il nero
delle linee; se lasciate su "automatico" si usano le bobine del disco più vicine al bianco e al nero.

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

Il cliente sceglie tra quattro stili:
- **Fedele** (predefinito): conversione di stile che blocca posa, espressione e composizione.
- **Ritratto**: per i volti, poster pop-art con la pelle in 3 toni netti e niente linee nere dentro il viso.
- **Tombino** (stile Poké Lids, i tombini Pokémon giapponesi): ridisegno FEDELE di personaggi, pose e scena
  dell'originale (niente elementi inventati) con contorni neri netti e un solo colore pieno dentro ogni forma, senza
  sfumature né texture; va bene per persone, animali, personaggi e oggetti. Insieme alla foto partono 1–3
  **tombini di riferimento** (Impostazioni → Stili IA → Tombino, dalla Libreria media; se non ne scegli si usano i
  2 esempi inclusi in `assets/ref/`): l'IA ne copia lo stile, non il contenuto. Meglio caricare solo l'interno
  del tombino, senza la fascia con le scritte.
- **Anime**: atmosfera da film d'animazione giapponese.

In tutti gli stili l'IA deve togliere ogni scritta in qualsiasi lingua (anche giapponese e cinese, insegne,
loghi): le scritte le mette il configuratore sulla fascia. Ritratto, Tombino e Anime si possono nascondere. I prompt si modificano in Impostazioni → Stili IA; se il testo è
quello predefinito non viene salvato, così gli aggiornamenti del plugin migliorano anche il tuo prompt.

**Ridisegno con IA**: a Gemini va sempre **l'immagine intera** con le sue proporzioni (formato più vicino tra quelli
che Gemini sa restituire), non solo la parte inquadrata; il risultato copre tutta l'immagine e viene rimesso con la
stessa inquadratura, quindi si può ancora spostare e zoomare.

**È una carta da gioco**: interruttore nel riquadro IA, da accendere solo quando il cliente carica una carta (es.
Pokémon). Viene mandata la carta intera e l'IA tiene solo l'illustrazione: toglie cornice, nome, PS, testi degli
attacchi, simboli, loghi e copyright (in qualsiasi lingua), continua l'illustrazione dove era coperta e poi
applica lo stile scelto. Il prompt della carta dice solo cosa togliere: lo stile lo decide il prompt dello stile. Il risultato ha lo
stesso formato della carta e torna con la stessa inquadratura. Si spegne da Impostazioni → Stili IA, dove si può modificare anche il suo prompt.

Il pannello sinistro del configuratore si allarga trascinando il suo bordo destro (280–640 px; il browser se lo
ricorda, doppio clic = larghezza normale). Scegliendo uno sfondo IA, il cliente vede la prova salvata come esempio.
**Ridisegna di nuovo** manda sempre la foto originale (con le regolazioni usate la prima volta), mai il ridisegno precedente.

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
togliere lo sfondo della foto e metterci quello scelto. Gli sfondi si gestiscono in Impostazioni → Sfondi IA, in una tabella come quella dei filamenti: nome per il cliente, categoria (solo per te, con filtro),
descrizione per l'IA (in inglese), *Attivo* (uno spento resta salvato ma il cliente non lo vede), frecce per l'ordine
del menu (il primo attivo è quello proposto), ricerca, filtri "Solo spenti" / "Senza prova", **+ Aggiungi sfondo** e
**+ Aggiungi i suggeriti** (una libreria di sfondi pronti: cielo stellato, tramonto, galassia, fiamme, pixel art…,
aggiunti spenti). Ogni riga ha **✨ Genera prova**: Gemini disegna solo lo sfondo, senza soggetto, in formato quadrato,
così vedi che tipo di immagine esce (costa come un ridisegno; le miniature stanno in `uploads/francy-lamp-sfondi`).
La tabella ha il suo **Salva sfondi**, ma se ci sono modifiche le salva anche il "Salva" generale.

Nella scheda c'è anche la scelta **Personalizza…** (nome modificabile): il cliente scrive lui lo sfondo
(max 160 caratteri, anche in italiano) e il testo entra nel prompt solo come descrizione dello sfondo, ignorando altre
richieste e mantenendo le regole di stampa. Con **Prova come un cliente** scrivi un testo, generi la prova e, se ti
piace, lo aggiungi alla tabella. Lo sfondo scelto (o "Personalizzato: …") finisce nel riepilogo del progetto.

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
