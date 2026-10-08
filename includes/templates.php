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
		'flc_tpl_print' => 'Pronto da stampare',
		'flc_tpl_ord'  => 'Ordine',
		'date'         => 'Data',
	);
});
add_action('manage_flc_template_posts_custom_column', function ($col, $post_id) {
	if ($col === 'flc_tpl_img') {
		$ed  = flc_tpl_print($post_id);
		$img = $ed ? wp_get_attachment_image_url($ed['png'], 'thumbnail') : get_the_post_thumbnail_url($post_id, 'thumbnail');
		echo $img ? '<img src="' . esc_url($img) . '" alt="" style="width:72px;height:72px;object-fit:contain">' : '<span class="description">manca l\'immagine</span>';
	} elseif ($col === 'flc_tpl_print') {
		echo flc_tpl_print_links($post_id);
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
		// elaborato dall'admin (colori ritoccati): i clienti vedono quello, l'originale resta
		$ed = flc_tpl_print($p->ID);
		if ($ed && ($eu = wp_get_attachment_image_url($ed['png'], 'full'))) {
			$full  = $eu;
			$thumb = wp_get_attachment_image_url($ed['png'], 'medium') ?: $eu;
		}
		if ($full) {
			$t = array('id' => $p->ID, 'name' => get_the_title($p), 'url' => $full, 'thumb' => $thumb, 'ready' => (bool) $ed);
			// all'admin anche il progetto salvato: "Elabora questo disegno" riparte dalle sue modifiche
			if ($ed && !empty($ed['files']['francy']) && current_user_can('manage_options')) {
				$t['project'] = flc_tpl_file_url($p->ID, 'francy');
			}
			$out[] = $t;
		}
	}
	return $out;
}

// ---------- Importa in blocco: tante immagini o uno ZIP, il nome del file diventa il nome del disegno ----------
// Lo ZIP si apre nel browser e le immagini arrivano al sito una alla volta (niente limiti di upload dell'hosting).

add_action('admin_menu', function () {
	add_submenu_page('edit.php?post_type=flc_design', 'Importa disegni pronti', 'Importa disegni', 'manage_options', 'flc-importa-disegni', 'flc_templates_import_page');
}, 16);

// pulsante "Importa in blocco" accanto a "Aggiungi disegno" nell'elenco
add_action('admin_head-edit.php', function () {
	if (($_GET['post_type'] ?? '') !== 'flc_template') {
		return;
	}
	$url = esc_url(admin_url('edit.php?post_type=flc_design&page=flc-importa-disegni'));
	echo "<script>document.addEventListener('DOMContentLoaded',()=>{const a=document.querySelector('.wrap .page-title-action');if(a){const b=a.cloneNode();b.href='$url';b.textContent='Importa in blocco (immagini o ZIP)';a.after(b);}});</script>";
});

// nome dal file: senza cartelle ed estensione, _ e - diventano spazi
function flc_template_name_from_file($file) {
	$n = preg_replace('/\.[a-z0-9]+$/i', '', wp_basename(str_replace('\\', '/', (string) $file)));
	$n = trim(preg_replace('/\s+/', ' ', preg_replace('/[_\-]+/', ' ', $n)));
	return mb_substr(sanitize_text_field($n), 0, 120) ?: 'Disegno';
}

add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/disegni/importa', array(
		'methods'             => 'POST',
		'permission_callback' => function () { return current_user_can('manage_options'); },
		'callback'            => function (WP_REST_Request $req) {
			$files = $req->get_file_params();
			if (empty($files['image']['tmp_name'])) {
				return new WP_Error('flc_import', 'Nessuna immagine ricevuta.', array('status' => 400));
			}
			$f    = $files['image'];
			$info = @getimagesize($f['tmp_name']);
			if (!$info || !in_array($info['mime'], array('image/png', 'image/jpeg', 'image/webp'), true)) {
				return new WP_Error('flc_import', 'Formato non supportato (servono PNG, JPG o WEBP).', array('status' => 400));
			}
			$name = trim((string) $req->get_param('name'));
			$name = $name !== '' ? mb_substr(sanitize_text_field($name), 0, 120) : flc_template_name_from_file($f['name']);
			$dup  = $req->get_param('dup') === 'replace' ? 'replace' : 'skip';
			$existing = get_posts(array('post_type' => 'flc_template', 'title' => $name, 'post_status' => 'any', 'posts_per_page' => 1, 'fields' => 'ids'));
			if ($existing && $dup === 'skip') {
				return array('ok' => true, 'skipped' => true, 'id' => $existing[0], 'name' => $name);
			}
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
			if ($existing) {
				$post_id = $existing[0];
			} else {
				$max     = (int) $GLOBALS['wpdb']->get_var("SELECT MAX(menu_order) FROM {$GLOBALS['wpdb']->posts} WHERE post_type = 'flc_template'");
				$post_id = wp_insert_post(array(
					'post_type'   => 'flc_template',
					'post_title'  => $name,
					'post_status' => $req->get_param('status') === 'draft' ? 'draft' : 'publish',
					'menu_order'  => $max + 1,
				), true);
				if (is_wp_error($post_id)) {
					return new WP_Error('flc_import', $post_id->get_error_message(), array('status' => 500));
				}
			}
			$ext   = array('image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp')[$info['mime']];
			$att   = media_handle_sideload(array('name' => sanitize_file_name($name) . '.' . $ext, 'tmp_name' => $f['tmp_name']), $post_id, $name);
			if (is_wp_error($att)) {
				if (!$existing) {
					wp_delete_post($post_id, true);
				}
				return new WP_Error('flc_import', $att->get_error_message(), array('status' => 500));
			}
			set_post_thumbnail($post_id, $att);
			return array('ok' => true, 'id' => $post_id, 'name' => $name, 'replaced' => (bool) $existing);
		},
	));
});

