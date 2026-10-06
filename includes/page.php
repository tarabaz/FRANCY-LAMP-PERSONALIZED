<?php
// Pagina dedicata a schermo intero (es. tuosito.it/lampade-personalizzate/), senza il tema intorno.
// L'indirizzo si sceglie in Impostazioni. Ogni file JS viene caricato con la sua versione (importmap),
// così dopo un aggiornamento del plugin il browser non usa file vecchi dalla cache.

if (!defined('ABSPATH')) {
	exit;
}

// configurazione passata al configuratore (pagina dedicata e shortcode)
function flc_frontend_config() {
	$s = flc_settings();
	return array(
		'restUrl'   => (!empty($s['enabled']) && (!empty($s['gemini_key']) || !empty($s['fal_key'])))
			? esc_url_raw(rest_url('francy-lamp/v1/ridisegna')) : '',
		'statusUrl' => esc_url_raw(rest_url('francy-lamp/v1/stato')),
		'submitUrl' => esc_url_raw(rest_url('francy-lamp/v1/convalida')),
		'nonce'     => wp_create_nonce('wp_rest'),
		// i download diretti dei file restano solo agli amministratori
		'isAdmin'   => current_user_can('manage_options'),
		'filaments' => flc_filaments(),
		'templates' => flc_templates_for_frontend(),
		'homeUrl'   => home_url('/'),
		'privacyUrl' => esc_url_raw($s['privacy_url']),
		'cookieUrl'  => esc_url_raw($s['cookie_url'] ?: $s['privacy_url']),
		'copyrightName' => $s['copyright_name'],
		'defaults'  => array(
			'band'      => $s['def_band'],
			'textColor' => $s['def_text_color'],
			'texts'     => array('tl' => $s['def_tl'], 'tr' => $s['def_tr'], 'bl' => $s['def_bl'], 'br' => $s['def_br']),
		),
		'siteName'  => get_bloginfo('name'),
		// logo del sito impostato in Aspetto → Personalizza (se c'è)
		'logoUrl'   => ($logo = get_theme_mod('custom_logo')) ? (string) wp_get_attachment_image_url($logo, 'medium') : '',
	);
}

// versione di un file = versione plugin + data di modifica (cambia da sola a ogni aggiornamento)
function flc_asset_ver($rel) {
	$path = FLC_DIR . $rel;
	return FLC_VERSION . '-' . (is_file($path) ? filemtime($path) : '0');
}

// importmap: ogni modulo JS viene richiesto con ?ver=..., anche quelli importati da altri moduli
function flc_importmap() {
	$map = array();
	foreach (array_merge(glob(FLC_DIR . 'assets/js/*.js'), glob(FLC_DIR . 'assets/vendor/three/*.js'), glob(FLC_DIR . 'assets/vendor/three/addons/*.js'), glob(FLC_DIR . 'assets/vendor/*.mjs')) as $file) {
		$rel = ltrim(str_replace(FLC_DIR, '', $file), '/');
		if (basename($rel) === 'worker.js') {
			continue; // il worker non passa dall'importmap: riceve la versione da app.js
		}
		$map[FLC_URL . $rel] = FLC_URL . $rel . '?ver=' . flc_asset_ver($rel);
	}
	return wp_json_encode(array('imports' => $map), JSON_UNESCAPED_SLASHES);
}

function flc_page_slug() {
	$s = flc_settings();
	return trim(sanitize_title($s['page_slug'] ?: 'lampade-personalizzate'), '/');
}

add_action('init', function () {
	$s = flc_settings();
	if (!empty($s['page_enabled'])) {
		add_rewrite_rule('^' . preg_quote(flc_page_slug(), '#') . '/?$', 'index.php?flc_page=1', 'top');
	}
	// dopo un cambio di indirizzo le regole vanno rigenerate una volta
	if (get_option('flc_flush_rules')) {
		delete_option('flc_flush_rules');
		flush_rewrite_rules(false);
	}
});
add_filter('query_vars', function ($vars) {
	$vars[] = 'flc_page';
	return $vars;
});
add_action('update_option_' . FLC_OPTION, function ($old, $new) {
	if (($old['page_slug'] ?? '') !== ($new['page_slug'] ?? '') || ($old['page_enabled'] ?? 1) !== ($new['page_enabled'] ?? 1)) {
		update_option('flc_flush_rules', 1);
	}
}, 10, 2);

function flc_page_url() {
	return home_url('/' . flc_page_slug() . '/');
}

add_action('template_redirect', function () {
	if (!get_query_var('flc_page')) {
		return;
	}
	$s = flc_settings();
	if (empty($s['page_enabled'])) {
		return;
	}
	nocache_headers(); // contiene il nonce per le richieste: niente cache della pagina
	status_header(200);
	$title  = $s['page_title'] ?: 'Lampade personalizzate';
	$markup = flc_markup(false);
	$css    = FLC_URL . 'assets/css/style.css?ver=' . flc_asset_ver('assets/css/style.css');
	$app    = FLC_URL . 'assets/js/app.js';
	?>
<!doctype html>
<html <?php language_attributes(); ?> class="flc-page">
<head>
	<meta charset="<?php bloginfo('charset'); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title><?php echo esc_html($title); ?></title>
	<?php if ($s['page_description']) : ?><meta name="description" content="<?php echo esc_attr($s['page_description']); ?>"><?php endif; ?>
	<link rel="canonical" href="<?php echo esc_url(flc_page_url()); ?>">
	<script type="importmap"><?php echo flc_importmap(); ?></script>
	<link rel="stylesheet" href="<?php echo esc_url($css); ?>">
	<?php if (!empty($s['page_wp_head'])) { wp_head(); } elseif (get_site_icon_url()) { echo '<link rel="icon" href="' . esc_url(get_site_icon_url(64)) . '">'; } ?>
	<style>
		html.flc-page, html.flc-page body { margin: 0 !important; padding: 0 !important; height: 100%; background: #f4f2ee; }
		html.flc-page body > .flc { height: 100vh; height: 100dvh; }
		/* telefono e tablet: la pagina scorre normalmente, il footer resta in fondo */
		@media (max-width: 980px) { html.flc-page body > .flc { height: auto; min-height: 100dvh; } }
	</style>
</head>
<body class="flc-standalone">
	<script>window.FRANCY_LAMP = <?php echo wp_json_encode(flc_frontend_config()); ?>;</script>
	<?php echo $markup; // markup statico del plugin ?>
	<script type="module" src="<?php echo esc_url($app . '?ver=' . flc_asset_ver('assets/js/app.js')); ?>"></script>
	<?php if (!empty($s['page_wp_head'])) { wp_footer(); } ?>
</body>
</html>
	<?php
	exit;
});
