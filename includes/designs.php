<?php
// Progetti convalidati dai clienti: menu "Francy Lamp Factory" → Progetti.
// Ogni convalida salva uno zip con tutto il materiale (anteprime, originale, ridisegno IA, SVG/EPS, STL,
// lista filamenti) in una cartella protetta e crea una voce nella tabella. I file si scaricano solo da admin.

if (!defined('ABSPATH')) {
	exit;
}

const FLC_STATI = array(
	'nuovo'       => 'Nuovo',
	'lavorazione' => 'In lavorazione',
	'stampato'    => 'Stampato',
	'consegnato'  => 'Consegnato',
	'annullato'   => 'Annullato',
);

add_action('init', function () {
	register_post_type('flc_design', array(
		'labels'          => array(
			'name'               => 'Progetti lampade',
			'singular_name'      => 'Progetto lampada',
			'menu_name'          => 'Francy Lamp Factory',
			'all_items'          => 'Progetti',
			'edit_item'          => 'Progetto',
			'search_items'       => 'Cerca progetti',
			'not_found'          => 'Ancora nessun disco convalidato.',
			'not_found_in_trash' => 'Nessun progetto nel cestino.',
		),
		'public'          => false,
		'show_ui'         => true,
		'show_in_menu'    => true,
		'menu_position'   => 26,
		'menu_icon'       => 'dashicons-lightbulb',
		'supports'        => array('title'),
		'map_meta_cap'    => false,
		// Solo gli amministratori vedono i progetti (dati dei clienti); si creano solo dal configuratore
		'capabilities'    => array(
			'edit_post'          => 'manage_options',
			'read_post'          => 'manage_options',
			'delete_post'        => 'manage_options',
			'edit_posts'         => 'manage_options',
			'edit_others_posts'  => 'manage_options',
			'delete_posts'       => 'manage_options',
			'publish_posts'      => 'manage_options',
			'read_private_posts' => 'manage_options',
			'create_posts'       => 'do_not_allow',
		),
	));
});

// ---------------- cartella protetta ----------------
function flc_storage_base() {
	$up   = wp_upload_dir(null, false);
	$base = trailingslashit($up['basedir']) . 'francy-lamp';
	if (!is_dir($base)) {
		wp_mkdir_p($base);
	}
	// niente accesso diretto dal web: i file passano solo dal download per admin
	if (!file_exists($base . '/.htaccess')) {
		@file_put_contents($base . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
	}
	if (!file_exists($base . '/index.php')) {
		@file_put_contents($base . '/index.php', "<?php // silenzio\n");
	}
	return $base;
}

function flc_design_dir($post_id) {
	$uuid = get_post_meta($post_id, '_flc_dir', true);
	if (!$uuid || !preg_match('/^[a-f0-9-]{36}$/', $uuid)) {
		return '';
	}
	return flc_storage_base() . '/' . $uuid;
}

const FLC_FILES = array(
	'zip'         => array('progetto.zip', 'application/zip', 'attachment'),
	'preview'     => array('anteprima.png', 'image/png', 'inline'),
	'preview_lit' => array('anteprima-accesa.png', 'image/png', 'inline'),
	'francy'      => array('progetto.francy', 'application/octet-stream', 'attachment'), // progetto del cliente da riaprire
);

// progetto .francy del cliente presente?
function flc_design_has_francy($post_id) {
	$dir = flc_design_dir($post_id);
	return $dir && is_file($dir . '/progetto.francy');
}
// apre il configuratore con il progetto del cliente (solo admin)
function flc_design_open_url($post_id) {
	return add_query_arg('flc_prj', (int) $post_id, function_exists('flc_page_url') ? flc_page_url() : home_url('/'));
}

function flc_file_url($post_id, $which) {
	// URL "grezzo" (non codificato per l'HTML): serve anche al configuratore per scaricare il .francy con fetch;
	// wp_nonce_url restituirebbe &amp; e la chiave di sicurezza andrebbe persa (errore 403). Nell'HTML passa da esc_url.
	return add_query_arg(array('action' => 'flc_file', 'id' => (int) $post_id, 'f' => $which, '_wpnonce' => wp_create_nonce('flc_file_' . (int) $post_id)), admin_url('admin-post.php'));
}

add_action('admin_post_flc_file', function () {
	$id = absint($_GET['id'] ?? 0);
	$f  = sanitize_key($_GET['f'] ?? '');
	if (!current_user_can('manage_options') || !wp_verify_nonce($_GET['_wpnonce'] ?? '', 'flc_file_' . $id)) {
		wp_die('Non autorizzato.', 403);
	}
	$dir = flc_design_dir($id);
	if (!$dir || !isset(FLC_FILES[$f]) || !is_file($dir . '/' . FLC_FILES[$f][0])) {
		wp_die('File non trovato.', 404);
	}
	list($file, $type, $disp) = FLC_FILES[$f];
	$path = $dir . '/' . $file;
	$code = get_post_meta($id, '_flc_code', true) ?: 'progetto-' . $id;
	$name = $f === 'zip' ? sanitize_file_name($code . '.zip') : ($f === 'francy' ? sanitize_file_name($code . '.francy') : sanitize_file_name($code . '-' . $file));
	nocache_headers();
	header('Content-Type: ' . $type);
	header('Content-Length: ' . filesize($path));
	header('Content-Disposition: ' . $disp . '; filename="' . $name . '"');
	header('X-Content-Type-Options: nosniff');
	readfile($path);
	exit;
});

// Cancellando un progetto (svuotando il cestino) si cancellano anche i suoi file
add_action('before_delete_post', function ($post_id) {
	if (get_post_type($post_id) !== 'flc_design') {
		return;
	}
	$dir  = flc_design_dir($post_id);
	$base = realpath(flc_storage_base());
	if ($dir && is_dir($dir) && $base && strpos(realpath($dir), $base) === 0) {
		foreach (glob($dir . '/*') as $file) {
			@unlink($file);
		}
		@rmdir($dir);
	}
});

// ---------------- convalida dal configuratore ----------------
add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/convalida', array(
		'methods'             => 'POST',
		'callback'            => 'flc_rest_convalida',
		'permission_callback' => 'flc_rest_permission',
	));
});

