<?php
// Esempi dei 3 stili di ridisegno (Fedele, Ritratto, Anime): per ogni stile una coppia "originale → risultato"
// che il cliente vede sotto i pulsanti degli stili, così capisce cosa cambia senza spendere ridisegni.
// Ogni stile può avere la sua foto originale (es. un volto per Ritratto); se non ce l'ha usa la foto comune.
// Il risultato si genera con l'IA (una volta sola) oppure si carica a mano.
// File pubblici in wp-content/uploads/francy-lamp-esempi/.

if (!defined('ABSPATH')) {
	exit;
}

const FLC_EX_OPTION = 'flc_examples';
const FLC_EX_STYLES = array('fedele' => 'Fedele', 'ritratto' => 'Ritratto', 'anime' => 'Anime');

function flc_examples_dir() {
	$up  = wp_upload_dir(null, false);
	$dir = trailingslashit($up['basedir']) . 'francy-lamp-esempi';
	if (!is_dir($dir)) {
		wp_mkdir_p($dir);
	}
	return array($dir, trailingslashit($up['baseurl']) . 'francy-lamp-esempi');
}

function flc_examples() {
	$ex = get_option(FLC_EX_OPTION, array());
	return is_array($ex) ? $ex : array();
}

// Foto originale di uno stile: la sua se c'è, altrimenti quella comune
function flc_example_original($ex, $style) {
	if (!empty($ex[$style . '_orig']['url'])) {
		return $ex[$style . '_orig'];
	}
	return !empty($ex['original']['url']) ? $ex['original'] : null;
}

// Per il configuratore: { stile: { orig, res } } solo per gli stili con entrambe le immagini
function flc_examples_for_frontend() {
	$s  = flc_settings();
	$ex = flc_examples();
	if (empty($s['examples_enabled'])) {
		return null;
	}
	$out = array();
	foreach (FLC_EX_STYLES as $k => $label) {
		$orig = flc_example_original($ex, $k);
		if ($orig && !empty($ex[$k]['url'])) {
			$out[$k] = array('orig' => $orig['url'], 'res' => $ex[$k]['url']);
		}
	}
	return $out ? $out : null;
}

add_action('admin_menu', function () {
	add_submenu_page('edit.php?post_type=flc_design', 'Esempi stili', 'Esempi stili', 'manage_options', 'flc-esempi', 'flc_examples_page');
}, 18);

// caricamento della foto d'esempio: ritaglio quadrato al centro, 1024 px, JPEG
add_action('admin_post_flc_example_upload', function () {
	if (!current_user_can('manage_options') || !check_admin_referer('flc_example_upload')) {
		wp_die('Non autorizzato.', 403);
	}
	$back  = admin_url('edit.php?post_type=flc_design&page=flc-esempi');
	$f     = $_FILES['example'] ?? null;
	$style = sanitize_key($_POST['style'] ?? ''); // vuoto = foto comune
	if (($style !== '' && !isset(FLC_EX_STYLES[$style])) || !$f || !empty($f['error']) || !is_uploaded_file($f['tmp_name']) || !@getimagesize($f['tmp_name'])) {
		wp_safe_redirect(add_query_arg('flc_msg', 'upload_err', $back));
		exit;
	}
	list($dir, $url) = flc_examples_dir();
	$editor = wp_get_image_editor($f['tmp_name']);
	if (is_wp_error($editor)) {
		wp_safe_redirect(add_query_arg('flc_msg', 'upload_err', $back));
		exit;
	}
	$size = $editor->get_size();
	$side = min($size['width'], $size['height']);
	$editor->crop((int) (($size['width'] - $side) / 2), (int) (($size['height'] - $side) / 2), $side, $side, 1024, 1024);
	$editor->set_quality(90);
	$name  = $style !== '' ? $style . '-originale.jpg' : 'originale.jpg';
	$saved = $editor->save($dir . '/' . $name, 'image/jpeg');
	if (is_wp_error($saved)) {
		wp_safe_redirect(add_query_arg('flc_msg', 'upload_err', $back));
		exit;
	}
	// nuova foto: i risultati costruiti su quella vecchia non valgono più
	$ex      = flc_examples();
	$targets = $style !== '' ? array($style) : array_filter(array_keys(FLC_EX_STYLES), function ($k) use ($ex) { return empty($ex[$k . '_orig']); });
	foreach ($targets as $k) {
		foreach (glob($dir . '/' . $k . '.*') as $old) {
			@unlink($old);
		}
		unset($ex[$k]);
	}
	$ex[$style !== '' ? $style . '_orig' : 'original'] = array('url' => $url . '/' . $name . '?t=' . time());
	update_option(FLC_EX_OPTION, $ex, false);
	wp_safe_redirect(add_query_arg('flc_msg', 'upload_ok', $back));
	exit;
});

