// Guida completa del configuratore (stile wiki): si apre al posto dell'anteprima con ❓ Guida.
// Ogni sezione: id (ancora), titolo, icona, quando mostrarla (show) e il testo in HTML.
// Dentro il testo, un blocco con data-feat="feat_…" sparisce se quella funzione è spenta (Impostazioni → Funzioni);
// data-show="tpl|overflow|stickers|lamp" sparisce se sul sito quella cosa non c'è (nessun template, nessuna grafica…).
// Immagini: <figure data-gimg="chiave"> = screenshot in assets/img/guida/<chiave>.webp (sostituibile da Impostazioni →
// Guida); <div data-gallery="styles|backgrounds|templates|stickers"> = immagini vere del sito; data-diagram="disc" =
// schema del disco con le didascalie, disegnato sul disco che il cliente sta creando.

// chiavi e nomi delle immagini della guida (lo stesso elenco è in includes/settings.php, flc_guide_images)
export const GUIDE_IMAGES = {
  passi: 'Barra dei passi', inquadratura: 'Inquadratura', galleria: 'Galleria dei template', 'stili-ia': 'Stili IA',
  modalita: 'Modalità', 'colori-disco': 'Colori del disco', sostituisci: 'Sostituisci un colore',
  'colora-a-mano': 'Colora a mano (secchiello)', penna: 'Penna', grafiche: 'Grafiche aggiuntive', scritte: 'Scritte',
  'sopra-fascia': 'Sopra la fascia', barra: 'Barra in alto',
};

