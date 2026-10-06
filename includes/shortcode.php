<?php
// Shortcode [francy_lamp]: inserisce il configuratore in una pagina del tema (stesso markup di assets/index.html).
// Di solito è meglio la pagina dedicata a schermo intero (vedi page.php).

if (!defined('ABSPATH')) {
	exit;
}

add_shortcode('francy_lamp', 'flc_shortcode');

// $embedded: dentro una pagina del tema (shortcode) oppure pagina dedicata a schermo intero
function flc_markup($embedded = true) {
	$html = file_get_contents(FLC_DIR . 'assets/index.html');
	$a    = strpos($html, '<!-- FLC:START -->');
	$b    = strpos($html, '<!-- FLC:END -->');
	if ($a === false || $b === false) {
		return '';
	}
	$html = substr($html, $a, $b - $a);
	return $embedded ? str_replace('class="flc"', 'class="flc flc-embedded"', $html) : $html;
}

function flc_shortcode() {
	wp_enqueue_style('francy-lamp', FLC_URL . 'assets/css/style.css', array(), flc_asset_ver('assets/css/style.css'));
	$out  = '<script>window.FRANCY_LAMP = ' . wp_json_encode(flc_frontend_config()) . ';</script>';
	$out .= flc_markup();
	// Modulo ES caricato direttamente: worker, font e three.js vengono risolti relativi a questo file
	$out .= '<script type="module" src="' . esc_url(FLC_URL . 'assets/js/app.js?ver=' . flc_asset_ver('assets/js/app.js')) . '"></script>';
	return $out;
}