// toglie la foto propria di uno stile (torna a usare quella comune)
add_action('admin_post_flc_example_orig_reset', function () {
	if (!current_user_can('manage_options') || !check_admin_referer('flc_example_orig_reset')) {
		wp_die('Non autorizzato.', 403);
	}
	$style = sanitize_key($_POST['style'] ?? '');
	if (isset(FLC_EX_STYLES[$style])) {
		list($dir) = flc_examples_dir();
		@unlink($dir . '/' . $style . '-originale.jpg');
		foreach (glob($dir . '/' . $style . '.*') as $old) {
			@unlink($old);
		}
		$ex = flc_examples();
		unset($ex[$style . '_orig'], $ex[$style]);
		update_option(FLC_EX_OPTION, $ex, false);
	}
	wp_safe_redirect(admin_url('edit.php?post_type=flc_design&page=flc-esempi'));
	exit;
});

// caricamento manuale del risultato di uno stile (controllo completo dell'admin)
add_action('admin_post_flc_example_style_upload', function () {
	if (!current_user_can('manage_options') || !check_admin_referer('flc_example_style_upload')) {
		wp_die('Non autorizzato.', 403);
	}
	$back  = admin_url('edit.php?post_type=flc_design&page=flc-esempi');
	$style = sanitize_key($_POST['style'] ?? '');
	$f     = $_FILES['example'] ?? null;
	if (!isset(FLC_EX_STYLES[$style]) || !$f || !empty($f['error']) || !is_uploaded_file($f['tmp_name']) || !@getimagesize($f['tmp_name'])) {
		wp_safe_redirect(add_query_arg('flc_msg', 'upload_err', $back));
		exit;
	}
	list($dir, $url) = flc_examples_dir();
	$editor = wp_get_image_editor($f['tmp_name']);
	if (is_wp_error($editor)) {
		wp_safe_redirect(add_query_arg('flc_msg', 'upload_err', $back));
		exit;
	}
	$size = $editor->get_size();
	$side = min($size['width'], $size['height']);
	$editor->crop((int) (($size['width'] - $side) / 2), (int) (($size['height'] - $side) / 2), $side, $side, min(1024, $side), min(1024, $side));
	foreach (glob($dir . '/' . $style . '.*') as $old) {
		@unlink($old);
	}
	$saved = $editor->save($dir . '/' . $style . '.png', 'image/png');
	if (is_wp_error($saved)) {
		wp_safe_redirect(add_query_arg('flc_msg', 'upload_err', $back));
		exit;
	}
	$ex         = flc_examples();
	$ex[$style] = array('url' => $url . '/' . $style . '.png?t=' . time(), 'provider' => 'caricato a mano', 'date' => current_time('Y-m-d H:i'));
	update_option(FLC_EX_OPTION, $ex, false);
	wp_safe_redirect(add_query_arg('flc_msg', 'style_ok', $back));
	exit;
});

// generazione di uno stile (chiamata dalla pagina, uno alla volta)
add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/esempio', array(
		'methods'             => 'POST',
		'callback'            => 'flc_rest_example',
		'permission_callback' => function () {
			return current_user_can('manage_options');
		},
	));
});

function flc_rest_example(WP_REST_Request $req) {
	$style = (string) $req->get_param('style');
	if (!isset(FLC_EX_STYLES[$style])) {
		return new WP_Error('flc_bad', 'Stile non valido.', array('status' => 400));
	}
	list($dir, $url) = flc_examples_dir();
	$src = is_file($dir . '/' . $style . '-originale.jpg') ? $dir . '/' . $style . '-originale.jpg' : $dir . '/originale.jpg';
	if (!is_file($src)) {
		return new WP_Error('flc_bad', 'Carica prima la foto originale.', array('status' => 400));
	}
	if (function_exists('set_time_limit')) {
		@set_time_limit(420);
	}
	$s   = flc_settings();
	$s['style_anime'] = 1; // l'esempio Anime si genera anche se lo stile è nascosto ai clienti
	$gen = flc_generate(file_get_contents($src), 'image/jpeg', $style, $s);
	if (is_wp_error($gen)) {
		return new WP_Error('flc_fail', 'Generazione non riuscita: ' . $gen->get_error_message(), array('status' => 502));
	}
	$ext = $gen['mime'] === 'image/jpeg' ? 'jpg' : ($gen['mime'] === 'image/webp' ? 'webp' : 'png');
	foreach (glob($dir . '/' . $style . '.*') as $old) {
		@unlink($old);
	}
	file_put_contents($dir . '/' . $style . '.' . $ext, $gen['data']);
	$ex          = flc_examples();
	$ex[$style]  = array('url' => $url . '/' . $style . '.' . $ext . '?t=' . time(), 'provider' => $gen['provider'], 'date' => current_time('Y-m-d H:i'));
	update_option(FLC_EX_OPTION, $ex, false);
	return array('ok' => true, 'url' => $ex[$style]['url'], 'provider' => $gen['provider']);
}

