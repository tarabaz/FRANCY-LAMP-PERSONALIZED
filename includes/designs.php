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
);

function flc_file_url($post_id, $which) {
	return wp_nonce_url(admin_url('admin-post.php?action=flc_file&id=' . (int) $post_id . '&f=' . $which), 'flc_file_' . (int) $post_id);
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
	$name = $f === 'zip' ? sanitize_file_name($code . '.zip') : sanitize_file_name($code . '-' . $file);
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
			echo esc_html($c['name'] ?? '') . '<br><a href="mailto:' . esc_attr($c['email'] ?? '') . '">' . esc_html($c['email'] ?? '') . '</a>';
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
	if (is_admin() && $q->is_main_query() && $q->get('post_type') === 'flc_design' && !empty($_GET['flc_stato'])) {
		$q->set('meta_key', '_flc_stato');
		$q->set('meta_value', sanitize_key($_GET['flc_stato']));
	}
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
	<p><a class="button button-primary" style="width:100%;text-align:center" href="<?php echo esc_url(flc_file_url($post->ID, 'zip')); ?>">Scarica zip completo</a>
		<?php if ($size) : ?><br><span class="description"><?php echo esc_html(size_format($size, 1)); ?> – anteprime, originale, ridisegno IA, SVG/EPS, STL, lista filamenti</span><?php endif; ?></p>
	<p class="description">Premi "Aggiorna" per salvare lo stato.</p>
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
	$tmp = wp_tempnam('flc3mf');
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

