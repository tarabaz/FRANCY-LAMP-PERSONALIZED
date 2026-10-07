<?php
// Catalogo filamenti: le bobine che hai davvero. Il configuratore riduce i colori del disegno a queste
// e lo zip di ogni progetto dice quali bobine montare.
// Formato: una riga per bobina, "Nome | #rrggbb" (es. "Bambu PLA Basic Rosso | #C12E1F"),
// con facoltativo il TD (Transmission Distance, quanta luce passa): "Nome | #rrggbb | 1.6".

if (!defined('ABSPATH')) {
	exit;
}

const FLC_FIL_OPTION = 'flc_filaments';
// Bobine speciali (silk, metal…) solo per i pezzi della lampada: NON entrano nel calcolo dei colori del disco
const FLC_FIL_SPECIAL_OPTION = 'flc_filaments_special';

function flc_filaments_special() {
	$list = get_option(FLC_FIL_SPECIAL_OPTION, array());
	return is_array($list) ? array_values($list) : array();
}

// Lista [{ name, hex }] già pulita.
// Finché il catalogo non è mai stato salvato si usano le bobine di FrancyStore3D (includes/filamenti-predefiniti.txt).
function flc_filaments() {
	$list = get_option(FLC_FIL_OPTION, null);
	if ($list === null || $list === false) {
		$file = __DIR__ . '/filamenti-predefiniti.txt';
		$list = is_file($file) ? flc_parse_filaments(file_get_contents($file)) : array();
	}
	return is_array($list) ? array_values($list) : array();
}

// Testo della textarea -> lista. Righe non valide scartate (e segnalate).
// Formati accettati (nome pubblico e TD facoltativi):
//   Nome vero | #rrggbb
//   Nome vero | #rrggbb | TD
//   Nome vero | Nome pubblico | #rrggbb
//   Nome vero | Nome pubblico | #rrggbb | TD
function flc_parse_filaments($text, &$errors = null) {
	$errors = array();
	$out    = array();
	$seen   = array();
	foreach (preg_split('/\r\n|\r|\n/', (string) $text) as $n => $line) {
		$line = trim($line);
		if ($line === '' || $line[0] === '#' && !preg_match('/\|/', $line)) {
			continue;
		}
		$cells = preg_split('/\s*[|;\t]\s*/', $line);
		if (count($cells) === 1) {
			$cells = preg_split('/\s*,\s*/', $line); // vecchio formato "Nome, #hex"
		}
		$hi = -1;
		foreach ($cells as $i => $c) {
			if ($i > 0 && preg_match('/^#?[0-9a-fA-F]{6}$/', $c)) { $hi = $i; break; }
		}
		$td = $hi >= 0 && isset($cells[$hi + 1]) ? preg_replace('/^TD\s*/i', '', $cells[$hi + 1]) : '';
		if ($hi < 1 || $hi > 2 || ($td !== '' && !preg_match('/^[0-9]+(?:[.,][0-9]+)?$/', $td)) || count($cells) > $hi + 2) {
			$errors[] = sprintf('Riga %d non valida: "%s" (usa: Nome | Nome pubblico | #rrggbb | TD – nome pubblico e TD facoltativi)', $n + 1, $line);
			continue;
		}
		$hex = '#' . strtolower(ltrim($cells[$hi], '#'));
		if (isset($seen[$hex])) {
			$errors[] = sprintf('Riga %d: il colore %s è già presente ("%s")', $n + 1, $hex, $seen[$hex]);
			continue;
		}
		$name       = sanitize_text_field($cells[0]);
		$seen[$hex] = $name;
		$item       = array('name' => $name, 'hex' => $hex);
		if ($hi === 2 && trim($cells[1]) !== '') {
			$item['label'] = mb_substr(sanitize_text_field($cells[1]), 0, 40);
		}
		if ($td !== '') {
			$item['td'] = round((float) str_replace(',', '.', $td), 2);
		}
		$out[] = $item;
	}
	return $out;
}

