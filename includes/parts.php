<?php
// Parti della lampada per l'anteprima 3D (base, perni, tappo frontale, cover…): si caricano da
// Impostazioni → Lampada 3D. Il file STL viene convertito NEL BROWSER dell'admin in un formato compatto
// (.flm, coordinate quantizzate): al server arriva solo quello, mai lo STL. I file stanno in una cartella
// non accessibile dal web e la pagina li riceve da un endpoint che vuole il token (nonce) della pagina.
// Consiglio: carica modelli "vetrina" (forma esterna, senza tolleranze né dettagli interni).

if (!defined('ABSPATH')) {
	exit;
}

const FLC_PARTS_OPTION = 'flc_lamp_parts';
const FLC_PART_MATERIALS = array('opaco' => 'Opaco', 'lucido' => 'Lucido', 'silk' => 'Silk (satinato)', 'metallico' => 'Metallico');

// Riferimenti predefiniti: coordinate del modello originale (centro del disco, faccia frontale)
function flc_parts_defaults() {
	return array('parts' => array(), 'ref' => array('cx' => 1055.48, 'cy' => 1173.26, 'front' => 1056.74, 'recess' => 2));
}

function flc_parts() {
	$p = get_option(FLC_PARTS_OPTION, array());
	$p = is_array($p) ? $p : array();
	$d = flc_parts_defaults();
	return array(
		'parts' => isset($p['parts']) && is_array($p['parts']) ? array_values($p['parts']) : array(),
		'ref'   => wp_parse_args(isset($p['ref']) && is_array($p['ref']) ? $p['ref'] : array(), $d['ref']),
	);
}