function flc_examples_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$ex  = flc_examples();
	$msg = sanitize_key($_GET['flc_msg'] ?? '');
	?>
	<div class="wrap">
		<h1>Esempi stili</h1>
		<p>Nel configuratore, sotto i pulsanti Fedele / Ritratto / Anime, il cliente vede "originale → risultato" dello stile selezionato e capisce la differenza senza spendere ridisegni.
			Ogni stile può avere la sua coppia di immagini.</p>
		<?php if ($msg === 'upload_ok') : ?><div class="notice notice-success"><p>Foto caricata. Ora genera o carica il risultato.</p></div><?php endif; ?>
		<?php if ($msg === 'style_ok') : ?><div class="notice notice-success"><p>Esempio caricato.</p></div><?php endif; ?>
		<?php if ($msg === 'upload_err') : ?><div class="notice notice-error"><p>Immagine non valida o non caricata.</p></div><?php endif; ?>

		<h2>Foto comune</h2>
		<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data" style="display:flex;gap:14px;align-items:flex-start">
			<?php if (!empty($ex['original']['url'])) : ?><img src="<?php echo esc_url($ex['original']['url']); ?>" style="width:110px;aspect-ratio:1;object-fit:cover;border-radius:8px" alt=""><?php endif; ?>
			<div>
				<input type="hidden" name="action" value="flc_example_upload">
				<?php wp_nonce_field('flc_example_upload'); ?>
				<input type="file" name="example" accept="image/*" required>
				<?php submit_button('Carica foto comune', 'secondary', 'submit', false); ?>
				<p class="description">Usata dagli stili che non hanno una foto propria. Ritaglio quadrato al centro (1024×1024).</p>
			</div>
		</form>

		<h2>Esempi per stile</h2>
		<p class="description">Per ogni stile scegli la foto originale (es. un volto per Ritratto) e il risultato: generalo con l'IA (circa 4 centesimi, una volta sola) oppure caricalo tu.
			Cambiando la foto originale di uno stile il suo risultato viene cancellato.</p>
		<table class="widefat striped" style="max-width:820px;margin-top:10px" id="flcEx">
			<thead><tr><th>Stile</th><th style="width:200px">Originale</th><th style="width:30px"></th><th style="width:200px">Risultato</th></tr></thead>
			<tbody>
			<?php foreach (FLC_EX_STYLES as $k => $label) :
				$orig = flc_example_original($ex, $k);
				$own  = !empty($ex[$k . '_orig']['url']); ?>
				<tr data-style="<?php echo esc_attr($k); ?>">
					<td><strong><?php echo esc_html($label); ?></strong>
						<?php if (!empty($ex[$k]['date'])) : ?><br><span class="description"><?php echo esc_html($ex[$k]['date'] . ' · ' . $ex[$k]['provider']); ?></span><?php endif; ?></td>
					<td>
						<?php if ($orig) : ?><img src="<?php echo esc_url($orig['url']); ?>" style="<?php echo esc_attr('width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px'); ?>" alt="">
						<?php else : ?><div style="<?php echo esc_attr('width:100%;aspect-ratio:1;border:2px dashed #c3c4c7;border-radius:8px;display:grid;place-items:center;color:#646970;text-align:center;padding:8px;box-sizing:border-box'); ?>">nessuna foto</div><?php endif; ?>
						<p class="description" style="margin:4px 0"><?php echo $own ? 'Foto propria' : ($orig ? 'Foto comune' : ''); ?></p>
						<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data" style="display:inline">
							<input type="hidden" name="action" value="flc_example_upload">
							<input type="hidden" name="style" value="<?php echo esc_attr($k); ?>">
							<?php wp_nonce_field('flc_example_upload'); ?>
							<label class="button button-small" style="cursor:pointer">Scegli originale<input type="file" name="example" accept="image/*" style="display:none" onchange="this.form.submit()"></label>
						</form>
						<?php if ($own) : ?>
						<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline">
							<input type="hidden" name="action" value="flc_example_orig_reset">
							<input type="hidden" name="style" value="<?php echo esc_attr($k); ?>">
							<?php wp_nonce_field('flc_example_orig_reset'); ?>
							<button class="button-link" style="font-size:12px">usa quella comune</button>
						</form>
						<?php endif; ?>
					</td>
					<td style="font-size:22px;color:#646970;vertical-align:middle">→</td>
					<td class="flc-res">
						<?php if (!empty($ex[$k]['url'])) : ?><img src="<?php echo esc_url($ex[$k]['url']); ?>" style="<?php echo esc_attr('width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px'); ?>" alt="">
						<?php else : ?><div class="flc-ph" style="<?php echo esc_attr('width:100%;aspect-ratio:1;border:2px dashed #c3c4c7;border-radius:8px;display:grid;place-items:center;color:#646970;text-align:center;padding:8px;box-sizing:border-box'); ?>">da generare o caricare</div><?php endif; ?>
						<p style="margin:6px 0 0">
							<button type="button" class="button button-small flc-gen" data-style="<?php echo esc_attr($k); ?>" <?php disabled(!$orig); ?>><?php echo empty($ex[$k]['url']) ? 'Genera con IA' : 'Rigenera'; ?></button>
						</p>
						<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data" style="margin-top:4px">
							<input type="hidden" name="action" value="flc_example_style_upload">
							<input type="hidden" name="style" value="<?php echo esc_attr($k); ?>">
							<?php wp_nonce_field('flc_example_style_upload'); ?>
							<label class="button button-small" style="cursor:pointer">Carica risultato<input type="file" name="example" accept="image/*" style="display:none" onchange="this.form.submit()"></label>
						</form>
					</td>
				</tr>
			<?php endforeach; ?>
			</tbody>
		</table>
		<p><button type="button" class="button button-primary" id="flcGenAll">Genera con IA quelli mancanti</button>
			<span id="flcGenMsg" style="margin-left:10px"></span></p>
		<p class="description">Mostrare o nascondere gli esempi ai clienti: Impostazioni → Prompt.</p>
	</div>
	<script>
	(function () {
		const url = <?php echo wp_json_encode(rest_url('francy-lamp/v1/esempio')); ?>;
		const nonce = <?php echo wp_json_encode(wp_create_nonce('wp_rest')); ?>;
		const msg = document.getElementById('flcGenMsg');
		async function gen(style) {
			const fig = document.querySelector('#flcEx tr[data-style="' + style + '"] .flc-res');
			const btn = fig.querySelector('.flc-gen');
			btn.disabled = true; btn.textContent = 'Genero… (10–40 s)';
			try {
				const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce }, body: JSON.stringify({ style }) });
				const j = await r.json().catch(() => ({}));
				if (!r.ok || !j.ok) throw new Error(j.message || ('HTTP ' + r.status));
				const old = fig.querySelector('img, .flc-ph');
				const img = document.createElement('img');
				img.src = j.url; img.alt = ''; img.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px';
				old.replaceWith(img);
				msg.textContent = 'Fatto: ' + style + ' (' + j.provider + ')';
			} catch (e) {
				msg.textContent = 'Errore su ' + style + ': ' + e.message;
				throw e;
			} finally {
				btn.disabled = false; btn.textContent = 'Rigenera';
			}
		}
		document.querySelectorAll('.flc-gen').forEach((b) => b.addEventListener('click', () => gen(b.dataset.style).catch(() => {})));
		document.getElementById('flcGenAll').addEventListener('click', async () => {
			const todo = [...document.querySelectorAll('#flcEx .flc-res')].filter((td) => td.querySelector('.flc-ph') && !td.querySelector('.flc-gen').disabled).map((td) => td.querySelector('.flc-gen').dataset.style);
			if (!todo.length) { msg.textContent = 'Non manca niente (o manca la foto originale).'; return; }
			for (const st of todo) {
				try { await gen(st); } catch (e) { return; }
			}
			msg.textContent = 'Esempi pronti.';
		});
	})();
	</script>
	<?php
}
