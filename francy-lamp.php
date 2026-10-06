<?php
/**
 * Plugin Name: Francy Lamp – Configuratore lampade
 * Description: Configuratore delle lampade "tombino" FrancyStore3D con ridisegno IA (Gemini, fal.ai). Shortcode: [francy_lamp]
 * Version: 0.2.0
 * Author: FrancyStore3D
 * Requires at least: 6.3
 * Requires PHP: 7.4
 * License: GPLv2 or later
 * Text Domain: francy-lamp
 */

if (!defined('ABSPATH')) {
	exit;
}

define('FLC_VERSION', '0.2.0');
define('FLC_DIR', plugin_dir_path(__FILE__));
define('FLC_URL', plugin_dir_url(__FILE__));

require_once FLC_DIR . 'includes/settings.php';
require_once FLC_DIR . 'includes/providers.php';
require_once FLC_DIR . 'includes/rest.php';
require_once FLC_DIR . 'includes/shortcode.php';
