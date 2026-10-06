<?php
// Catalogo filamenti: le bobine che hai davvero. Il configuratore riduce i colori del disegno a queste
// e lo zip di ogni progetto dice quali bobine montare.
// Formato: una riga per bobina, "Nome | #rrggbb" (es. "Bambu PLA Basic Rosso | #C12E1F").

if (!defined('ABSPATH')) {
	exit;
}

const FLC_FIL_OPTION = 'flc_filaments';

// Lista [{ name, hex }] già pulita
function flc_filaments() {
	$list = get_option(FLC_FIL_OPTION, array());
	return is_array($list) ? array_values($list) : array();
}

// Testo della textarea -> lista. Righe non valide scartate (e segnalate).
function flc_parse_filaments($text, &$errors = null) {
	$errors = array();
	$out    = array();
	$seen   = array();
	foreach (preg_split('/\r\n|\r|\n/', (string) $text) as $n => $line) {
		$line = trim($line);
		if ($line === '' || $line[0] === '#' && !preg_match('/\|/', $line)) {
			continue;
		}
		if (!preg_match('/^(.+?)\s*[|;,\t]\s*#?([0-9a-fA-F]{6})\s*$/', $line, $m)) {
			$errors[] = sprintf('Riga %d non valida: "%s" (usa: Nome | #rrggbb)', $n + 1, $line);
			continue;
		}
		$hex = '#' . strtolower($m[2]);
		if (isset($seen[$hex])) {
			$errors[] = sprintf('Riga %d: il colore %s è già presente ("%s")', $n + 1, $hex, $seen[$hex]);
			continue;
		}
		$name        = sanitize_text_field($m[1]);
		$seen[$hex]  = $name;
		$out[]       = array('name' => $name, 'hex' => $hex);
	}
	return $out;
}

add_action('admin_init', function () {
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
	$list = flc_filaments();
	$text = implode("\n", array_map(function ($f) { return $f['name'] . ' | ' . strtoupper($f['hex']); }, $list));
	?>
	<div class="wrap">
		<h1>Catalogo filamenti</h1>
		<p>Le bobine che hai in laboratorio. Quando c'è almeno un filamento, il configuratore usa <strong>solo questi colori</strong>
			(sceglie il più vicino a ogni colore del disegno) e lo zip di ogni progetto dice quali bobine montare.</p>
		<?php settings_errors(FLC_FIL_OPTION); ?>
		<form method="post" action="options.php">
			<?php settings_fields('flc_fil'); ?>
			<p><strong>Una riga per bobina</strong>, nel formato <code>Nome | #rrggbb</code>. Esempio:</p>
			<pre style="background:#fff;border:1px solid #c3c4c7;padding:8px 12px;display:inline-block">Bambu PLA Basic Nero | #000000
Bambu PLA Basic Bianco | #FFFFFF
Bambu PLA Basic Rosso | #C12E1F
Sunlu PLA Azzurro Cielo | #5B9BD5</pre>
			<p><textarea name="<?php echo esc_attr(FLC_FIL_OPTION); ?>" rows="16" class="large-text code" placeholder="Nome | #rrggbb"><?php echo esc_textarea($text); ?></textarea></p>
			<p class="description">Consiglio: per il codice colore usa il valore indicato dal produttore, o misuralo da una foto
				della bobina alla luce del giorno. Includi sempre un nero e un bianco: servono per contorni e base.</p>
			<?php submit_button('Salva catalogo'); ?>
		</form>

		<?php if ($list) : ?>
			<h2><?php echo count($list); ?> filamenti</h2>
			<div style="display:flex;flex-wrap:wrap;gap:10px;max-width:960px">
				<?php foreach ($list as $f) : ?>
					<div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:6px 10px">
						<span style="width:26px;height:26px;border-radius:50%;background:<?php echo esc_attr($f['hex']); ?>;border:1px solid #c3c4c7"></span>
						<span><?php echo esc_html($f['name']); ?><br><code><?php echo esc_html(strtoupper($f['hex'])); ?></code></span>
					</div>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</div>
	<?php
}