function flc_parts_dir() {
	$up  = wp_upload_dir(null, false);
	$dir = trailingslashit($up['basedir']) . 'francy-lamp-parti';
	if (!is_dir($dir)) {
		wp_mkdir_p($dir);
	}
	if (!file_exists($dir . '/.htaccess')) {
		file_put_contents($dir . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
	}
	if (!file_exists($dir . '/index.php')) {
		file_put_contents($dir . '/index.php', "<?php // Silence is golden.\n");
	}
	return $dir;
}

function flc_hex_or($v, $fallback) {
	$v = sanitize_hex_color((string) $v);
	return $v ? strtolower($v) : $fallback;
}

// Per il configuratore: solo quello che serve a disegnarle (niente nomi dei file)
function flc_parts_for_frontend() {
	$p = flc_parts();
	return array(
		'url'   => esc_url_raw(rest_url('francy-lamp/v1/lampada/')),
		'ref'   => array_map('floatval', $p['ref']),
		'parts' => array_map(function ($x) {
			return array(
				'id'       => $x['id'],
				'name'     => $x['name'],
				'color'    => $x['color'],
				'material' => $x['material'],
				'choice'   => !empty($x['choice']) && !empty($x['choices']),
				'choices'  => array_values((array) ($x['choices'] ?? array())),
			);
		}, $p['parts']),
	);
}

add_action('rest_api_init', function () {
	$admin = function () { return current_user_can('manage_options'); };

	// carica una parte (file .flm già convertito nel browser)
	register_rest_route('francy-lamp/v1', '/parti', array(
		'methods'             => 'POST',
		'permission_callback' => $admin,
		'callback'            => function (WP_REST_Request $req) {
			$files = $req->get_file_params();
			$f     = $files['mesh'] ?? null;
			if (!$f || !empty($f['error']) || !is_uploaded_file($f['tmp_name']) || filesize($f['tmp_name']) > 40 * MB_IN_BYTES) {
				return new WP_Error('flc_bad', 'File non ricevuto o troppo grande.', array('status' => 400));
			}
			$head = file_get_contents($f['tmp_name'], false, null, 0, 8);
			$n    = strlen($head) === 8 ? unpack('V', substr($head, 4, 4))[1] : 0;
			if (substr($head, 0, 4) !== 'FLM1' || $n < 1 || filesize($f['tmp_name']) !== 24 + $n * 18) {
				return new WP_Error('flc_bad', 'Formato non valido.', array('status' => 400));
			}
			$dir  = flc_parts_dir();
			$id   = substr(md5(wp_generate_uuid4()), 0, 8);
			$file = md5(wp_generate_uuid4() . wp_salt()) . '.flm';
			if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $file)) {
				return new WP_Error('flc_io', 'Impossibile salvare il file.', array('status' => 500));
			}
			$p            = flc_parts();
			$name         = sanitize_text_field((string) $req->get_param('name')) ?: 'Parte';
			$p['parts'][] = array(
				'id'       => $id,
				'name'     => mb_substr($name, 0, 40),
				'file'     => $file,
				'tris'     => $n,
				'color'    => flc_hex_or($req->get_param('color'), '#1a1a1a'),
				'material' => isset(FLC_PART_MATERIALS[$req->get_param('material')]) ? $req->get_param('material') : 'opaco',
				'choice'   => 0,
				'choices'  => array(),
			);
			update_option(FLC_PARTS_OPTION, $p, false);
			return array('ok' => true, 'id' => $id);
		},
	));

	// salva nomi, colori, materiali, scelte del cliente, riferimenti
	register_rest_route('francy-lamp/v1', '/parti/salva', array(
		'methods'             => 'POST',
		'permission_callback' => $admin,
		'callback'            => function (WP_REST_Request $req) {
			$p   = flc_parts();
			$in  = (array) $req->get_param('parts');
			$byId = array();
			foreach ($in as $x) {
				if (is_array($x) && !empty($x['id'])) {
					$byId[(string) $x['id']] = $x;
				}
			}
			foreach ($p['parts'] as &$part) {
				if (!isset($byId[$part['id']])) {
					continue;
				}
				$x                = $byId[$part['id']];
				$part['name']     = mb_substr(sanitize_text_field((string) ($x['name'] ?? $part['name'])), 0, 40) ?: $part['name'];
				$part['color']    = flc_hex_or($x['color'] ?? '', $part['color']);
				$part['material'] = isset(FLC_PART_MATERIALS[$x['material'] ?? '']) ? $x['material'] : $part['material'];
				$part['choice']   = empty($x['choice']) ? 0 : 1;
				$part['choices']  = array_values(array_unique(array_filter(array_map(function ($c) { return flc_hex_or($c, ''); }, (array) ($x['choices'] ?? array())))));
			}
			unset($part);
			$ref = (array) $req->get_param('ref');
			foreach (array('cx', 'cy', 'front', 'recess') as $k) {
				if (isset($ref[$k]) && is_numeric($ref[$k])) {
					$p['ref'][$k] = round((float) $ref[$k], 3);
				}
			}
			update_option(FLC_PARTS_OPTION, $p, false);
			return array('ok' => true);
		},
	));

	// elimina una parte
	register_rest_route('francy-lamp/v1', '/parti/elimina', array(
		'methods'             => 'POST',
		'permission_callback' => $admin,
		'callback'            => function (WP_REST_Request $req) {
			$p  = flc_parts();
			$id = (string) $req->get_param('id');
			foreach ($p['parts'] as $i => $part) {
				if ($part['id'] === $id) {
					@unlink(flc_parts_dir() . '/' . basename($part['file']));
					array_splice($p['parts'], $i, 1);
					break;
				}
			}
			update_option(FLC_PARTS_OPTION, $p, false);
			return array('ok' => true);
		},
	));

	// la pagina del configuratore scarica la geometria (serve il token della pagina, niente link diretti)
	register_rest_route('francy-lamp/v1', '/lampada/(?P<id>[a-f0-9]{8})', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function (WP_REST_Request $req) {
			if (!wp_verify_nonce((string) $req->get_header('x_wp_nonce'), 'wp_rest')) {
				return new WP_Error('flc_forbidden', 'Non autorizzato.', array('status' => 403));
			}
			foreach (flc_parts()['parts'] as $part) {
				if ($part['id'] !== $req['id']) {
					continue;
				}
				$path = flc_parts_dir() . '/' . basename($part['file']);
				if (!is_file($path)) {
					break;
				}
				nocache_headers();
				header('Content-Type: application/octet-stream');
				header('Content-Length: ' . filesize($path));
				header('X-Content-Type-Options: nosniff');
				readfile($path);
				exit;
			}
			return new WP_Error('flc_404', 'Parte non trovata.', array('status' => 404));
		},
	));
});

