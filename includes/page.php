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
		'examples'  => function_exists('flc_examples_for_frontend') ? flc_examples_for_frontend() : null,
		'aiStyles'  => array_values(array_filter(array('fedele', 'ritratto', !empty($s['style_anime']) ? 'anime' : ''))),
		'aiBackgrounds' => !empty($s['bg_enabled']) ? array_column(flc_backgrounds($s), 'label') : array(),
		'privacyUrl' => esc_url_raw($s['privacy_url']),
		'cookieUrl'  => esc_url_raw($s['cookie_url'] ?: $s['privacy_url']),
		'copyrightName' => $s['copyright_name'],
		'stageBg'   => $s['stage_bg'],
		'lamp'      => function_exists('flc_parts_for_frontend') ? flc_parts_for_frontend() : null,
		'watermark' => array(
			'screen'   => (bool) $s['wm_screen'],
			'download' => (bool) $s['wm_download'],
			'image'    => esc_url_raw($s['wm_image']),
			'text'     => $s['wm_text'] ?: $s['copyright_name'],
			'color'    => $s['wm_color'],
			'tint'     => (bool) $s['wm_tint'],
			'opacity'  => $s['wm_opacity'] / 100,
			'size'     => $s['wm_size'] / 100,
			'angle'    => (int) $s['wm_angle'],
			'max'      => (int) $s['dl_max'],
		),
		'defaults'  => array(
			'band'      => $s['def_band'],
			'textColor' => $s['def_text_color'],
			'texts'     => array('tl' => $s['def_tl'], 'tr' => $s['def_tr'], 'bl' => $s['def_bl'], 'br' => $s['def_br']),
			'sliders'   => array(
				'mode' => $s['sl_mode'], 'colors' => $s['sl_colors'], 'line' => $s['sl_line'], 'addOutlines' => (bool) $s['sl_add'],
				'thick' => $s['sl_thick'], 'smooth' => $s['sl_smooth'], 'feat' => $s['sl_feat'], 'area' => $s['sl_area'], 'ppmm' => $s['sl_ppmm'],
			),
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
	// regole da rigenerare: dopo un cambio di indirizzo, oppure se plugin/indirizzo sono cambiati da
	// quando le abbiamo generate l'ultima volta (es. aggiornamento con "sostituisci la versione corrente")
	$sig = FLC_VERSION . '|' . flc_page_slug() . '|' . (int) !empty($s['page_enabled']);
	if (get_option('flc_flush_rules') || get_option('flc_rules_sig') !== $sig) {
		delete_option('flc_flush_rules');
		update_option('flc_rules_sig', $sig, false);
		flush_rewrite_rules(false);
	}
});

// Riconosce l'indirizzo anche se le regole di WordPress non sono aggiornate (niente 404)
add_action('parse_request', function ($wp) {
	$s = flc_settings();
	if (!empty($s['page_enabled']) && trim((string) $wp->request, '/') === flc_page_slug()) {
		$wp->query_vars = array('flc_page' => 1);
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
		/* computer: la pagina è esattamente alta come lo schermo e non scorre (scorrono solo i pannelli) */
		@media (min-width: 981px) {
			html.flc-page, html.flc-page body { overflow: hidden !important; overflow: clip !important; }
			html.flc-page body > .flc { overflow: hidden; overflow: clip; } /* clip: niente scorrimenti automatici del browser (focus) */
			<?php if (is_admin_bar_showing()) : ?>html.flc-page { margin-top: 0 !important; } html.flc-page body { padding-top: 32px !important; box-sizing: border-box; }
			html.flc-page body > .flc { height: calc(100vh - 32px); height: calc(100dvh - 32px); }<?php endif; ?>
		}
		/* blocchi che il tema aggiunge in fondo alla pagina (spazio vuoto sotto il footer) */
		html.flc-page body > .flc-stray { display: none !important; }
		/* telefono e tablet: la pagina scorre normalmente, il footer resta in fondo */
		@media (max-width: 980px) { html.flc-page body > .flc { height: auto; min-height: 100dvh; } }
	</style>
</head>
<body class="flc-standalone">
	<script>window.FRANCY_LAMP = <?php echo wp_json_encode(flc_frontend_config()); ?>;</script>
	<?php echo $markup; // markup statico del plugin ?>
	<script type="module" src="<?php echo esc_url($app . '?ver=' . flc_asset_ver('assets/js/app.js')); ?>"></script>
	<?php if (!empty($s['page_wp_head'])) { wp_footer(); } ?>
	<script>
	// Il tema può aggiungere in fondo alla pagina contenitori vuoti o nascosti che allungano la pagina:
	// nascondo quelli "normali" dopo il configuratore. Restano attivi script, barra admin e gli elementi
	// fissi o sovrapposti (banner cookie, chat, pulsanti flottanti).
	(function () {
		function tidy() {
			var app = document.querySelector('body > .flc');
			if (!app) return;
			for (var el = app.nextElementSibling; el; el = el.nextElementSibling) {
				if (/^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE|IFRAME)$/.test(el.tagName) || el.id === 'wpadminbar') continue;
				var pos = getComputedStyle(el).position;
				if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') continue;
				el.classList.add('flc-stray');
			}
		}
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tidy); else tidy();
		window.addEventListener('load', tidy);
		// anche quello che il tema o altri script aggiungono dopo (es. al primo clic)
		new MutationObserver(tidy).observe(document.body, { childList: true });
	})();
	</script>
</body>
</html>
	<?php
	exit;
});
