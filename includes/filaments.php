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
// Bobine fisse: bianco della base (ugello 1) e nero delle linee, scelte a mano (colore HEX)
const FLC_FIL_FIXED_OPTION = 'flc_filaments_fixed';

function flc_filaments_fixed() {
	$f = get_option(FLC_FIL_FIXED_OPTION, array());
	return array('white' => (string) ($f['white'] ?? ''), 'black' => (string) ($f['black'] ?? ''));
}

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

// import da testo: le bobine già presenti (stesso colore) restano "non disponibili" se lo erano
function flc_keep_off($new, $old) {
	$off = array();
	foreach ($old as $f) {
		if (!empty($f['off'])) {
			$off[$f['hex']] = 1;
		}
	}
	foreach ($new as &$f) {
		if (isset($off[$f['hex']])) {
			$f['off'] = 1;
		}
	}
	unset($f);
	return $new;
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
		if (!empty($f['off'])) {
			continue; // non disponibile: il configuratore non la usa
		}
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
			$list = flc_keep_off(flc_parse_filaments($in, $errors), flc_filaments_special());
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
			$list = flc_keep_off(flc_parse_filaments($in, $errors), flc_filaments());
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

// Salvataggio della tabella (modifiche fatte direttamente nelle celle)
add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/filamenti/salva', array(
		'methods'             => 'POST',
		'permission_callback' => function () { return current_user_can('manage_options'); },
		'callback'            => function (WP_REST_Request $req) {
			$out    = array('D' => array(), 'S' => array());
			$seen   = array('D' => array(), 'S' => array());
			$errors = array();
			foreach ((array) $req->get_param('rows') as $n => $r) {
				if (!is_array($r)) {
					continue;
				}
				$type = ($r['type'] ?? '') === 'S' ? 'S' : 'D';
				$name = mb_substr(sanitize_text_field((string) ($r['name'] ?? '')), 0, 80);
				$hex  = strtolower((string) ($r['hex'] ?? ''));
				$hex  = $hex !== '' && $hex[0] !== '#' ? '#' . $hex : $hex;
				if ($name === '' || !preg_match('/^#[0-9a-f]{6}$/', $hex)) {
					$errors[] = sprintf('Riga %d scartata: serve un nome e un colore valido.', $n + 1);
					continue;
				}
				if (isset($seen[$type][$hex])) {
					$errors[] = sprintf('Riga %d scartata: il colore %s c\'è già ("%s").', $n + 1, strtoupper($hex), $seen[$type][$hex]);
					continue;
				}
				$seen[$type][$hex] = $name;
				$item = array('name' => $name, 'hex' => $hex);
				$label = mb_substr(sanitize_text_field((string) ($r['label'] ?? '')), 0, 40);
				if ($label !== '') {
					$item['label'] = $label;
				}
				$td = str_replace(',', '.', (string) ($r['td'] ?? ''));
				if ($td !== '' && is_numeric($td)) {
					$item['td'] = round((float) $td, 2);
				}
				if (empty($r['on'])) {
					$item['off'] = 1;
				}
				$out[$type][] = $item;
			}
			update_option(FLC_FIL_OPTION, $out['D']);
			update_option(FLC_FIL_SPECIAL_OPTION, $out['S'], false);
			$fixed = (array) $req->get_param('fixed');
			$hexes = array_column($out['D'], 'hex');
			update_option(FLC_FIL_FIXED_OPTION, array(
				'white' => in_array(strtolower((string) ($fixed['white'] ?? '')), $hexes, true) ? strtolower($fixed['white']) : '',
				'black' => in_array(strtolower((string) ($fixed['black'] ?? '')), $hexes, true) ? strtolower($fixed['black']) : '',
			), false);
			return array('ok' => true, 'disco' => count($out['D']), 'speciali' => count($out['S']), 'errors' => $errors);
		},
	));
});