function flc_is_png($path) {
	return is_file($path) && file_get_contents($path, false, null, 0, 8) === "\x89PNG\r\n\x1a\n";
}

function flc_rest_convalida(WP_REST_Request $req) {
	$s = flc_settings();
	if (empty($s['feat_submit'])) {
		return new WP_Error('flc_off', 'La convalida dei dischi è momentaneamente disattivata.', array('status' => 403));
	}

	// campo esca: i bot lo riempiono, le persone non lo vedono
	if (trim((string) $req->get_param('website')) !== '') {
		return array('ok' => true, 'code' => 'FL-0000');
	}

	$key  = 'flc_sub_' . md5(wp_salt('nonce') . ($_SERVER['REMOTE_ADDR'] ?? '') . current_time('Y-m-d'));
	$used = (int) get_transient($key);
	if ($s['submit_per_ip'] > 0 && $used >= $s['submit_per_ip']) {
		return new WP_Error('flc_limit', 'Hai già inviato diversi dischi oggi. Se serve, contatta il negozio.', array('status' => 429));
	}

	// dati del cliente e riepilogo
	$meta = json_decode((string) $req->get_param('meta'), true);
	if (!is_array($meta)) {
		return new WP_Error('flc_bad', 'Dati del progetto mancanti.', array('status' => 400));
	}
	// il browser del cliente conosce solo i codici neutri delle bobine: qui tornano i nomi veri
	$fil_map = function_exists('flc_filament_token_map') ? flc_filament_token_map() : array();
	$meta    = flc_resolve_tokens_deep($meta, $fil_map);
	$c        = is_array($meta['cliente'] ?? null) ? $meta['cliente'] : array();
	$customer = array(
		'name'  => sanitize_text_field($c['name'] ?? ''),
		'email' => sanitize_email($c['email'] ?? ''),
		'phone' => sanitize_text_field($c['phone'] ?? ''),
		'note'  => sanitize_textarea_field($c['note'] ?? ''),
	);
	if ($customer['name'] === '' || !is_email($customer['email'])) {
		return new WP_Error('flc_bad', 'Inserisci nome ed email validi.', array('status' => 400));
	}

	// file caricati
	$files = $req->get_file_params();
	foreach (array('package' => 200, 'preview' => 15, 'preview_lit' => 15) as $field => $maxMb) {
		$f = $files[$field] ?? null;
		if (!$f || !empty($f['error']) || empty($f['tmp_name']) || !is_uploaded_file($f['tmp_name'])) {
			$err = $f['error'] ?? -1;
			$msg = in_array($err, array(UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE), true)
				? 'I file superano il limite di upload del server.'
				: 'File del progetto mancanti o non caricati.';
			return new WP_Error('flc_upload', $msg, array('status' => 400));
		}
		if ($f['size'] > $maxMb * MB_IN_BYTES) {
			return new WP_Error('flc_upload', 'File del progetto troppo grandi.', array('status' => 413));
		}
	}
	if (file_get_contents($files['package']['tmp_name'], false, null, 0, 4) !== "PK\x03\x04"
		|| !flc_is_png($files['preview']['tmp_name']) || !flc_is_png($files['preview_lit']['tmp_name'])) {
		return new WP_Error('flc_upload', 'File del progetto non validi.', array('status' => 400));
	}

	// progetto .francy (facoltativo): JSON compresso gzip o JSON semplice
	$prj = $files['project'] ?? null;
	$has_prj = $prj && empty($prj['error']) && !empty($prj['tmp_name']) && is_uploaded_file($prj['tmp_name']) && $prj['size'] <= 60 * MB_IN_BYTES;
	if ($has_prj) {
		$head    = file_get_contents($prj['tmp_name'], false, null, 0, 2);
		$has_prj = $head === "\x1f\x8b" || ($head !== '' && $head[0] === '{');
	}

	set_transient($key, $used + 1, DAY_IN_SECONDS);

	// salvataggio
	$uuid = wp_generate_uuid4();
	$dir  = flc_storage_base() . '/' . $uuid;
	if (!wp_mkdir_p($dir)) {
		return new WP_Error('flc_fs', 'Impossibile salvare i file sul server.', array('status' => 500));
	}
	foreach (array('package' => 'progetto.zip', 'preview' => 'anteprima.png', 'preview_lit' => 'anteprima-accesa.png') as $field => $name) {
		if (!move_uploaded_file($files[$field]['tmp_name'], $dir . '/' . $name)) {
			return new WP_Error('flc_fs', 'Impossibile salvare i file sul server.', array('status' => 500));
		}
	}
	if ($has_prj) {
		@move_uploaded_file($prj['tmp_name'], $dir . '/progetto.francy');
	}
	flc_resolve_zip_tokens($dir . '/progetto.zip', $fil_map);

	// colori / filamenti
	$colors = array();
	foreach ((array) ($meta['colori'] ?? array()) as $col) {
		if (!is_array($col) || !preg_match('/^#[0-9a-f]{6}$/i', $col['hex'] ?? '')) {
			continue;
		}
		$colors[] = array(
			'hex'      => strtolower($col['hex']),
			'filament' => sanitize_text_field($col['filament'] ?? ''),
			'roles'    => array_map('sanitize_text_field', array_slice((array) ($col['roles'] ?? array()), 0, 6)),
			'area'     => (int) ($col['area'] ?? 0),
		);
	}
	$texts = array_map('sanitize_text_field', array_slice((array) ($meta['scritte'] ?? array()), 0, 4));
	// disegno pronto scelto dalla galleria (niente personalizzazione)
	$template = null;
	if (is_array($meta['template'] ?? null) && !empty($meta['template']['id'])) {
		$tid      = absint($meta['template']['id']);
		$template = array('id' => $tid, 'name' => get_post_type($tid) === 'flc_template' ? get_the_title($tid) : sanitize_text_field($meta['template']['name'] ?? ''));
	}

	// codice progressivo FL-anno-numero
	$n    = (int) get_option('flc_design_counter', 0) + 1;
	update_option('flc_design_counter', $n, false);
	$code = sprintf('FL-%s-%04d', current_time('Y'), $n);

	$post_id = wp_insert_post(array(
		'post_type'   => 'flc_design',
		'post_status' => 'publish',
		'post_title'  => $code . ' – ' . $customer['name'] . ($template ? ' (disegno pronto: ' . $template['name'] . ')' : ''),
	), true);
	if (is_wp_error($post_id)) {
		return new WP_Error('flc_db', 'Impossibile registrare il progetto.', array('status' => 500));
	}
	update_post_meta($post_id, '_flc_code', $code);
	update_post_meta($post_id, '_flc_dir', $uuid);
	update_post_meta($post_id, '_flc_customer', $customer);
	update_post_meta($post_id, '_flc_colors', $colors);
	update_post_meta($post_id, '_flc_texts', $texts);
	// colori dei pezzi della lampada (base, perni, cover…)
	$lamp = array();
	foreach ((array) ($meta['lampada'] ?? array()) as $l) {
		if (!is_array($l)) {
			continue;
		}
		$lamp[] = array(
			'parte'    => mb_substr(sanitize_text_field((string) ($l['parte'] ?? '')), 0, 40),
			'colore'   => sanitize_hex_color((string) ($l['colore'] ?? '')) ?: '',
			'filamento' => mb_substr(sanitize_text_field((string) ($l['filamento'] ?? '')), 0, 60),
			'cliente'  => !empty($l['scelto_dal_cliente']),
		);
	}
	update_post_meta($post_id, '_flc_lamp', array_slice($lamp, 0, 20));
	if ($template) {
		update_post_meta($post_id, '_flc_template', $template);
	}
	update_post_meta($post_id, '_flc_stato', 'nuovo');
	// inviato dal negozio stesso (admin loggato): nella lista finisce nel blocco "I miei"
	update_post_meta($post_id, '_flc_mine', current_user_can('manage_options') ? 1 : 0);
	update_post_meta($post_id, '_flc_user', get_current_user_id());
	update_post_meta($post_id, '_flc_ai', !empty($meta['impostazioni']['ia']) ? 1 : 0);
	update_post_meta($post_id, '_flc_zip_size', (int) filesize($dir . '/progetto.zip'));

	// notifica
	$to   = $s['notify_email'] ?: get_option('admin_email');
	$body = "Nuovo disco convalidato: {$code}\n\n"
		. "Cliente: {$customer['name']} <{$customer['email']}>" . ($customer['phone'] ? " – tel. {$customer['phone']}" : '') . "\n"
		. ($customer['note'] ? "Note: {$customer['note']}\n" : '')
		. ($template ? "Disegno pronto: {$template['name']} (ID {$template['id']})\n" : '')
		. ($colors ? "\nFilamenti:\n" : '');
	foreach ($colors as $col) {
		$body .= "- {$col['hex']}  " . ($col['filament'] ?: '(nessun catalogo)') . '  → ' . implode(', ', $col['roles']) . "\n";
	}
	$body .= "\nApri il progetto: " . admin_url('post.php?post=' . $post_id . '&action=edit') . "\n";
	wp_mail($to, "[Francy Lamp] Nuovo disco {$code} – {$customer['name']}", $body);

	return array('ok' => true, 'code' => $code);
}