// Riga del catalogo nel formato della textarea
function flc_filament_line($f) {
	return $f['name'] . (!empty($f['label']) ? ' | ' . $f['label'] : '') . ' | ' . strtoupper($f['hex']) . (isset($f['td']) ? ' | ' . $f['td'] : '');
}

// Per il configuratore: i clienti NON ricevono il nome vero (marca) ma solo il nome pubblico e un codice neutro;
// alla convalida il server rimette i nomi veri nei file (vedi flc_resolve_filament_tokens).
function flc_filaments_public($list, $prefix) {
	$admin = current_user_can('manage_options');
	$out   = array();
	foreach (array_values($list) as $i => $f) {
		$x = array('hex' => $f['hex'], 'label' => $f['label'] ?? '', 'tok' => 'FLC' . $prefix . $i . 'Q');
		if (isset($f['td'])) {
			$x['td'] = $f['td'];
		}
		if ($admin) {
			$x['name'] = $f['name'];
		}
		$out[] = $x;
	}
	return $out;
}

// codice neutro -> nome vero (per la convalida)
function flc_filament_token_map() {
	$map = array();
	foreach (array('D' => flc_filaments(), 'S' => flc_filaments_special()) as $p => $list) {
		foreach (array_values($list) as $i => $f) {
			$map['FLC' . $p . $i . 'Q'] = $f['name'];
		}
	}
	return $map;
}

add_action('admin_init', function () {
	register_setting('flc_fil', FLC_FIL_SPECIAL_OPTION, array(
		'sanitize_callback' => function ($in) {
			if (is_array($in)) {
				return $in;
			}
			$list = flc_parse_filaments($in, $errors);
			foreach ($errors as $e) {
				add_settings_error(FLC_FIL_SPECIAL_OPTION, 'flc_fils_' . md5($e), 'Bobine speciali – ' . $e, 'warning');
			}
			return $list;
		},
	));
	register_setting('flc_fil', FLC_FIL_OPTION, array(
		'sanitize_callback' => function ($in) {
			if (is_array($in)) {
				return $in; // già nel formato giusto (es. salvataggi programmatici)
			}
			$list = flc_parse_filaments($in, $errors);
			foreach ($errors as $e) {
				add_settings_error(FLC_FIL_OPTION, 'flc_fil_' . md5($e), $e, 'warning');
			}
			return $list;
		},
	));
});

add_action('admin_menu', function () {
	add_submenu_page('edit.php?post_type=flc_design', 'Catalogo filamenti', 'Filamenti', 'manage_options', 'flc-filamenti', 'flc_filaments_page');
}, 15);

function flc_filaments_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$list    = flc_filaments();
	$special = flc_filaments_special();
	$stext   = implode("\n", array_map('flc_filament_line', $special));
	$text = implode("\n", array_map('flc_filament_line', $list));
	?>
	<div class="wrap">
		<h1>Catalogo filamenti</h1>
		<p>Le bobine che hai in laboratorio. Quando c'è almeno un filamento, il configuratore usa <strong>solo questi colori</strong>
			(sceglie il più vicino a ogni colore del disegno) e lo zip di ogni progetto dice quali bobine montare.</p>
		<?php settings_errors(FLC_FIL_OPTION); settings_errors(FLC_FIL_SPECIAL_OPTION); ?>
		<form method="post" action="options.php">
			<?php settings_fields('flc_fil'); ?>
			<p><strong>Una riga per bobina</strong>: <code>Nome vero | Nome pubblico | #rrggbb | TD</code> (nome pubblico e TD facoltativi). Esempio:</p>
			<pre style="background:#fff;border:1px solid #c3c4c7;padding:8px 12px;display:inline-block">Bambu Mandarin Orange | Arancio Mandarino | #F99663 | 2.5
