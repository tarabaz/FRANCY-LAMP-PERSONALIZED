<?php
// Disegni pronti: PNG del disco frontale completo caricati dall'admin.
// Nel configuratore il cliente li vede in una galleria, li applica al modello per l'anteprima
// e può convalidarli; non si modificano. Si mostrano solo se attivi nelle impostazioni.

if (!defined('ABSPATH')) {
	exit;
}

add_action('init', function () {
	register_post_type('flc_template', array(
		'labels'       => array(
			'name'                  => 'Disegni pronti',
			'singular_name'         => 'Disegno pronto',
			'menu_name'             => 'Disegni pronti',
			'all_items'             => 'Disegni pronti',
			'add_new'               => 'Aggiungi disegno',
			'add_new_item'          => 'Nuovo disegno pronto',
			'edit_item'             => 'Modifica disegno pronto',
			'not_found'             => 'Nessun disegno pronto. Aggiungine uno con l\'immagine PNG del disco.',
			'featured_image'        => 'Immagine del disco (PNG)',
			'set_featured_image'    => 'Scegli l\'immagine del disco',
			'remove_featured_image' => 'Rimuovi immagine',
			'use_featured_image'    => 'Usa come immagine del disco',
		),
		'public'       => false,
		'show_ui'      => true,
		'show_in_menu' => 'edit.php?post_type=flc_design',
		'supports'     => array('title', 'thumbnail', 'page-attributes'),
		'map_meta_cap' => false,
		'capabilities' => array(
			'edit_post'          => 'manage_options',
			'read_post'          => 'manage_options',
			'delete_post'        => 'manage_options',
			'edit_posts'         => 'manage_options',
			'edit_others_posts'  => 'manage_options',
			'delete_posts'       => 'manage_options',
			'publish_posts'      => 'manage_options',
			'read_private_posts' => 'manage_options',
			'create_posts'       => 'manage_options',
		),
	));
});

// immagine in evidenza anche se il tema non la attiva per tutti i tipi di contenuto
add_action('after_setup_theme', function () {
	add_theme_support('post-thumbnails', array('flc_template'));
}, 20);

// istruzioni sopra il riquadro dell'immagine
add_action('edit_form_after_title', function ($post) {
	if ($post->post_type !== 'flc_template') {
		return;
	}
	echo '<div class="notice notice-info inline" style="margin:12px 0"><p><strong>Come preparare il PNG:</strong> immagine quadrata del disco frontale completo '
		. '(cornice compresa), disco Ø200 che riempie tutta l\'immagine, sfondo trasparente fuori dal disco. Consigliato 1200×1200 px o più. '
		. 'Caricalo da "Immagine del disco (PNG)" qui a destra. Pubblica per mostrarlo ai clienti, metti in bozza per nasconderlo; '
		. '"Ordine" decide la posizione nella galleria.</p></div>';
});

add_filter('manage_flc_template_posts_columns', function () {
	return array(
		'cb'           => '<input type="checkbox" />',
		'flc_tpl_img'  => 'Disegno',
		'title'        => 'Nome',
		'flc_tpl_ord'  => 'Ordine',
		'date'         => 'Data',
	);
});
add_action('manage_flc_template_posts_custom_column', function ($col, $post_id) {
	if ($col === 'flc_tpl_img') {
		$img = get_the_post_thumbnail_url($post_id, 'thumbnail');
		echo $img ? '<img src="' . esc_url($img) . '" alt="" style="width:72px;height:72px;object-fit:contain">' : '<span class="description">manca l\'immagine</span>';
	} elseif ($col === 'flc_tpl_ord') {
		echo (int) get_post_field('menu_order', $post_id);
	}
}, 10, 2);

// Lista per il configuratore: solo pubblicati, con immagine, se l'opzione è attiva
function flc_templates_for_frontend() {
	$s = flc_settings();
	if (empty($s['templates_enabled'])) {
		return array();
	}
	$out = array();
	foreach (get_posts(array(
		'post_type'      => 'flc_template',
		'post_status'    => 'publish',
		'posts_per_page' => 200,
		'orderby'        => array('menu_order' => 'ASC', 'title' => 'ASC'),
	)) as $p) {
		$id = get_post_thumbnail_id($p);
		if (!$id) {
			continue;
		}
		$full  = wp_get_attachment_image_url($id, 'full');
		$thumb = wp_get_attachment_image_url($id, 'medium') ?: $full;
		if ($full) {
			$out[] = array('id' => $p->ID, 'name' => get_the_title($p), 'url' => $full, 'thumb' => $thumb);
		}
	}
	return $out;
}