function flc_templates_import_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	?>
	<style>
		.flc-imp { max-width: 1000px; }
		.flc-imp .drop { display: block; border: 2px dashed #8c8f94; border-radius: 12px; padding: 34px; text-align: center; background: #fff; cursor: pointer; margin: 14px 0; }
		.flc-imp .drop.over { border-color: #2271b1; background: #f0f6fc; }
		.flc-imp table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dcdcde; }
		.flc-imp td, .flc-imp th { padding: 6px 8px; border-bottom: 1px solid #f0f0f1; text-align: left; vertical-align: middle; }
		.flc-imp td img { width: 56px; height: 56px; object-fit: contain; background: #f6f7f7; border-radius: 6px; }
		.flc-imp td input[type=text] { width: 100%; }
		.flc-imp .st { white-space: nowrap; }
		.flc-imp .ok { color: #00a32a; } .flc-imp .skip { color: #8a5a00; } .flc-imp .err { color: #d63638; }
		.flc-imp .bar { height: 8px; background: #f0f0f1; border-radius: 4px; overflow: hidden; margin: 10px 0; }
		.flc-imp .bar div { height: 100%; width: 0; background: #2271b1; transition: width .2s; }
	</style>
	<div class="wrap flc-imp">
		<h1>Importa disegni pronti</h1>
		<p>Trascina qui <strong>più immagini</strong> (PNG, JPG, WEBP) e/o <strong>file ZIP</strong> che le contengono. Il <strong>nome del file</strong> diventa il nome del disegno
			(<code>gengar_e_pikachu.png</code> → "gengar e pikachu"); puoi correggerlo nell'elenco prima di importare. Le immagini vanno preparate come sempre: disco frontale completo, quadrato, sfondo trasparente fuori dal disco.</p>
		<label class="drop" id="flcDrop">Trascina qui immagini o ZIP, oppure <strong>clicca per sceglierli</strong>
			<input type="file" id="flcFiles" multiple accept=".png,.jpg,.jpeg,.webp,.zip,image/png,image/jpeg,image/webp,application/zip" hidden></label>
		<p>
			<label><input type="checkbox" id="flcPublish" checked> Pubblica subito (visibili ai clienti)</label> &nbsp;
			<label>Se esiste già un disegno con lo stesso nome: <select id="flcDup"><option value="skip">saltalo</option><option value="replace">sostituisci l'immagine</option></select></label>
		</p>
		<table id="flcList" hidden><thead><tr><th style="width:70px"></th><th>Nome del disegno</th><th style="width:140px">Stato</th><th style="width:30px"></th></tr></thead><tbody></tbody></table>
		<div class="bar" id="flcBar" hidden><div></div></div>
		<p><button type="button" class="button button-primary" id="flcGo" disabled>Importa</button> <span class="description" id="flcMsg"></span>
			<a class="button" href="<?php echo esc_url(admin_url('edit.php?post_type=flc_template')); ?>" style="margin-left:8px">Vai ai disegni pronti</a></p>
	</div>
	<script>
	(function () {
		const api = <?php echo wp_json_encode(rest_url('francy-lamp/v1/disegni/importa')); ?>, nonce = <?php echo wp_json_encode(wp_create_nonce('wp_rest')); ?>;
		const $ = (s) => document.querySelector(s);
		let items = []; // { name, blob, url, status }
		const nameOf = (f) => f.replace(/\\/g, '/').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Disegno';
		const isImg = (n) => /\.(png|jpe?g|webp)$/i.test(n);
		const mimeOf = (n) => (/\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : 'image/jpeg');
		// lettore ZIP minimo (directory centrale + deflate del browser)
		async function unzip(file) {
			const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
			let e = buf.length - 22;
			while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
			if (e < 0) throw new Error('ZIP non valido');
			let n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true);
			const out = [];
			for (let k = 0; k < n; k++) {
				if (dv.getUint32(p, true) !== 0x02014b50) break;
				const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true);
				const xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
				const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
				p += 46 + nlen + xlen + clen;
				if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name) || !isImg(name)) continue;
				const lo = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
				const raw = buf.subarray(lo, lo + csize);
				let data;
				if (method === 0) data = raw;
				else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
				else continue;
				out.push({ name, blob: new Blob([data], { type: mimeOf(name) }) });
			}
			return out;
		}
		async function addFiles(list) {
			$('#flcMsg').textContent = 'Leggo i file…';
			for (const f of list) {
				try {
					if (/\.zip$/i.test(f.name)) { for (const x of await unzip(f)) items.push({ name: nameOf(x.name), blob: x.blob }); }
					else if (isImg(f.name)) items.push({ name: nameOf(f.name), blob: f });
				} catch (err) { $('#flcMsg').textContent = f.name + ': ' + err.message; }
			}
			render();
		}
		function render() {
			const tb = $('#flcList tbody');
			tb.innerHTML = '';
			items.forEach((it, i) => {
				if (!it.url) it.url = URL.createObjectURL(it.blob);
				const tr = document.createElement('tr');
				tr.innerHTML = '<td><img alt=""></td><td><input type="text"></td><td class="st"></td><td><button type="button" class="button-link-delete" title="Togli">✕</button></td>';
				tr.querySelector('img').src = it.url;
				const inp = tr.querySelector('input'); inp.value = it.name; inp.addEventListener('input', () => { it.name = inp.value; });
				const st = tr.querySelector('.st'); st.textContent = it.status || 'da importare'; st.className = 'st ' + (it.cls || '');
				tr.querySelector('button').addEventListener('click', () => { items.splice(i, 1); render(); });
				tb.append(tr);
			});
			$('#flcList').hidden = !items.length;
			const todo = items.filter((x) => !x.done).length;
			$('#flcGo').disabled = !todo;
			$('#flcGo').textContent = todo ? 'Importa ' + todo + (todo === 1 ? ' disegno' : ' disegni') : 'Importa';
			$('#flcMsg').textContent = items.length ? items.length + ' immagini pronte' : '';
		}
		$('#flcFiles').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
		const drop = $('#flcDrop');
		drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
		drop.addEventListener('dragleave', () => drop.classList.remove('over'));
		drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
		$('#flcGo').addEventListener('click', async () => {
			const todo = items.filter((x) => !x.done);
			$('#flcGo').disabled = true; $('#flcBar').hidden = false;
			let k = 0, ok = 0, skip = 0, err = 0;
			for (const it of todo) {
				const fd = new FormData();
				fd.append('image', it.blob, (it.name || 'disegno') + (it.blob.type === 'image/png' ? '.png' : it.blob.type === 'image/webp' ? '.webp' : '.jpg'));
				fd.append('name', it.name);
				fd.append('status', $('#flcPublish').checked ? 'publish' : 'draft');
				fd.append('dup', $('#flcDup').value);
				try {
					const r = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': nonce }, body: fd });
					const j = await r.json().catch(() => ({}));
					if (!r.ok) throw new Error(j.message || 'HTTP ' + r.status);
					it.done = true;
					if (j.skipped) { it.status = 'già presente, saltato'; it.cls = 'skip'; skip++; }
					else { it.status = j.replaced ? '✓ immagine sostituita' : '✓ importato'; it.cls = 'ok'; ok++; }
				} catch (e) { it.status = 'errore: ' + e.message; it.cls = 'err'; err++; }
				k++;
				$('#flcBar div').style.width = (k / todo.length * 100) + '%';
				render();
			}
			$('#flcMsg').textContent = `Fatto: ${ok} importati` + (skip ? `, ${skip} saltati` : '') + (err ? `, ${err} con errore` : '') + '.';
		});
	})();
	</script>
	<?php
}

// ---------- Disegno pronto elaborato dall'admin: file di stampa + immagine con i colori ritoccati ----------
// Dal configuratore ("⚙️ Elabora questo disegno" → "💾 Salva nel disegno pronto") arrivano PNG, SVG, EPS, 3MF e il
// progetto .francy. Il PNG diventa un allegato (lo vedono i clienti al posto dell'originale, che resta l'immagine in
// evidenza); gli altri file vanno nella cartella protetta e si scaricano solo da admin.

const FLC_TPL_FILES = array(
	'eps'    => array('disco.eps', 'application/postscript'),
	'3mf'    => array('disco-lampada.3mf', 'model/3mf'),
	'svg'    => array('disco.svg', 'image/svg+xml'),
	'francy' => array('progetto.francy', 'application/octet-stream'),
);

// dati dell'elaborazione o null: { png: id allegato, dir, files: { eps: true… }, time }
function flc_tpl_print($post_id) {
	$m = get_post_meta($post_id, '_flc_tpl_print', true);
	return is_array($m) && !empty($m['png']) && get_post($m['png']) ? $m : null;
}

function flc_tpl_dir($post_id, $create = false) {
	$m   = get_post_meta($post_id, '_flc_tpl_print', true);
	$dir = is_array($m) && !empty($m['dir']) && preg_match('/^[a-f0-9-]{36}$/', $m['dir']) ? $m['dir'] : '';
	if (!$dir) {
		if (!$create) {
			return '';
		}
		$dir = wp_generate_uuid4();
	}
	$path = flc_storage_base() . '/disegni/' . $dir;
	if ($create && !is_dir($path)) {
		wp_mkdir_p($path);
	}
	return $path;
}

function flc_tpl_file_url($post_id, $which) {
	return wp_nonce_url(admin_url('admin-post.php?action=flc_tpl_file&id=' . (int) $post_id . '&f=' . $which), 'flc_tpl_file_' . (int) $post_id);
}

function flc_tpl_print_links($post_id) {
	$ed = flc_tpl_print($post_id);
	if (!$ed) {
		return '<span class="description">non ancora: apri il disegno nel configuratore, ⚙️ Elabora e 💾 Salva</span>';
	}
	$links = array();
	foreach (array('3mf' => '3MF', 'eps' => 'EPS', 'svg' => 'SVG', 'francy' => 'Progetto') as $k => $label) {
		if (!empty($ed['files'][$k])) {
			$links[] = '<a href="' . esc_url(flc_tpl_file_url($post_id, $k)) . '">' . $label . '</a>';
		}
	}
	$png = wp_get_attachment_url($ed['png']);
	if ($png) {
		$links[] = '<a href="' . esc_url($png) . '" target="_blank">PNG</a>';
	}
	return '<strong style="color:#00a32a">✓ Pronto</strong> <span class="description">' . esc_html(wp_date('d/m/Y H:i', (int) $ed['time'])) . '</span><br>' . implode(' · ', $links);
}

add_action('admin_post_flc_tpl_file', function () {
	$id = absint($_GET['id'] ?? 0);
	$f  = sanitize_key($_GET['f'] ?? '');
	if (!current_user_can('manage_options') || !wp_verify_nonce($_GET['_wpnonce'] ?? '', 'flc_tpl_file_' . $id)) {
		wp_die('Non autorizzato.', 403);
	}
	$dir = flc_tpl_dir($id);
	if (!$dir || !isset(FLC_TPL_FILES[$f]) || !is_file($dir . '/' . FLC_TPL_FILES[$f][0])) {
		wp_die('File non trovato.', 404);
	}
	list($file, $type) = FLC_TPL_FILES[$f];
	$path = $dir . '/' . $file;
	$name = sanitize_file_name(flc_file_slug(get_the_title($id) ?: 'disegno-' . $id) . '-' . $file);
	nocache_headers();
	header('Content-Type: ' . $type);
	header('Content-Length: ' . filesize($path));
	header('Content-Disposition: attachment; filename="' . $name . '"');
	header('X-Content-Type-Options: nosniff');
	readfile($path);
	exit;
});

function flc_tpl_print_delete($post_id) {
	$m = get_post_meta($post_id, '_flc_tpl_print', true);
	if (is_array($m) && !empty($m['png'])) {
		wp_delete_attachment((int) $m['png'], true);
	}
	$dir  = flc_tpl_dir($post_id);
	$base = realpath(flc_storage_base());
	if ($dir && is_dir($dir) && $base && strpos(realpath($dir), $base) === 0) {
		foreach (glob($dir . '/*') as $file) {
			@unlink($file);
		}
		@rmdir($dir);
	}
	delete_post_meta($post_id, '_flc_tpl_print');
}

add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/disegni/(?P<id>\d+)/elaborato', array(
		'methods'             => 'POST',
		'permission_callback' => function () { return current_user_can('manage_options'); },
		'callback'            => 'flc_rest_tpl_print',
	));
});

