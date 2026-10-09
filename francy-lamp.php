<?php
/**
 * Plugin Name: Francy Lamp Factory
 * Description: Configuratore delle lampade "tombino" FrancyStore3D: ridisegno IA, convalida dei clienti, archivio progetti con zip (SVG/EPS/STL), catalogo filamenti. Shortcode: [francy_lamp]
 * Version: 0.55.2
 * Author: FrancyStore3D
 * Requires at least: 6.3
 * Requires PHP: 7.4
 * License: GPLv2 or later
 * Text Domain: francy-lamp
 */

if (!defined('ABSPATH')) {
	exit;
}

define('FLC_VERSION', '0.55.2');
define('FLC_DIR', plugin_dir_path(__FILE__));
define('FLC_URL', plugin_dir_url(__FILE__));

require_once FLC_DIR . 'includes/settings.php';
require_once FLC_DIR . 'includes/access.php';
require_once FLC_DIR . 'includes/providers.php';
require_once FLC_DIR . 'includes/rest.php';
require_once FLC_DIR . 'includes/shortcode.php';
require_once FLC_DIR . 'includes/filaments.php';
require_once FLC_DIR . 'includes/designs.php';
require_once FLC_DIR . 'includes/templates.php';
require_once FLC_DIR . 'includes/page.php';
require_once FLC_DIR . 'includes/examples.php';
require_once FLC_DIR . 'includes/parts.php';
require_once FLC_DIR . 'includes/backgrounds.php';

// all'attivazione rigenera gli indirizzi (pagina dedicata)
register_activation_hook(__FILE__, function () {
	update_option('flc_flush_rules', 1);
});