// ---------------- tabella progetti ----------------
add_filter('manage_flc_design_posts_columns', function () {
	return array(
		'cb'           => '<input type="checkbox" />',
		'flc_preview'  => 'Anteprima',
		'title'        => 'Progetto',
		'flc_customer' => 'Cliente',
		'flc_colors'   => 'Filamenti',
		'flc_stato'    => 'Stato',
		'flc_files'    => 'File',
		'date'         => 'Data',
	);
});

function flc_swatches($colors, $size = 18) {
	$h = '<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:260px">';
	foreach ((array) $colors as $col) {
		$title = trim(($col['filament'] ?: $col['hex']) . ' – ' . implode(', ', (array) $col['roles']));
		$h    .= '<span title="' . esc_attr($title) . '" style="width:' . (int) $size . 'px;height:' . (int) $size . 'px;border-radius:50%;background:' . esc_attr($col['hex']) . ';border:1px solid #c3c4c7;display:inline-block"></span>';
	}
	return $h . '</div>';
}

function flc_stato_badge($stato) {
	$colors = array('nuovo' => '#2271b1', 'lavorazione' => '#dba617', 'stampato' => '#00a32a', 'consegnato' => '#646970', 'annullato' => '#d63638');
	$label  = FLC_STATI[$stato] ?? $stato;
	return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;color:#fff;font-size:12px;background:' . esc_attr($colors[$stato] ?? '#646970') . '">' . esc_html($label) . '</span>';
}