function flc_rest_tpl_print(WP_REST_Request $req) {
	$id = (int) $req->get_param('id');
	if (get_post_type($id) !== 'flc_template') {
		return new WP_Error('flc_tpl', 'Disegno pronto non trovato.', array('status' => 404));
	}
	$files = $req->get_file_params();
	if (empty($files['png']['tmp_name']) || !flc_is_png($files['png']['tmp_name'])) {
		return new WP_Error('flc_tpl', 'Manca l\'immagine PNG del disegno.', array('status' => 400));
	}
	if (empty($files['eps']['tmp_name']) || empty($files['3mf']['tmp_name'])) {
		return new WP_Error('flc_tpl', 'Mancano i file di stampa (EPS e 3MF).', array('status' => 400));
	}
	$old = get_post_meta($id, '_flc_tpl_print', true);
	$dir = flc_tpl_dir($id, true);
	$got = array();
	foreach (FLC_TPL_FILES as $k => $f) {
		if (!empty($files[$k]['tmp_name']) && is_uploaded_file($files[$k]['tmp_name'])) {
			if (!@move_uploaded_file($files[$k]['tmp_name'], $dir . '/' . $f[0])) {
				return new WP_Error('flc_tpl', 'Non riesco a salvare ' . $f[0] . '.', array('status' => 500));
			}
			$got[$k] = true;
		}
	}
	// immagine nuova come allegato (la vecchia elaborazione si cancella, l'originale non si tocca)
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$title = get_the_title($id);
	$att   = media_handle_sideload(array('name' => sanitize_file_name(flc_file_slug($title ?: 'disegno') . '-elaborato.png'), 'tmp_name' => $files['png']['tmp_name']), $id, $title . ' (elaborato)');
	if (is_wp_error($att)) {
		return new WP_Error('flc_tpl', $att->get_error_message(), array('status' => 500));
	}
	if (is_array($old) && !empty($old['png']) && (int) $old['png'] !== (int) $att) {
		wp_delete_attachment((int) $old['png'], true);
	}
	$colors = json_decode((string) $req->get_param('colors'), true);
	update_post_meta($id, '_flc_tpl_print', array(
		'png'    => (int) $att,
		'dir'    => basename($dir),
		'files'  => $got,
		'time'   => time(),
		'colors' => is_array($colors) ? array_slice(array_map('sanitize_text_field', $colors), 0, 30) : array(),
	));
	return array('ok' => true, 'id' => $id, 'url' => wp_get_attachment_url($att), 'project' => flc_tpl_file_url($id, 'francy'), 'links' => flc_tpl_print_links($id));
}