// ---------- Modello della targa dell'ambientazione 3D (Impostazioni → Anteprima e watermark) ----------
// Stesso formato e cartella protetta dei pezzi della lampada; se non c'è, il configuratore usa quello del plugin.
const FLC_SIGN_MODEL_OPTION = 'flc_sign_model';

function flc_sign_model() {
	$m = get_option(FLC_SIGN_MODEL_OPTION, array());
	return is_array($m) && !empty($m['file']) && is_file(flc_parts_dir() . '/' . basename($m['file'])) ? $m : null;
}

add_action('rest_api_init', function () {
	$admin = function () { return current_user_can('manage_options'); };
	register_rest_route('francy-lamp/v1', '/scena/insegna', array(
		array(
			'methods'             => 'POST',
			'permission_callback' => $admin,
			'callback'            => function (WP_REST_Request $req) {
				$f = $req->get_file_params()['mesh'] ?? null;
				if (!$f || !empty($f['error']) || !is_uploaded_file($f['tmp_name']) || filesize($f['tmp_name']) > 20 * MB_IN_BYTES) {
					return new WP_Error('flc_bad', 'File non ricevuto o troppo grande.', array('status' => 400));
				}
				$head = file_get_contents($f['tmp_name'], false, null, 0, 8);
				$n    = strlen($head) === 8 ? unpack('V', substr($head, 4, 4))[1] : 0;
				if (substr($head, 0, 4) !== 'FLM1' || $n < 1 || filesize($f['tmp_name']) !== 24 + $n * 18) {
					return new WP_Error('flc_bad', 'Formato non valido.', array('status' => 400));
				}
				$old  = flc_sign_model();
				$file = md5(wp_generate_uuid4() . wp_salt()) . '.flm';
				if (!move_uploaded_file($f['tmp_name'], flc_parts_dir() . '/' . $file)) {
					return new WP_Error('flc_io', 'Impossibile salvare il file.', array('status' => 500));
				}
				if ($old) {
					@unlink(flc_parts_dir() . '/' . basename($old['file']));
				}
				update_option(FLC_SIGN_MODEL_OPTION, array('file' => $file, 'tris' => $n, 'name' => mb_substr(sanitize_file_name((string) $req->get_param('name')), 0, 80), 'time' => time()), false);
				return array('ok' => true, 'tris' => $n);
			},
		),
		array(
			// il configuratore scarica la geometria con il token della pagina (come i pezzi della lampada)
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => function (WP_REST_Request $req) {
				if (!wp_verify_nonce((string) $req->get_header('x_wp_nonce'), 'wp_rest')) {
					return new WP_Error('flc_forbidden', 'Non autorizzato.', array('status' => 403));
				}
				$m = flc_sign_model();
				if (!$m) {
					return new WP_Error('flc_404', 'Modello non trovato.', array('status' => 404));
				}
				$path = flc_parts_dir() . '/' . basename($m['file']);
				nocache_headers();
				header('Content-Type: application/octet-stream');
				header('Content-Length: ' . filesize($path));
				header('X-Content-Type-Options: nosniff');
				readfile($path);
				exit;
			},
		),
	));
	register_rest_route('francy-lamp/v1', '/scena/insegna/elimina', array(
		'methods'             => 'POST',
		'permission_callback' => $admin,
		'callback'            => function () {
			$m = flc_sign_model();
			if ($m) {
				@unlink(flc_parts_dir() . '/' . basename($m['file']));
			}
			delete_option(FLC_SIGN_MODEL_OPTION);
			return array('ok' => true);
		},
	));
});