add_action('manage_flc_design_posts_custom_column', function ($col, $post_id) {
	switch ($col) {
		case 'flc_preview':
			echo '<a href="' . esc_url(get_edit_post_link($post_id)) . '"><img src="' . esc_url(flc_file_url($post_id, 'preview')) . '" alt="" style="width:72px;height:72px;object-fit:contain" loading="lazy"></a>';
			break;
		case 'flc_customer':
			$c = (array) get_post_meta($post_id, '_flc_customer', true);
			echo esc_html($c['name'] ?? '') . (flc_design_is_mine($post_id) ? '<span class="flc-mine-badge">MIO</span>' : '') . '<br><a href="mailto:' . esc_attr($c['email'] ?? '') . '">' . esc_html($c['email'] ?? '') . '</a>';
			if (!empty($c['phone'])) {
				echo '<br>' . esc_html($c['phone']);
			}
			break;
		case 'flc_colors':
			$tpl = get_post_meta($post_id, '_flc_template', true);
			if ($tpl) {
				echo '<strong>Disegno pronto</strong><br>' . esc_html($tpl['name'] ?? '');
				break;
			}
			$colors = (array) get_post_meta($post_id, '_flc_colors', true);
			echo flc_swatches($colors) . '<span class="description">' . count($colors) . (count($colors) === 1 ? ' colore' : ' colori') . '</span>';
			break;
		case 'flc_stato':
			echo flc_stato_badge(get_post_meta($post_id, '_flc_stato', true) ?: 'nuovo');
			if (get_post_meta($post_id, '_flc_ai', true)) {
				echo '<br><span class="description">con ridisegno IA</span>';
			}
			break;
		case 'flc_files':
			$size = (int) get_post_meta($post_id, '_flc_zip_size', true);
			echo '<a class="button button-small" href="' . esc_url(flc_file_url($post_id, 'zip')) . '">Scarica zip</a>';
			if (flc_design_has_francy($post_id)) {
				echo ' <a class="button button-small" href="' . esc_url(flc_design_open_url($post_id)) . '" target="_blank" title="Riapre il progetto del cliente nel configuratore">✏️ Apri</a>'
					. ' <a class="button button-small" href="' . esc_url(add_query_arg('flc_mk', 1, flc_design_open_url($post_id))) . '" target="_blank" title="Apre il progetto e la finestra per farne un template (disegno pronto)">📌 Template</a>'
					. ' <a href="' . esc_url(flc_file_url($post_id, 'francy')) . '" title="Scarica il progetto .francy">.francy</a>';
			}
			if ($size) {
				echo '<br><span class="description">' . esc_html(size_format($size, 1)) . '</span>';
			}
			break;
	}
}, 10, 2);