// riquadro nella modifica del disegno: file di stampa, immagine elaborata, "Rimuovi elaborazione"
add_action('add_meta_boxes_flc_template', function () {
	add_meta_box('flc_tpl_print', 'Pronto da stampare', function ($post) {
		$ed = flc_tpl_print($post->ID);
		echo '<p>' . flc_tpl_print_links($post->ID) . '</p>';
		if ($ed) {
			$img = wp_get_attachment_image_url($ed['png'], 'medium');
			if ($img) {
				echo '<p><img src="' . esc_url($img) . '" alt="" style="width:100%;height:auto;border-radius:8px;background:#f6f7f7"><br><span class="description">Questa è l\'immagine che vedono i clienti; l\'originale resta l\'immagine in evidenza.</span></p>';
			}
			$url = wp_nonce_url(admin_url('admin-post.php?action=flc_tpl_reset&id=' . $post->ID), 'flc_tpl_reset_' . $post->ID);
			echo '<p><a class="button" href="' . esc_url($url) . '" onclick="return confirm(\'Rimuovere immagine elaborata e file di stampa? I clienti torneranno a vedere l\\\'originale.\')">Rimuovi elaborazione</a></p>';
		}
	}, 'flc_template', 'side');
});

add_action('admin_post_flc_tpl_reset', function () {
	$id = absint($_GET['id'] ?? 0);
	if (!current_user_can('manage_options') || !wp_verify_nonce($_GET['_wpnonce'] ?? '', 'flc_tpl_reset_' . $id) || get_post_type($id) !== 'flc_template') {
		wp_die('Non autorizzato.', 403);
	}
	flc_tpl_print_delete($id);
	wp_safe_redirect(get_edit_post_link($id, 'url'));
	exit;
});

// cancellando il disegno (svuotando il cestino) si cancellano anche i suoi file di stampa
add_action('before_delete_post', function ($post_id) {
	if (get_post_type($post_id) === 'flc_template') {
		flc_tpl_print_delete($post_id);
	}
});
