<?php
// Shortcode [francy_lamp]: inserisce il configuratore (stesso markup di assets/index.html).

if (!defined('ABSPATH')) {
	exit;
}

add_shortcode('francy_lamp', 'flc_shortcode');

function flc_markup() {
	$html = file_get_contents(FLC_DIR . 'assets/index.html');
	$a    = strpos($html, '<!-- FLC:START -->');
	$b    = strpos($html, '<!-- FLC:END -->');
	if ($a === false || $b === false) {
		return '';
	}
	$html = substr($html, $a, $b - $a);
	return str_replace('class="flc"', 'class="flc flc-embedded"', $html);
}

function flc_shortcode() {
	$s = flc_settings();
	wp_enqueue_style('francy-lamp', FLC_URL . 'assets/css/style.css', array(), FLC_VERSION);

	$config = array(
		'restUrl' => (!empty($s['enabled']) && (!empty($s['gemini_key']) || !empty($s['fal_key'])))
			? esc_url_raw(rest_url('francy-lamp/v1/ridisegna')) : '',
		'statusUrl' => esc_url_raw(rest_url('francy-lamp/v1/stato')),
		'nonce'   => wp_create_nonce('wp_rest'),
	);

	$out  = '<script>window.FRANCY_LAMP = ' . wp_json_encode($config) . ';</script>';
	$out .= flc_markup();
	// Modulo ES caricato direttamente: worker, font e three.js vengono risolti relativi a questo file
	$out .= '<script type="module" src="' . esc_url(FLC_URL . 'assets/js/app.js?ver=' . FLC_VERSION) . '"></script>';
	return $out;
}