Poly Matte Pastel Peach | Pesca | #F6BF8B | 3.3
Bambu PLA Basic Rosso | #C12E1F</pre>
			<p class="description"><strong>Nome pubblico</strong>: quello che vede il cliente (es. "Arancio Mandarino"). Il nome vero, con la marca, non viene mai inviato al browser
				dei clienti: resta solo nei tuoi file (zip, STL, progetto Bambu, LEGGIMI) e nella scheda del progetto.</p>
			<p><textarea name="<?php echo esc_attr(FLC_FIL_OPTION); ?>" rows="16" class="large-text code" placeholder="Nome vero | Nome pubblico | #rrggbb | TD"><?php echo esc_textarea($text); ?></textarea></p>
			<p class="description">Consiglio: per il codice colore usa il valore indicato dal produttore, o misuralo da una foto
				della bobina alla luce del giorno. Includi sempre un nero e un bianco: servono per contorni e base.<br>
				<strong>TD</strong> (Transmission Distance, come in HueForge): quanta luce attraversa il filamento. Basso (0,5–2) = coprente, da acceso diventa
				più scuro; alto (4–10) = traslucido. Lo trovi su filamentcolors.xyz, nel wiki Polymaker o lo misuri con un TD1S.</p>
			<h2 style="margin-top:28px">Bobine speciali per i pezzi della lampada</h2>
			<p>Silk, metal, sparkle… <strong>Non vengono mai usate per i colori del disco</strong> (disegno, fascia, scritte): compaiono solo in
				<a href="<?php echo esc_url(admin_url('edit.php?post_type=flc_design&page=francy-lamp#lampada')); ?>">Impostazioni → Lampada 3D</a>,
				per il colore dei pezzi (es. i cilindri) e per le scelte del cliente. Stesso formato: <code>Nome vero | Nome pubblico | #rrggbb</code>.</p>
			<p><textarea name="<?php echo esc_attr(FLC_FIL_SPECIAL_OPTION); ?>" rows="6" class="large-text code" placeholder="Bambu PLA Metal Cobalt Blue Metallic | #5F8192"><?php echo esc_textarea($stext); ?></textarea></p>
			<?php submit_button('Salva catalogo'); ?>
		</form>

		<?php if ($special) : ?>
			<h2><?php echo count($special); ?> bobine speciali (solo pezzi della lampada)</h2>
			<div style="display:flex;flex-wrap:wrap;gap:10px;max-width:960px;margin-bottom:10px">
				<?php foreach ($special as $f) : ?>
					<div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px dashed #8c8f94;border-radius:8px;padding:6px 10px">
						<span style="width:26px;height:26px;border-radius:50%;background:<?php echo esc_attr($f['hex']); ?>;border:1px solid #c3c4c7"></span>
						<span><?php echo esc_html($f['name']); ?><br><code><?php echo esc_html(strtoupper($f['hex'])); ?></code></span>
					</div>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
		<?php if ($list) : ?>
			<h2><?php echo count($list); ?> filamenti</h2>
			<div style="display:flex;flex-wrap:wrap;gap:10px;max-width:960px">
				<?php foreach ($list as $f) : ?>
					<div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:6px 10px">
						<span style="width:26px;height:26px;border-radius:50%;background:<?php echo esc_attr($f['hex']); ?>;border:1px solid #c3c4c7"></span>
						<span><?php echo esc_html($f['name']); ?><?php if (!empty($f['label'])) : ?> <span class="description">→ «<?php echo esc_html($f['label']); ?>»</span><?php endif; ?><br><code><?php echo esc_html(strtoupper($f['hex'])); ?></code>
							<?php if (isset($f['td'])) : ?><span class="description" title="Transmission Distance">TD <?php echo esc_html($f['td']); ?><?php echo $f['td'] < 1 ? ' · da acceso molto più scuro' : ''; ?></span><?php endif; ?></span>
					</div>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</div>
	<?php
}