// niente "Visualizza" / "Modifica rapida" (non sono pagine del sito)
add_filter('post_row_actions', function ($actions, $post) {
	if ($post->post_type === 'flc_design') {
		unset($actions['view'], $actions['inline hide-if-no-js']);
	}
	return $actions;
}, 10, 2);

// filtro per stato sopra la tabella
add_action('restrict_manage_posts', function ($post_type) {
	if ($post_type !== 'flc_design') {
		return;
	}
	$cur = sanitize_key($_GET['flc_stato'] ?? '');
	echo '<select name="flc_stato"><option value="">Tutti gli stati</option>';
	foreach (FLC_STATI as $k => $label) {
		echo '<option value="' . esc_attr($k) . '"' . selected($cur, $k, false) . '>' . esc_html($label) . '</option>';
	}
	echo '</select>';
});
add_action('pre_get_posts', function ($q) {
	if (!is_admin() || !$q->is_main_query() || $q->get('post_type') !== 'flc_design') {
		return;
	}
	$mq = array();
	if (!empty($_GET['flc_stato'])) {
		$mq[] = array('key' => '_flc_stato', 'value' => sanitize_key($_GET['flc_stato']));
	}
	$chi = sanitize_key($_GET['flc_chi'] ?? '');
	if ($chi === 'miei') {
		$mq[] = array('key' => '_flc_mine', 'value' => 1, 'type' => 'NUMERIC');
	} elseif ($chi === 'clienti') {
		$mq[] = array('relation' => 'OR',
			array('key' => '_flc_mine', 'value' => 0, 'type' => 'NUMERIC'),
			array('key' => '_flc_mine', 'compare' => 'NOT EXISTS'));
	} elseif (empty($_GET['orderby'])) {
		// vista "Tutti": prima il blocco dei miei, poi i clienti, ognuno dal più recente
		$mq['flc_mine'] = array('relation' => 'OR',
			'flc_mine_set' => array('key' => '_flc_mine', 'type' => 'NUMERIC', 'compare' => 'EXISTS'),
			array('key' => '_flc_mine', 'compare' => 'NOT EXISTS'));
		$q->set('orderby', array('flc_mine_set' => 'DESC', 'date' => 'DESC'));
	}
	if ($mq) {
		$q->set('meta_query', array_merge(array('relation' => 'AND'), $mq));
	}
});

// ---------------- i miei progetti / quelli dei clienti ----------------
function flc_design_is_mine($post_id) {
	return (int) get_post_meta($post_id, '_flc_mine', true) === 1;
}

// progetti salvati prima della 0.52: sono "miei" se l'email è quella di un amministratore
add_action('admin_init', function () {
	if (get_option('flc_mine_v') === '1') {
		return;
	}
	$emails = array(strtolower((string) get_option('admin_email')));
	foreach (get_users(array('role' => 'administrator', 'fields' => array('user_email'))) as $u) {
		$emails[] = strtolower($u->user_email);
	}
	$ids = get_posts(array('post_type' => 'flc_design', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids',
		'meta_query' => array(array('key' => '_flc_mine', 'compare' => 'NOT EXISTS'))));
	foreach ($ids as $id) {
		$c = (array) get_post_meta($id, '_flc_customer', true);
		update_post_meta($id, '_flc_mine', in_array(strtolower((string) ($c['email'] ?? '')), $emails, true) ? 1 : 0);
	}
	update_option('flc_mine_v', '1', false);
});

function flc_design_count_mine($mine) {
	$q = new WP_Query(array('post_type' => 'flc_design', 'post_status' => array('publish', 'draft', 'pending', 'private'),
		'posts_per_page' => 1, 'fields' => 'ids', 'no_found_rows' => false,
		'meta_query' => array(array('key' => '_flc_mine', 'value' => $mine ? 1 : 0, 'type' => 'NUMERIC'))));
	return (int) $q->found_posts;
}

add_filter('views_edit-flc_design', function ($views) {
	$chi  = sanitize_key($_GET['flc_chi'] ?? '');
	$base = remove_query_arg(array('flc_chi', 'paged', 'post_status'), admin_url('edit.php?post_type=flc_design'));
	$mk   = function ($key, $label, $n) use ($chi, $base) {
		$cur = $chi === $key ? ' class="current" aria-current="page"' : '';
		return '<a href="' . esc_url(add_query_arg('flc_chi', $key, $base)) . '"' . $cur . '>' . $label . ' <span class="count">(' . (int) $n . ')</span></a>';
	};
	if ($chi) {
		foreach ($views as $k => $v) {
			$views[$k] = str_replace(array(' class="current"', ' aria-current="page"'), '', $v);
		}
	}
	$views['flc_miei']    = $mk('miei', '👤 I miei', flc_design_count_mine(true));
	$views['flc_clienti'] = $mk('clienti', '🛒 Clienti', flc_design_count_mine(false));
	return $views;
});