function flc_filaments_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$list    = flc_filaments();
	$special = flc_filaments_special();
	$rows    = array();
	foreach (array('D' => $list, 'S' => $special) as $type => $l) {
		foreach ($l as $f) {
			$rows[] = array('type' => $type, 'name' => $f['name'], 'label' => $f['label'] ?? '', 'hex' => $f['hex'], 'td' => $f['td'] ?? '', 'on' => empty($f['off']));
		}
	}
	$text  = implode("\n", array_map('flc_filament_line', $list));
	$stext = implode("\n", array_map('flc_filament_line', $special));
	?>
	<style>
		.flc-fil { max-width: 1200px; }
		.flc-fil .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0 10px; }
		.flc-fil .bar .grow { flex: 1; }
		.flc-fil table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #c3c4c7; }
		.flc-fil th { text-align: left; padding: 8px 6px; background: #f6f7f7; border-bottom: 1px solid #c3c4c7; cursor: pointer; user-select: none; white-space: nowrap; }
		.flc-fil th.nosort { cursor: default; }
		.flc-fil td { padding: 4px 6px; border-bottom: 1px solid #f0f0f1; vertical-align: middle; }
		.flc-fil td input[type=text], .flc-fil td input[type=number], .flc-fil td select { width: 100%; box-sizing: border-box; border-color: transparent; background: transparent; }
		.flc-fil td input:hover, .flc-fil td select:hover { border-color: #dcdcde; }
		.flc-fil td input:focus, .flc-fil td select:focus { border-color: #2271b1; background: #fff; }
		.flc-fil td input[type=color] { width: 34px; height: 30px; padding: 0; border: 1px solid #c3c4c7; border-radius: 6px; background: none; cursor: pointer; }
		.flc-fil td .hex { font-family: monospace; width: 82px !important; text-transform: uppercase; }
		.flc-fil tr.dirty td { background: #fff8e5; }
		.flc-fil tr.off td { opacity: .5; }
		.flc-fil tr.bad td { background: #fcf0f1; }
		.flc-fil .tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 9px; background: #f0f0f1; }
		.flc-fil .save { position: sticky; bottom: 0; background: #f0f0f1; padding: 10px 0; border-top: 1px solid #dcdcde; display: flex; gap: 10px; align-items: center; z-index: 5; }
		.flc-fil .td-low { color: #b32d2e; font-size: 11px; display: block; }
	</style>
	<div class="wrap flc-fil">
		<h1>Catalogo filamenti</h1>
		<p>Le bobine che hai in laboratorio. <strong>Disco</strong>: il configuratore usa solo queste per i colori del disegno, della fascia e delle scritte.
			<strong>Speciali</strong> (silk, metal…): solo per i pezzi della lampada in <a href="<?php echo esc_url(admin_url('edit.php?post_type=flc_design&page=francy-lamp#lampada')); ?>">Impostazioni → Lampada 3D</a>.
			Il <strong>nome pubblico</strong> è quello che vede il cliente; il nome vero (con la marca) resta solo nei tuoi file.
			Le bobine <strong>non disponibili</strong> restano in elenco ma il configuratore non le usa.</p>
		<?php settings_errors(FLC_FIL_OPTION); settings_errors(FLC_FIL_SPECIAL_OPTION); ?>

		<div class="bar" style="background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:10px 12px">
			<strong>Bobine fisse</strong>
			<label>Bianco della base (ugello 1) <select id="flcFixWhite"></select></label>
			<label>Nero delle linee <select id="flcFixBlack"></select></label>
			<span class="description">Vuoto = la bobina del disco più vicina al bianco / al nero.</span>
		</div>
		<div class="bar">
			<input type="search" id="flcFilSearch" placeholder="Cerca per nome o colore…" style="min-width:240px">
			<select id="flcFilFilter">
				<option value="">Tutte</option><option value="D">Disco</option><option value="S">Speciali</option><option value="off">Non disponibili</option>
			</select>
			<span class="grow"></span>
			<span id="flcFilCount" class="description"></span>
			<button type="button" class="button" id="flcFilAdd">+ Aggiungi bobina</button>
		</div>
		<table>
			<thead><tr>
				<th class="nosort" style="width:40px"></th>
				<th data-k="hex" style="width:96px">HEX</th>
				<th data-k="name">Nome vero</th>
				<th data-k="label">Nome pubblico</th>
				<th data-k="td" style="width:80px" title="Transmission Distance: basso = coprente (da acceso più scuro), alto = traslucido">TD</th>
				<th data-k="type" style="width:110px">Tipo</th>
				<th data-k="on" style="width:90px">Disponibile</th>
				<th class="nosort" style="width:40px"></th>
			</tr></thead>
			<tbody id="flcFilRows"></tbody>
		</table>
		<div class="save">
			<button type="button" class="button button-primary" id="flcFilSave">Salva modifiche</button>
			<span id="flcFilMsg" class="description"></span>
		</div>

		<details style="margin-top:22px">
			<summary style="cursor:pointer;font-weight:600">Importa / esporta come testo</summary>
			<p class="description">Per caricare o copiare tante bobine in una volta. Formato: <code>Nome vero | Nome pubblico | #rrggbb | TD</code> (nome pubblico e TD facoltativi).
				Salvando da qui l'elenco di quel tipo viene <strong>sostituito</strong>; le bobine già presenti mantengono lo stato "disponibile".</p>
			<form method="post" action="options.php">
				<?php settings_fields('flc_fil'); ?>
				<p><strong>Disco</strong><br><textarea name="<?php echo esc_attr(FLC_FIL_OPTION); ?>" rows="10" class="large-text code"><?php echo esc_textarea($text); ?></textarea></p>
				<p><strong>Speciali</strong><br><textarea name="<?php echo esc_attr(FLC_FIL_SPECIAL_OPTION); ?>" rows="5" class="large-text code"><?php echo esc_textarea($stext); ?></textarea></p>
				<?php submit_button('Importa dal testo', 'secondary'); ?>
			</form>
		</details>
	</div>
	<script>
	(function () {
		const api = <?php echo wp_json_encode(rest_url('francy-lamp/v1/filamenti/salva')); ?>, nonce = <?php echo wp_json_encode(wp_create_nonce('wp_rest')); ?>;
		let rows = <?php echo wp_json_encode($rows); ?>;
		const fixed = <?php echo wp_json_encode(flc_filaments_fixed()); ?>;
		function fillFixed() {
			for (const [id, key] of [['flcFixWhite', 'white'], ['flcFixBlack', 'black']]) {
				const sel = document.getElementById(id), cur = sel.value || fixed[key];
				const opts = rows.filter((r) => r.type === 'D' && /^#[0-9a-f]{6}$/i.test(r.hex) && r.name.trim());
				sel.innerHTML = '<option value="">automatico</option>' + opts.map((r) => '<option value="' + esc(r.hex.toLowerCase()) + '"' + (r.hex.toLowerCase() === cur ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.hex.toUpperCase()) + ')</option>').join('');
			}
		}
		['flcFixWhite', 'flcFixBlack'].forEach((id) => document.getElementById(id).addEventListener('change', () => { dirty = true; msg.textContent = 'Modifiche non salvate'; }));
		const body = document.getElementById('flcFilRows'), msg = document.getElementById('flcFilMsg');
		let dirty = false, sortKey = '', sortDir = 1;
		const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
		function rowHtml(r, i) {
			const td = r.td === '' || r.td === null ? '' : r.td;
			return '<tr data-i="' + i + '" class="' + (r.on ? '' : 'off') + '">' +
				'<td><input type="color" class="c" value="' + esc(/^#[0-9a-f]{6}$/i.test(r.hex) ? r.hex : '#000000') + '"></td>' +
				'<td><input type="text" class="hex" value="' + esc(r.hex.toUpperCase()) + '" maxlength="7"></td>' +
				'<td><input type="text" class="name" value="' + esc(r.name) + '"' + (r.name ? '' : ' placeholder="es. Bambu Mandarin Orange"') + '></td>' +
				'<td><input type="text" class="label" value="' + esc(r.label) + '" placeholder="' + (r.name ? '–' : 'es. Arancio Mandarino') + '"></td>' +
				'<td><input type="number" class="tdv" step="0.1" min="0" value="' + esc(td) + '">' + (td !== '' && +td < 1 ? '<span class="td-low">da acceso scuro</span>' : '') + '</td>' +
				'<td><select class="type"><option value="D"' + (r.type === 'D' ? ' selected' : '') + '>Disco</option><option value="S"' + (r.type === 'S' ? ' selected' : '') + '>Speciale</option></select></td>' +
				'<td style="text-align:center"><input type="checkbox" class="on"' + (r.on ? ' checked' : '') + '></td>' +
				'<td><button type="button" class="button-link-delete del" title="Elimina">✕</button></td></tr>';
		}
		function render() {
			const q = document.getElementById('flcFilSearch').value.trim().toLowerCase(), f = document.getElementById('flcFilFilter').value;
			const order = rows.map((r, i) => i);
			if (sortKey) order.sort((a, b) => {
				let x = rows[a][sortKey], y = rows[b][sortKey];
				if (sortKey === 'td') { x = x === '' ? -1 : +x; y = y === '' ? -1 : +y; }
				if (sortKey === 'on') { x = +x; y = +y; }
				return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
			});
			body.innerHTML = order.filter((i) => {
				const r = rows[i];
				if (f === 'off' ? r.on : f && r.type !== f) return false;
				return !q || (r.name + ' ' + r.label + ' ' + r.hex).toLowerCase().includes(q);
			}).map((i) => rowHtml(rows[i], i)).join('');
			const dup = {};
			rows.forEach((r) => { const k = r.type + r.hex.toLowerCase(); dup[k] = (dup[k] || 0) + 1; });
			body.querySelectorAll('tr').forEach((tr) => {
				const r = rows[tr.dataset.i];
				if (r._dirty) tr.classList.add('dirty');
				if (!r.name.trim() || !/^#[0-9a-f]{6}$/i.test(r.hex) || dup[r.type + r.hex.toLowerCase()] > 1) tr.classList.add('bad');
			});
			fillFixed();
			const nD = rows.filter((r) => r.type === 'D').length, nS = rows.length - nD, off = rows.filter((r) => !r.on).length;
			document.getElementById('flcFilCount').textContent = nD + ' disco · ' + nS + ' speciali' + (off ? ' · ' + off + ' non disponibili' : '');
		}
		function touch(i) { rows[i]._dirty = true; dirty = true; msg.textContent = 'Modifiche non salvate'; }
		body.addEventListener('input', (e) => {
			const tr = e.target.closest('tr'); if (!tr) return;
			const i = +tr.dataset.i, r = rows[i], t = e.target;
			if (t.classList.contains('c')) { r.hex = t.value.toLowerCase(); tr.querySelector('.hex').value = t.value.toUpperCase(); }
			else if (t.classList.contains('hex')) { let v = t.value.trim(); if (v && v[0] !== '#') v = '#' + v; r.hex = v.toLowerCase(); if (/^#[0-9a-f]{6}$/i.test(v)) tr.querySelector('.c').value = v.toLowerCase(); }
			else if (t.classList.contains('name')) r.name = t.value;
			else if (t.classList.contains('label')) r.label = t.value;
			else if (t.classList.contains('tdv')) r.td = t.value;
			else return;
			touch(i); tr.classList.add('dirty');
			tr.classList.toggle('bad', !r.name.trim() || !/^#[0-9a-f]{6}$/i.test(r.hex));
		});
		body.addEventListener('change', (e) => {
			const tr = e.target.closest('tr'); if (!tr) return;
			const i = +tr.dataset.i, r = rows[i], t = e.target;
			if (t.classList.contains('type')) r.type = t.value;
			else if (t.classList.contains('on')) { r.on = t.checked; tr.classList.toggle('off', !r.on); }
			else return;
			touch(i); tr.classList.add('dirty');
		});
		body.addEventListener('click', (e) => {
			if (!e.target.classList.contains('del')) return;
			const i = +e.target.closest('tr').dataset.i;
			if (!confirm('Eliminare "' + (rows[i].name || rows[i].hex) + '"?')) return;
			rows.splice(i, 1); dirty = true; msg.textContent = 'Modifiche non salvate'; render();
		});
		document.getElementById('flcFilAdd').addEventListener('click', () => {
			const f = document.getElementById('flcFilFilter').value;
			rows.unshift({ type: f === 'S' ? 'S' : 'D', name: '', label: '', hex: '#ffffff', td: '', on: true, _dirty: true });
			document.getElementById('flcFilSearch').value = ''; sortKey = '';
			dirty = true; msg.textContent = 'Modifiche non salvate'; render();
			body.querySelector('tr .name').focus();
		});
		document.getElementById('flcFilSearch').addEventListener('input', render);
		document.getElementById('flcFilFilter').addEventListener('change', render);
		document.querySelectorAll('.flc-fil th[data-k]').forEach((th) => th.addEventListener('click', () => {
			sortDir = sortKey === th.dataset.k ? -sortDir : 1; sortKey = th.dataset.k; render();
		}));
		document.getElementById('flcFilSave').addEventListener('click', async () => {
			if (body.querySelector('tr.bad') && !confirm('Alcune righe (in rosso) non sono valide e verranno scartate. Salvare comunque?')) return;
			msg.textContent = 'Salvo…';
			try {
				const r = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
					body: JSON.stringify({ rows: rows.map((x) => ({ type: x.type, name: x.name, label: x.label, hex: x.hex, td: x.td, on: x.on })),
						fixed: { white: document.getElementById('flcFixWhite').value, black: document.getElementById('flcFixBlack').value } }) });
				const j = await r.json().catch(() => ({}));
				if (!r.ok) throw new Error(j.message || 'HTTP ' + r.status);
				rows.forEach((x) => { delete x._dirty; }); dirty = false;
				msg.textContent = 'Salvato: ' + j.disco + ' disco, ' + j.speciali + ' speciali.' + (j.errors && j.errors.length ? ' ' + j.errors.join(' ') : '');
				render();
			} catch (e) { msg.textContent = 'Errore: ' + e.message; }
		});
		window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
		render();
	})();
	</script>
	<?php
}