export const GUIDE = [
  {
    id: 'intro', icon: '👋', title: 'Come funziona',
    html: `
<p>Con questo configuratore crei il <strong>disco frontale della tua lampada</strong>: un disco di 20 cm stampato in 3D a più colori, con il tuo disegno al centro e una fascia con le scritte intorno, come i tombini decorati giapponesi.</p>
<p>Il configuratore trasforma la tua immagine in <strong>zone di colore pieno</strong>, ognuna stampata con una bobina di filamento, separate da <strong>linee nere</strong>. Tutto quello che vedi nell'anteprima è esattamente quello che verrà stampato.</p>
<h4>Il percorso in 5 passi</h4>
<ol>
  <li><a href="#guida-img">La tua immagine</a>: carichi una foto o un disegno, oppure scegli un template pronto.</li>
  <li><a href="#guida-ai">Ridisegno con IA</a> (facoltativo): l'IA trasforma una foto in un disegno adatto alla stampa.</li>
  <li><a href="#guida-colors">Colori e contorni</a>: quanti colori usare e quanto spesse le linee nere.</li>
  <li><a href="#guida-frame">Cornice e scritte</a>: colori della fascia, scritte personalizzate, extra.</li>
  <li><a href="#guida-confirm">Conferma</a>: invii il disco, noi lo controlliamo e ti ricontattiamo.</li>
</ol>
<figure class="w-fig" data-gimg="passi"><figcaption>La barra dei passi: il numero giallo è il passo aperto, ✓ quelli completati.</figcaption></figure>
<p>I passi sono nel pannello a sinistra: si aprono uno alla volta, ognuno ha <strong>Avanti →</strong> e la barra in alto con i numeri ti permette di saltare a qualsiasi passo. Un passo completato mostra ✓ e un riassunto di una riga.</p>
<p>A destra trovi i <a href="#guida-palette">colori del disco</a>, al centro l'<a href="#guida-preview">anteprima</a>. Accanto a molti comandi c'è un piccolo <span class="help-q help-q-demo">?</span>: toccalo per una spiegazione veloce.</p>`,
  },
  {
    id: 'disc', icon: '🔍', title: "Com'è fatto il disco",
    html: `
<p>Conoscere com'è fatto il disco aiuta a capire perché il configuratore lavora in un certo modo.</p>
<div class="w-diagram" data-diagram="disc"></div>
<table>
  <tr><th>Parte</th><th>Cos'è</th></tr>
  <tr><td><strong>Disco</strong></td><td>20 cm di diametro, spesso 1 mm: una <strong>base bianca</strong> piena (circa 0,5 mm) e sopra il <strong>disegno colorato</strong> (circa 0,5 mm).</td></tr>
  <tr><td><strong>Disegno</strong></td><td>Il cerchio centrale con la tua immagine, diviso in zone di colore pieno.</td></tr>
  <tr><td><strong>Linee nere</strong></td><td>I contorni che separano le zone, come in un fumetto. Danno definizione e nascondono i passaggi tra un colore e l'altro.</td></tr>
  <tr><td><strong>Fascia</strong></td><td>L'anello colorato intorno al disegno, dove stanno le scritte.</td></tr>
  <tr><td><strong>Anello nero esterno</strong></td><td>Il bordo del disco: è sempre nero e sta sempre sopra a tutto.</td></tr>
  <tr><td><strong>Asola e fori</strong></td><td>L'incavo a U in basso e i due fori laterali servono a montare il disco sulla lampada: lì non si può disegnare.</td></tr>
</table>
<h4>Perché zone di colore pieno?</h4>
<p>La stampante non sfuma: ogni punto del disco è di <strong>un solo filamento</strong>. Per questo la tua immagine viene semplificata in poche zone nette, ognuna con la sua bobina. Le sfumature di una foto diventano «gradini» di colore: per questo i disegni stile cartone vengono meglio.</p>
<h4>E con la luce?</h4>
<p>La lampada si illumina da dietro: la luce attraversa il disco. I colori <strong>chiari</strong> lasciano passare molta luce e brillano, quelli <strong>scuri</strong> poca, il <strong>nero</strong> quasi niente (e infatti fa da contorno). Guarda sempre l'anteprima <strong>💡 Accesa</strong> prima di decidere.</p>`,
  },
  {
    id: 'img', icon: '🖼️', title: '1 · La tua immagine',
    html: `
<h4 data-show="tpl">Scegli un template pronto</h4>
<div data-show="tpl">
<p>Disegni già preparati e ottimizzati per la stampa. Si apre una galleria:</p>
<ul>
  <li><strong>Cerca</strong>: scrivi un nome (es. «pikachu»); gli accenti non contano e più parole devono esserci tutte.</li>
  <li><strong>Categorie</strong>: i bottoni sotto la ricerca filtrano per tema; il numero indica quanti disegni ci sono.</li>
  <li><strong>🔎 Grandezza anteprime</strong>: lo slider ingrandisce o rimpicciolisce le miniature (viene ricordato).</li>
</ul>
<div class="w-gallery" data-gallery="templates"></div>
<figure class="w-fig" data-gimg="galleria"><figcaption>La galleria: ricerca, categorie e slider per la grandezza delle anteprime.</figcaption></figure>
<p>Toccando un disegno lo vedi subito sulla lampada. I template <strong>non si modificano</strong> nel disegno, ma puoi comunque scegliere scritte e colori della lampada. <strong>Torna a personalizzare</strong> riporta alla tua immagine.</p>
</div>
<h4>Carica un'immagine</h4>
<p>Una foto o un disegno dal tuo dispositivo (JPG, PNG, WEBP…). Il risultato migliore arriva da un <strong>disegno a colori pieni con contorni neri</strong> (stile cartone o fumetto): se ce l'hai già, anche fatto con un'IA, caricalo e passa direttamente ai colori. Con una foto conviene usare il <a href="#guida-ai">ridisegno con IA</a>.</p>
<h4>Che immagine scegliere</h4>
<table>
  <tr><th>Funziona bene</th><th>Funziona meno bene</th></tr>
  <tr><td>Disegni, fumetti, personaggi di cartoni e videogiochi, loghi, illustrazioni con contorni neri</td><td>Foto con tante sfumature, controluce o molto scure</td></tr>
  <tr><td>Un soggetto grande e ben visibile</td><td>Tanti soggetti piccoli o paesaggi molto dettagliati</td></tr>
  <tr><td>Colori decisi e separati</td><td>Immagini sfocate, sgranate o molto piccole</td></tr>
</table>
<p class="note">Consiglio: un'immagine di almeno <strong>1000 pixel</strong> di lato. Le foto si possono comunque usare benissimo passando dal <a href="#guida-ai">ridisegno con IA</a>.</p>
<h4>Inquadratura e zoom</h4>
<figure class="w-fig" data-gimg="inquadratura"><figcaption>Il cerchio mostra la parte dell'immagine che finirà sul disco.</figcaption></figure>
<p>Nel cerchio vedi la parte dell'immagine che finirà sul disco. <strong>Trascina</strong> per spostarla, usa la <strong>rotellina</strong> del mouse o lo slider <strong>Zoom</strong> per ingrandirla. Tutto ciò che resta fuori dal cerchio non viene stampato (salvo le parti <a href="#guida-frame">sopra la fascia</a>).</p>
<h4 data-feat="feat_upload_adjust">Regola immagine</h4>
<p data-feat="feat_upload_adjust">Si apre toccando «Regola immagine». Interviene sull'immagine <strong>prima</strong> che venga divisa in colori:</p>
<ul data-feat="feat_upload_adjust">
  <li><strong>Luminosità</strong>: schiarisce o scurisce; utile se le zone scure si confondono col nero delle linee.</li>
  <li><strong>Contrasto</strong>: separa meglio chiari e scuri.</li>
  <li><strong>Saturazione</strong>: colori più vivi = colori più facili da distinguere tra loro.</li>
  <li><strong>Ripristina</strong>: torna ai valori originali.</li>
</ul>
<h4 data-feat="feat_portrait">È un volto (ritratto)</h4>
<p data-feat="feat_portrait">Da accendere per le persone: la pelle riceve <strong>3 toni dedicati</strong>, dentro il viso non vengono create linee nere che lo «sporcherebbero», e occhi, sopracciglia e bocca vengono protetti anche se piccoli.</p>`,
  },
  {
    id: 'ai', icon: '✨', title: '2 · Ridisegno con IA', show: (c) => c.ai,
    html: `
<p>Facoltativo. L'intelligenza artificiale ridisegna la tua foto in uno stile adatto alla stampa: colori pieni, contorni neri, niente sfumature. È il modo migliore per partire da una <strong>foto</strong>.</p>
<h4>Gli stili</h4>
<ul>
  <li><strong>Fedele</strong>: stessa posa, espressione e colori della foto, in versione disegno.</li>
  <li><strong>Ritratto</strong>: per le persone, stile pop-art con pochi colori decisi.</li>
  <li><strong>Tombino</strong>: lo stile dei tombini decorati giapponesi (Poké Lids), piatto e pulito.</li>
  <li><strong>Anime</strong>: come un personaggio di cartone animato giapponese.</li>
</ul>
<div class="w-gallery w-pairs" data-gallery="styles"></div>
<figure class="w-fig" data-gimg="stili-ia"><figcaption>I quattro stili: tocca quello che vuoi prima di ridisegnare.</figcaption></figure>
<p>Sotto gli stili vedi un <strong>esempio</strong> di prima/dopo dello stile scelto.</p>
<h4>È una carta da gioco</h4>
<p>Se hai fotografato una carta (es. Pokémon), l'IA tiene solo l'illustrazione e toglie cornice, scritte e simboli della carta.</p>
<h4>Rimuovi lo sfondo</h4>
<p>Toglie lo sfondo della foto e ne mette uno nuovo: scegli dall'elenco (con un'immagine d'esempio) oppure, se c'è «Personalizza», descrivilo con parole tue (es. «cielo stellato con la luna piena»). L'esempio è indicativo: l'IA adatta lo sfondo alla tua foto.</p>
<div class="w-gallery" data-gallery="backgrounds"></div>
<h4>Ridisegna</h4>
<p>Il pulsante dice lo stile scelto (es. «Ridisegna in stile Tombino»); dopo il primo ridisegno diventa «Ridisegna di nuovo». Ci vuole qualche secondo. L'IA usa la foto <strong>originale</strong> con l'inquadratura che hai scelto, anche quando ridisegni più volte, quindi non perde qualità a ogni tentativo. Ogni ridisegno è un po' diverso: se il primo non ti convince, riprova. <strong>Torna all'immagine originale</strong> annulla il ridisegno. Sotto il pulsante vedi quanti <strong>ridisegni restano oggi</strong> a te e a tutto il sito.</p>
<h4>Dopo il ridisegno</h4>
<p>L'immagine ridisegnata prende il posto della foto nel cerchio e il configuratore passa da solo a «Grafica con contorni», la modalità giusta per i disegni dell'IA. Puoi ancora spostarla e ingrandirla come prima.</p>
<p class="note">L'IA può sbagliare qualche dettaglio (mani, scritte, oggetti piccoli). Le piccole correzioni le fai poi con <a href="#guida-paint">Colora a mano</a>.</p>`,
  },
  {
    id: 'colors', icon: '🎨', title: '3 · Colori e contorni',
    html: `
<h4>Come vengono scelti i colori</h4>
<p>Il configuratore raggruppa i pixel dell'immagine con colori simili in un certo numero di gruppi (quello che scegli con lo slider «Colori»). Ogni gruppo diventa una <strong>zona</strong> e prende la <strong>bobina reale più vicina</strong> tra quelle disponibili in negozio: i colori che vedi sono quelli veri dei filamenti, non quelli dello schermo. Il bianco più chiaro usa la bobina della base, le linee usano sempre il nero.</p>
<h4 data-feat="feat_mode">Modalità</h4>
<div data-feat="feat_mode"><figure class="w-fig" data-gimg="modalita"><figcaption>Le due modalità: quella evidenziata è attiva.</figcaption></figure></div>
<ul data-feat="feat_mode">
  <li><strong>Grafica con contorni</strong> (consigliata): per disegni che hanno già le linee nere, compresi quelli dell'IA. Le linee vengono tenute e le zone tra le linee colorate.</li>
  <li><strong>Foto o disegno</strong>: per immagini senza contorni: il configuratore crea da solo le linee nere tra un colore e l'altro.</li>
</ul>
<h4>Colori</h4>
<p>Quanti colori usare per il disegno (da 2 a 12). Più colori = più dettagli e sfumature, ma servono più bobine: il disco può avere al massimo <strong>13 colori in tutto</strong>, compresi bianco della base e nero delle linee. Se superi il limite il contatore diventa rosso.</p>
<h4>Aggiungi i contorni neri dove mancano</h4>
<p>Solo in «Grafica con contorni»: mette le linee nere anche tra i colori che non le avevano.</p>
<h4>Spessore contorni</h4>
<p>Quanto sono spesse le linee nere create dal configuratore, in millimetri. Linee sotto 1 mm danno più dettaglio ma i particolari piccolissimi possono perdersi in stampa.</p>
<h4>Ingrossa il nero</h4>
<p>Rende più spesse le linee nere già presenti nell'immagine, così anche quelle sottili si stampano bene. Le linee più sottili di circa mezzo millimetro (meno di una passata dell'ugello) diventano comunque del colore accanto.</p>
<h4 data-feat="feat_advanced">Regolazioni avanzate</h4>
<ul data-feat="feat_advanced">
  <li><strong>Semplificazione</strong>: quanto vengono ammorbiditi i bordi e unite le macchioline. Più alta = disegno più pulito e meno dettagliato.</li>
  <li><strong>Dettaglio minimo</strong>: la larghezza minima (mm) di una parte colorata; le parti più strette spariscono nel colore vicino.</li>
  <li><strong>Area minima zona</strong>: le zone più piccole di questa superficie (mm²) vengono assorbite da quelle vicine.</li>
  <li><strong>Risoluzione</strong>: pixel per millimetro usati nella conversione; più alta = bordi più precisi ma calcolo più lento.</li>
  <li><strong>Prova un'altra combinazione di colori</strong>: ricalcola la scelta dei colori in un altro modo, utile se due colori importanti sono finiti insieme.</li>
</ul>`,
  },
  {
    id: 'palette', icon: '🧵', title: 'Colori del disco (a destra)',
    html: `
<figure class="w-fig" data-gimg="colori-disco"><figcaption>Ogni riga è una bobina: 🔒 = scelta tua, 🗑 = togli il colore.</figcaption></figure>
<p>L'elenco di tutte le <strong>bobine</strong> usate dal disegno, una riga per bobina, con la superficie in mm². Sotto c'è il conteggio «Colori totali X / 13», che comprende anche fascia, scritte, bianco e nero.</p>
<h4 data-feat="feat_replace">Sostituisci un colore</h4>
<p data-feat="feat_replace">Tocca il quadratino colorato e scegli un'altra bobina: il colore cambia <strong>ovunque</strong> (zone del disegno, fascia, scritte, pennellate). Se scegli una bobina già presente, le zone diventano dello stesso colore e nei file si uniscono in un pezzo solo. È una sostituzione, non un'aggiunta: si può fare anche con 13 colori su 13.</p>
<div data-feat="feat_replace"><figure class="w-fig" data-gimg="sostituisci"><figcaption>Toccando un colore si apre l'elenco delle bobine disponibili.</figcaption></figure></div>
<h4 data-feat="feat_remove_color">🗑 Togli un colore</h4>
<p data-feat="feat_remove_color">Il cestino toglie quel colore: le sue zone (e fascia, scritte, pennellate di quel colore) diventano <strong>bianche</strong>. Puoi ricolorarle quando vuoi. Nero contorni e bianco non si possono togliere.</p>
<h4>🔒 Scelta bloccata</h4>
<p>Quando scegli tu una bobina, compare il lucchetto: quella scelta <strong>resta</strong> anche se cambi numero di colori, contorni o zoom. Tocca 🔒 per tornare alla scelta automatica.</p>
<h4>Perché massimo 13 colori?</h4>
<p>È il numero di bobine che la stampante può usare insieme in un'unica stampa. Conviene riusare per fascia e scritte i colori già presenti nel disegno.</p>`,
  },
  {
    id: 'paint', icon: '🖌️', title: 'Colora a mano', show: (c) => c.feature('feat_paint'),
    html: `
<p>Il pulsante <strong>🖌️ Colora a mano</strong> (sopra l'elenco dei colori) apre gli strumenti per ricolorare il disegno direttamente sull'anteprima. Mentre colori, i confini di tutte le zone sono tratteggiati in rosso (solo a schermo).</p>
<h4>🪣 Secchiello</h4>
<figure class="w-fig" data-gimg="colora-a-mano"><figcaption>Gli strumenti di Colora a mano con le bobine tra cui scegliere.</figcaption></figure>
<p>Scegli un colore tra le bobine o tra i colori del disco, poi tocca una zona: <strong>la zona intera</strong> prende quel colore, le linee nere restano. Due zone vicine senza linea nera in mezzo restano comunque separate.</p>
<h4 data-feat="feat_pen">✏️ Penna</h4>
<p data-feat="feat_pen">Disegna a mano libera con la bobina scelta: pupille, riflessi, piccoli ritocchi. Lo slider <strong>Punta</strong> va da 0,5 a 6 mm.</p>
<div data-feat="feat_pen"><figure class="w-fig" data-gimg="penna"><figcaption>La penna con lo slider della punta.</figcaption></figure></div>
<p data-feat="feat_pen"> Per i dettagli ingrandisci con lo zoom; per spostarti mentre usi la penna: due dita oppure Maiusc + trascina.</p>
<h4>Gli altri pulsanti</h4>
<ul>
  <li data-feat="feat_clear"><strong>Svuota i colori</strong>: rende tutto bianco tranne il nero, per ricolorare da zero.</li>
  <li><strong>↶ Annulla</strong>: toglie l'ultimo tocco o tratto.</li>
  <li><strong>Fine</strong>: chiude gli strumenti.</li>
</ul>
<p>Le colorazioni a mano restano anche se poi cambi colori, contorni o zoom: vengono riapplicate da sole. Nei file di stampa sono forme vere del nuovo colore.</p>`,
  },
  {
    id: 'frame', icon: '⭕', title: '4 · Cornice e scritte',
    html: `
<h4 data-show="overflow">Fai uscire parti del disegno sopra la fascia</h4>
<div data-show="overflow">
<p>Come nei tombini veri, alcune parti del disegno (un orecchio, una coda, una pinna) possono uscire dal cerchio e coprire la fascia. Accendi l'interruttore e <strong>tocca sull'anteprima</strong> le parti che devono uscire; tocca di nuovo per toglierle, oppure «Togli tutte».</p>
<figure class="w-fig" data-gimg="sopra-fascia"><figcaption>Le orecchie di Gengar escono dal cerchio e coprono la fascia; l'anello nero esterno resta sopra.</figcaption></figure>
<ul>
  <li>Le parti escono con il loro contorno nero fino all'anello nero esterno, che resta sempre sopra.</li>
  <li>Serve un po' di zoom sull'immagine perché qualcosa sporga dal cerchio.</li>
  <li>Lo sfondo non esce (riempirebbe tutta la fascia); se una parte copre una scritta compare un avviso.</li>
</ul>
</div>
<h4 data-feat="feat_stickers" data-show="stickers">Grafiche aggiuntive</h4>
<div data-feat="feat_stickers" data-show="stickers">
<div class="w-gallery" data-gallery="stickers"></div>
<p>Tocca una grafica (es. una Poké Ball) per aggiungerla sopra il disegno. Poi:</p>
<ul>
  <li><strong>Trascinala</strong> sull'anteprima per spostarla.</li>
  <li>Maniglia <strong>gialla</strong>: ingrandisce; maniglia <strong>bianca</strong>: ruota (oppure gli slider Dim. e Rot. nell'elenco).</li>
  <li>▲ ▼ cambiano l'ordine (sopra/sotto), ✕ la elimina.</li>
</ul>
<figure class="w-fig" data-gimg="grafiche"><figcaption>Una grafica aggiunta: maniglie sul disegno oppure gli slider Dim. e Rot.</figcaption></figure>
<p>Può andare anche sopra la fascia, mai sopra l'anello nero esterno. I colori del disegno non cambiano: della grafica si aggiungono solo i colori che mancano.</p>
</div>
<h4 data-feat="feat_band_color">Colore fascia</h4>
<p data-feat="feat_band_color">Il colore dell'anello dove stanno le scritte. Un colore già presente nel disegno non aggiunge bobine.</p>
<h4 data-feat="feat_text_color">Colore scritte</h4>
<p data-feat="feat_text_color">Il colore delle lettere sulla fascia.</p>
<h4 data-feat="feat_lamp_colors" data-show="lamp">Colori della lampada</h4>
<p data-feat="feat_lamp_colors" data-show="lamp">Se presenti, scegli il colore degli altri pezzi della lampada (base, struttura…): li vedi nell'anteprima 3D.</p>
<h4 data-feat="feat_texts">Scritte sulla fascia</h4>
<div data-feat="feat_texts">
<figure class="w-fig" data-gimg="scritte"><figcaption>Ogni scritta ha il suo slider per farla scorrere lungo la fascia.</figcaption></figure>
<p>Fino a <strong>4 scritte</strong>: Sopra 1 e Sopra 2 nella metà alta, Sotto 1 e Sotto 2 nella metà bassa. Lascia vuoto per non metterle.</p>
<ul>
  <li data-feat="feat_text_pos">Lo <strong>slider</strong> sotto ogni scritta la fa scorrere lungo la fascia; quelle di sotto si fermano ai lati dell'asola.</li>
  <li data-feat="feat_text_size"><strong>Dimensione scritte</strong>: l'altezza di tutte le lettere, in millimetri.</li>
  <li>Un testo troppo lungo per il suo spazio si rimpicciolisce da solo; se due scritte si accavallano compare un avviso.</li>
</ul>
</div>`,
  },
  {
    id: 'confirm', icon: '✅', title: '5 · Conferma',
    html: `
<p>Il <strong>riepilogo</strong> mostra immagine, stile, sfondo, colori, fascia e scritte.</p>
<div data-feat="feat_submit">
<h4>Convalida il mio disco</h4>
<p>Inserisci nome, email (telefono e note facoltativi), accetta l'uso dell'immagine per realizzare il prodotto e invia. Il disco <strong>non va subito in stampa</strong>: lo controlliamo noi, sistemiamo eventuali dettagli e ti ricontattiamo con il preventivo.</p>
</div>
<h4>Scarica l'anteprima</h4>
<p>Un'immagine della tua lampada da condividere, con il logo del negozio.</p>`,
  },
  {
    id: 'preview', icon: '👁️', title: "L'anteprima",
    html: `
<figure class="w-fig" data-gimg="barra"><figcaption>La barra in alto: luce, guida, salva/apri.</figcaption></figure>
<ul>
  <li data-feat="feat_3d"><strong>Anteprima 2D</strong>: il disco piatto, dove tocchi, colori e sposti le grafiche. <strong>Anteprima 3D</strong>: la lampada intera; trascina con il mouse per girarla, rotellina per avvicinarti.</li>
  <li data-feat="feat_lit"><strong>Spenta / 💡 Accesa</strong> (in alto): come appare la lampada con la luce spenta o accesa.</li>
  <li data-feat="feat_zoom"><strong>Zoom 2D</strong>: rotellina del mouse (ingrandisce dove punti), pizzico con due dita, oppure i pulsanti − + e ⤢ (tutto il disco) nell'angolo. Da ingrandito trascini per spostarti.</li>
  <li>Sotto l'anteprima un messaggio dice cosa sta succedendo («Elaborazione…», «Ecco il tuo disco»).</li>
</ul>`,
  },
  {
    id: 'project', icon: '💾', title: 'Salvare e riprendere', show: (c) => c.feature('feat_project'),
    html: `
<p><strong>💾 Salva</strong> (in alto) scarica sul tuo computer un file <code>.francy</code> con <strong>tutto il lavoro</strong>: immagine, ridisegno IA, inquadratura, colori e scelte bloccate, colorazioni a mano, parti sopra la fascia, grafiche, scritte e colori della lampada.</p>
<p><strong>📂 Apri</strong> ricarica il file e riparti esattamente da dove eri rimasto, anche giorni dopo o su un altro computer. Il file resta a te: non viene salvato sul nostro sito.</p>`,
  },
  {
    id: 'tips', icon: '💡', title: 'Consigli per un buon risultato',
    html: `
<ul>
  <li><strong>Parti da un disegno</strong> a colori pieni e contorni neri; con le foto usa il ridisegno IA.</li>
  <li><strong>Inquadra stretto</strong> il soggetto: i dettagli piccoli su un disco di 20 cm diventano minuscoli.</li>
  <li><strong>8–10 colori</strong> bastano quasi sempre; riusa gli stessi per fascia e scritte.</li>
  <li>Se due zone importanti hanno preso lo stesso colore, prova «Prova un'altra combinazione di colori» o sostituisci il colore a mano.</li>
  <li>Guarda l'anteprima <strong>accesa</strong>: i colori chiari fanno passare più luce.</li>
  <li>Salva il progetto 💾 prima di provare modifiche grosse.</li>
</ul>`,
  },
  {
    id: 'problems', icon: '🧰', title: 'Problemi comuni e soluzioni',
    html: `
<h4>Due parti diverse hanno lo stesso colore</h4>
<p>Aumenta «Colori», oppure prova «Prova un'altra combinazione di colori» nelle regolazioni avanzate. Se è una sola zona, tocca il colore nell'elenco a destra e sostituiscilo, o ricolorala con il 🪣 secchiello.</p>
<h4>Colori totali oltre 13 (contatore rosso)</h4>
<p>Abbassa «Colori», usa per fascia e scritte un colore già presente nel disegno, oppure togli con 🗑 un colore poco importante (diventa bianco).</p>
<h4>Mancano dei contorni o le linee sono rotte</h4>
<p>In «Grafica con contorni» accendi «Aggiungi i contorni neri dove mancano» e alza un po' «Ingrossa il nero». Con una foto passa a «Foto o disegno», che i contorni li crea da sé.</p>
<h4>Le linee nere sono troppo grosse e coprono i dettagli</h4>
<p>Abbassa «Spessore contorni» e «Ingrossa il nero», e ingrandisci il soggetto con lo zoom così occupa più spazio sul disco.</p>
<h4>Il disegno ha troppe macchioline</h4>
<p>Alza «Semplificazione» e «Area minima zona» nelle regolazioni avanzate, oppure riduci i colori.</p>
<h4>Spariscono dettagli piccoli (occhi, riflessi)</h4>
<p>Ingrandisci il soggetto, abbassa «Dettaglio minimo», accendi «È un volto» per le persone. I dettagli rimasti fuori si possono ridisegnare con la ✏️ penna.</p>
<h4>Le scritte si sovrappongono</h4>
<p>Spostale con il loro slider, accorcia il testo o abbassa «Dimensione scritte».</p>
<h4>Il ridisegno IA non parte</h4>
<p>Controlla sotto il pulsante quanti ridisegni restano oggi: quando finiscono si può riprovare il giorno dopo. Intanto puoi caricare un disegno già pronto.</p>
<h4>L'anteprima è lenta</h4>
<p>Ogni modifica ricalcola il disegno: con immagini molto dettagliate ci vuole qualche secondo. Aspetta il messaggio «Ecco il tuo disco» prima di cambiare altro; su PC è più veloce che su telefono.</p>`,
  },
  {
    id: 'glossary', icon: '📖', title: 'Glossario',
    html: `
<dl>
  <dt>Bobina</dt><dd>Il rotolo di filamento di un colore. Ogni colore del disco è una bobina.</dd>
  <dt>Zona</dt><dd>Una parte del disegno di un solo colore, separata dalle altre da linee nere o da un cambio di colore.</dd>
  <dt>Contorni / linee nere</dt><dd>Le linee che separano le zone, come in un fumetto.</dd>
  <dt>Fascia</dt><dd>L'anello intorno al disegno dove stanno le scritte.</dd>
  <dt>Anello nero esterno</dt><dd>Il bordo del disco, sempre nero e sempre sopra a tutto.</dd>
  <dt>Asola</dt><dd>L'incavo a U in basso che serve a montare il disco.</dd>
  <dt>Template pronto</dt><dd>Un disegno già preparato da noi, da scegliere nella galleria.</dd>
  <dt>Ridisegno IA</dt><dd>La trasformazione di una foto in disegno fatta dall'intelligenza artificiale.</dd>
  <dt>Sopra la fascia</dt><dd>Parti del disegno che escono dal cerchio e coprono la fascia, come nei tombini giapponesi.</dd>
  <dt>🔒 Scelta bloccata</dt><dd>Un colore scelto da te che resta anche se il disegno viene ricalcolato.</dd>
  <dt>File .francy</dt><dd>Il file con tutto il tuo progetto, da salvare e riaprire.</dd>
</dl>`,
  },
  {
    id: 'faq', icon: '❔', title: 'Domande frequenti',
    html: `
<h4>Perché alcuni dettagli spariscono?</h4>
<p>Le parti più strette di circa mezzo millimetro non si possono stampare: diventano del colore vicino. Ingrandisci il soggetto con lo zoom o abbassa «Dettaglio minimo» nelle regolazioni avanzate.</p>
<h4>Posso modificare dopo l'invio?</h4>
<p>Sì: ti ricontattiamo prima della stampa e possiamo sistemare insieme i dettagli.</p>
<h4>La mia immagine viene usata per altro?</h4>
<p>No: serve solo a realizzare il tuo prodotto.</p>
<h4>I colori dell'anteprima sono quelli veri?</h4>
<p>Sono i colori dei filamenti reali che usiamo. Lo schermo può renderli un po' diversi (luminosità, tipo di monitor), ma la scelta delle bobine è esatta.</p>
<h4>Posso salvare e finire un altro giorno?</h4>
<p>Sì, con <a href="#guida-project">💾 Salva</a>: scarichi il progetto e lo riapri quando vuoi con 📂 Apri.</p>
<h4>Un template pronto si può cambiare?</h4>
<p>Il disegno no, ma scritte e colori della lampada sì. Per un disegno tutto tuo carica un'immagine.</p>`,
  },
  {
    id: 'admin', icon: '🛠️', title: 'Strumenti amministratore', show: (c) => c.admin,
    html: `
<p>Questa sezione la vedi solo tu da amministratore.</p>
<ul>
  <li><strong>⚙️ Elabora questo disegno</strong> (con un template aperto): il template diventa la sorgente di tutto il disco e puoi modificarlo con colori, pennello e penna. «✕ Esci dall'elaborazione» torna al normale.</li>
  <li><strong>💾 Salva nel disegno pronto</strong>: manda al sito PNG, SVG, EPS, 3MF e progetto; i clienti vedono la nuova versione e i file di stampa sono in Disegni pronti.</li>
  <li><strong>File (solo admin)</strong> a destra: pacchetto completo .zip (anteprime, SVG/EPS, un STL per colore, 3MF Bambu, lista filamenti), solo SVG, anteprima PNG senza watermark.</li>
  <li>Nei colori del disco vedi anche il nome vero della bobina accanto al nome pubblico.</li>
</ul>`,
  },
];