add_filter('post_class', function ($classes, $class, $post_id) {
	if (is_admin() && get_post_type($post_id) === 'flc_design') {
		$classes[] = flc_design_is_mine($post_id) ? 'flc-mine' : 'flc-client';
	}
	return $classes;
}, 10, 3);

// blocchi evidenziati + intestazione "I miei progetti" / "Progetti dei clienti" sopra ogni gruppo
add_action('admin_head-edit.php', function () {
	if (get_current_screen()->post_type !== 'flc_design') {
		return;
	}
	?>
	<style>
		.wp-list-table tr.flc-mine { background: #fff8e5 !important; }
		.wp-list-table tr.flc-mine th.check-column { border-left: 4px solid #dba617; }
		.wp-list-table tr.flc-group td { background: #f0f0f1; font-weight: 600; font-size: 13px; padding: 8px 12px; border-top: 2px solid #c3c4c7; }
		.wp-list-table tr.flc-group.mine td { background: #fcf0d0; border-top-color: #dba617; color: #6b4f00; }
		.flc-mine-badge { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 10px; background: #dba617; color: #fff; font-size: 11px; font-weight: 600; vertical-align: middle; }
	</style>
	<script>
	document.addEventListener('DOMContentLoaded', function () {
		var tb = document.querySelector('#the-list');
		if (!tb) return;
		var cols = (document.querySelectorAll('.wp-list-table thead tr > *') || []).length || 8;
		var rows = Array.prototype.slice.call(tb.querySelectorAll(':scope > tr.flc-mine, :scope > tr.flc-client'));
		var hasM = rows.some(function (r) { return r.classList.contains('flc-mine'); });
		var hasC = rows.some(function (r) { return r.classList.contains('flc-client'); });
		if (!hasM || !hasC) return; // un solo gruppo (es. vista filtrata): niente intestazioni
		var last = null;
		rows.forEach(function (r) {
			var g = r.classList.contains('flc-mine') ? 'mine' : 'client';
			if (g === last) return;
			last = g;
			var h = document.createElement('tr');
			h.className = 'flc-group ' + g;
			h.innerHTML = '<td colspan="' + cols + '">' + (g === 'mine' ? '👤 I miei progetti' : '🛒 Progetti dei clienti') + '</td>';
			r.parentNode.insertBefore(h, r);
		});
	});
	</script>
	<?php
});

// ---------------- scheda del progetto ----------------
add_action('add_meta_boxes_flc_design', function () {
	add_meta_box('flc_dettagli', 'Disco', 'flc_design_box', 'flc_design', 'normal', 'high');
	add_meta_box('flc_stato_box', 'Stato e file', 'flc_stato_box', 'flc_design', 'side', 'high');
});

function flc_design_box($post) {
	$c      = (array) get_post_meta($post->ID, '_flc_customer', true);
	$colors = (array) get_post_meta($post->ID, '_flc_colors', true);
	$texts  = array_filter((array) get_post_meta($post->ID, '_flc_texts', true));
	?>
	<div style="display:flex;gap:16px;flex-wrap:wrap">
		<figure style="margin:0;text-align:center"><img src="<?php echo esc_url(flc_file_url($post->ID, 'preview')); ?>" style="width:320px;max-width:100%" alt=""><figcaption>Spenta</figcaption></figure>
		<figure style="margin:0;text-align:center"><img src="<?php echo esc_url(flc_file_url($post->ID, 'preview_lit')); ?>" style="width:320px;max-width:100%" alt=""><figcaption>Accesa (simulata)</figcaption></figure>
	</div>
	<h3>Cliente</h3>
	<p><strong><?php echo esc_html($c['name'] ?? ''); ?></strong> – <a href="mailto:<?php echo esc_attr($c['email'] ?? ''); ?>"><?php echo esc_html($c['email'] ?? ''); ?></a>
		<?php echo !empty($c['phone']) ? ' – ' . esc_html($c['phone']) : ''; ?></p>
	<?php if (!empty($c['note'])) : ?><p><em><?php echo nl2br(esc_html($c['note'])); ?></em></p><?php endif; ?>
	<?php $tpl = get_post_meta($post->ID, '_flc_template', true); ?>
	<?php if ($tpl) : ?>
		<p style="font-size:14px"><strong>Disegno pronto:</strong> <?php echo esc_html($tpl['name'] ?? ''); ?>
			<?php if (!empty($tpl['id']) && get_post_type($tpl['id']) === 'flc_template') : ?> – <a href="<?php echo esc_url(get_edit_post_link($tpl['id'])); ?>">apri il disegno</a><?php endif; ?></p>
		<p class="description">Il cliente ha scelto un disegno della galleria senza modificarlo: usa i tuoi file di quel disegno.</p>
	<?php endif; ?>
	<?php if ($texts && !$tpl) : ?><p>Scritte sulla banda: <?php echo esc_html(implode(' · ', $texts)); ?></p><?php endif; ?>
	<?php $lamp = (array) get_post_meta($post->ID, '_flc_lamp', true); ?>
	<?php if ($lamp) : ?>
		<h3>Pezzi della lampada</h3>
		<table class="widefat striped" style="max-width:760px;margin-bottom:12px">
			<thead><tr><th style="width:40px"></th><th>Pezzo</th><th>Colore</th><th>Bobina</th></tr></thead>
			<tbody>
			<?php foreach ($lamp as $l) : ?>
				<tr><td><span style="width:22px;height:22px;border-radius:50%;background:<?php echo esc_attr($l['colore']); ?>;border:1px solid #c3c4c7;display:inline-block"></span></td>
					<td><?php echo esc_html($l['parte']); ?><?php echo !empty($l['cliente']) ? ' <strong>(scelto dal cliente)</strong>' : ''; ?></td>
					<td><code><?php echo esc_html(strtoupper($l['colore'])); ?></code></td>
					<td><?php echo esc_html($l['filamento'] ?: '–'); ?></td></tr>
			<?php endforeach; ?>
			</tbody>
		</table>
	<?php endif; ?>
	<?php if (!$colors) { return; } ?>
	<h3>Filamenti da usare (<?php echo count($colors); ?>)</h3>
	<table class="widefat striped" style="max-width:760px">
		<thead><tr><th style="width:40px"></th><th>Colore</th><th>Bobina</th><th>Usato per</th><th>Area nel disegno</th></tr></thead>
		<tbody>
		<?php foreach ($colors as $col) : ?>
			<tr>
				<td><span style="width:22px;height:22px;border-radius:50%;background:<?php echo esc_attr($col['hex']); ?>;border:1px solid #c3c4c7;display:inline-block"></span></td>
				<td><code><?php echo esc_html(strtoupper($col['hex'])); ?></code></td>
				<td><?php echo $col['filament'] ? esc_html($col['filament']) : '<span class="description">nessun catalogo</span>'; ?></td>
				<td><?php echo esc_html(implode(', ', (array) $col['roles'])); ?></td>
				<td><?php echo $col['area'] ? (int) $col['area'] . ' mm²' : '–'; ?></td>
			</tr>
		<?php endforeach; ?>
		</tbody>
	</table>
	<?php
}

function flc_stato_box($post) {
	$stato = get_post_meta($post->ID, '_flc_stato', true) ?: 'nuovo';
	$size  = (int) get_post_meta($post->ID, '_flc_zip_size', true);
	wp_nonce_field('flc_stato_' . $post->ID, 'flc_stato_nonce');
	?>
	<p><strong>Codice:</strong> <?php echo esc_html(get_post_meta($post->ID, '_flc_code', true)); ?></p>
	<p><label for="flc_stato"><strong>Stato</strong></label><br>
		<select name="flc_stato" id="flc_stato" style="width:100%">
			<?php foreach (FLC_STATI as $k => $label) : ?>
				<option value="<?php echo esc_attr($k); ?>" <?php selected($stato, $k); ?>><?php echo esc_html($label); ?></option>
			<?php endforeach; ?>
		</select></p>
	<p><label><input type="checkbox" name="flc_mine" value="1" <?php checked(flc_design_is_mine($post->ID)); ?>> 👤 Progetto mio (non di un cliente)</label></p>
	<p><a class="button button-primary" style="width:100%;text-align:center" href="<?php echo esc_url(flc_file_url($post->ID, 'zip')); ?>">Scarica zip completo</a>
		<?php if ($size) : ?><br><span class="description"><?php echo esc_html(size_format($size, 1)); ?> – anteprime, originale, ridisegno IA, SVG/EPS, STL, lista filamenti</span><?php endif; ?></p>
	<?php if (flc_design_has_francy($post->ID)) : ?>
		<p><a class="button" style="width:100%;text-align:center" href="<?php echo esc_url(flc_design_open_url($post->ID)); ?>" target="_blank">✏️ Apri nel configuratore</a></p>
		<p><a class="button" style="width:100%;text-align:center" href="<?php echo esc_url(add_query_arg('flc_mk', 1, flc_design_open_url($post->ID))); ?>" target="_blank">📌 Converti in template</a><br>
			<span class="description">Riapre il progetto del cliente com'era (immagine, colori, scritte…) per modificarlo; da lì puoi anche crearne un template. <a href="<?php echo esc_url(flc_file_url($post->ID, 'francy')); ?>">Scarica il .francy</a></span></p>
	<?php endif; ?>
	<p class="description">Premi "Aggiorna" per salvare stato e gruppo.</p>
	<?php
}

add_action('save_post_flc_design', function ($post_id) {
	if (!isset($_POST['flc_stato_nonce']) || !wp_verify_nonce($_POST['flc_stato_nonce'], 'flc_stato_' . $post_id) || !current_user_can('manage_options')) {
		return;
	}
	$stato = sanitize_key($_POST['flc_stato'] ?? '');
	if (isset(FLC_STATI[$stato])) {
		update_post_meta($post_id, '_flc_stato', $stato);
	}
	update_post_meta($post_id, '_flc_mine', empty($_POST['flc_mine']) ? 0 : 1);
});

// ---------- nomi veri delle bobine nei file del cliente ----------
// Ai clienti il catalogo arriva senza marche: ogni bobina ha un codice neutro (es. FLCD12Q). Qui lo sostituiamo
// con il nome vero nei dati del progetto e dentro lo zip (nomi dei file STL, LEGGIMI, riepilogo, SVG, progetto 3MF).
function flc_resolve_tokens_deep($v, $map) {
	if (!$map) {
		return $v;
	}
	if (is_array($v)) {
		foreach ($v as $k => $x) {
			$v[$k] = flc_resolve_tokens_deep($x, $map);
		}
		return $v;
	}
	return is_string($v) && strpos($v, 'FLC') !== false ? strtr($v, $map) : $v;
}

// stesso "slug" usato dal configuratore per i nomi dei file
function flc_file_slug($s) {
	$s = function_exists('remove_accents') ? remove_accents($s) : $s;
	return substr(trim(preg_replace('/[^A-Za-z0-9]+/', '_', $s), '_'), 0, 40);
}

function flc_resolve_zip_tokens($path, $map) {
	if (!$map || !class_exists('ZipArchive')) {
		return false;
	}
	$zip = new ZipArchive();
	if ($zip->open($path) !== true) {
		return false;
	}
	$slugs   = array_map('flc_file_slug', $map);
	$updates = array();
	$renames = array();
	for ($i = 0; $i < $zip->numFiles; $i++) {
		$name = $zip->getNameIndex($i);
		$ext  = strtolower(pathinfo($name, PATHINFO_EXTENSION));
		if (in_array($ext, array('txt', 'json', 'svg'), true)) {
			$data = $zip->getFromIndex($i);
			if (preg_match('/FLC[DS]\d+Q/', $data)) {
				$updates[$name] = strtr($data, $map);
			}
		} elseif ($ext === '3mf') {
			$new = flc_resolve_3mf_tokens($zip->getFromIndex($i), $map);
			if ($new !== null) {
				$updates[$name] = $new;
			}
		}
		if (preg_match('/FLC[DS]\d+Q/', $name)) {
			$renames[$name] = strtr($name, $slugs);
		}
	}
	foreach ($updates as $name => $data) {
		$zip->deleteName($name);
		$zip->addFromString($name, $data);
	}
	foreach ($renames as $old => $new) {
		$idx = $zip->locateName($old);
		if ($idx !== false) {
			$zip->renameIndex($idx, $new);
		}
	}
	return $zip->close();
}

// il progetto Bambu (.3mf) è uno zip dentro lo zip: nomi delle parti nei file di configurazione
function flc_resolve_3mf_tokens($bin, $map) {
	if (!is_string($bin) || strpos($bin, "PK\x03\x04") !== 0) {
		return null; // non è uno zip
	}
	// wp_tempnam sta in wp-admin/includes/file.php, che nelle richieste REST (convalida) non è caricato
	if (!function_exists('wp_tempnam') && defined('ABSPATH') && is_file(ABSPATH . 'wp-admin/includes/file.php')) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	$tmp = function_exists('wp_tempnam') ? wp_tempnam('flc3mf') : tempnam(sys_get_temp_dir(), 'flc3mf');
	file_put_contents($tmp, $bin);
	$zip = new ZipArchive();
	if ($zip->open($tmp) !== true) {
		@unlink($tmp);
		return null;
	}
	$changed = false;
	$updates = array();
	for ($i = 0; $i < $zip->numFiles; $i++) {
		$name = $zip->getNameIndex($i);
		if (!preg_match('/\.(config|model|json|xml)$/i', $name)) {
			continue;
		}
		$data = $zip->getFromIndex($i);
		if (preg_match('/FLC[DS]\d+Q/', $data)) {
			$updates[$name] = strtr($data, array_map(function ($n) { return htmlspecialchars($n, ENT_QUOTES | ENT_XML1); }, $map));
		}
	}
	foreach ($updates as $name => $data) {
		$zip->deleteName($name);
		$zip->addFromString($name, $data);
		$changed = true;
	}
	$zip->close();
	$out = $changed ? file_get_contents($tmp) : null;
	@unlink($tmp);
	return $out;
}


// Configuratore aperto da "✏️ Apri nel configuratore" su un progetto del cliente (?flc_prj=ID): indirizzo del suo .francy
function flc_design_open_for_admin() {
	$id = absint($_GET['flc_prj'] ?? 0);
	if (!$id || !current_user_can('manage_options') || get_post_type($id) !== 'flc_design' || !flc_design_has_francy($id)) {
		return null;
	}
	return array('id' => $id, 'code' => get_post_meta($id, '_flc_code', true) ?: ('progetto-' . $id), 'url' => flc_file_url($id, 'francy'), 'makeTemplate' => !empty($_GET['flc_mk']));
}
