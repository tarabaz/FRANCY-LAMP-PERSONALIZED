<?php
// Esempi dei 3 stili di ridisegno (Fedele, Vetrata, Anime) generati UNA volta dall'admin su una foto
// d'esempio: il cliente vede "originale → risultato" e capisce cosa cambia senza spendere ridisegni.
// File pubblici in wp-content/uploads/francy-lamp-esempi/.

if (!defined('ABSPATH')) {
	exit;
}

const FLC_EX_OPTION = 'flc_examples';
const FLC_EX_STYLES = array('fedele' => 'Fedele', 'vetrata' => 'Vetrata', 'anime' => 'Anime');

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

// Per il configuratore: solo se attivi e se ci sono originale + almeno uno stile
function flc_examples_for_frontend() {
	$s  = flc_settings();
	$ex = flc_examples();
	if (empty($s['examples_enabled']) || empty($ex['original'])) {
		return null;
	}
	$out = array('original' => $ex['original']['url']);
	foreach (FLC_EX_STYLES as $k => $label) {
		if (!empty($ex[$k]['url'])) {
			$out[$k] = $ex[$k]['url'];
		}
	}
	return count($out) > 1 ? $out : null;
}

add_action('admin_menu', function () {
	add_submenu_page('edit.php?post_type=flc_design', 'Esempi stili', 'Esempi stili', 'manage_options', 'flc-esempi', 'flc_examples_page');
}, 18);

// caricamento della foto d'esempio: ritaglio quadrato al centro, 1024 px, JPEG
add_action('admin_post_flc_example_upload', function () {
	if (!current_user_can('manage_options') || !check_admin_referer('flc_example_upload')) {
		wp_die('Non autorizzato.', 403);
	}
	$back = admin_url('edit.php?post_type=flc_design&page=flc-esempi');
	$f    = $_FILES['example'] ?? null;
	if (!$f || !empty($f['error']) || !is_uploaded_file($f['tmp_name']) || !@getimagesize($f['tmp_name'])) {
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
	$saved = $editor->save($dir . '/originale.jpg', 'image/jpeg');
	if (is_wp_error($saved)) {
		wp_safe_redirect(add_query_arg('flc_msg', 'upload_err', $back));
		exit;
	}
	// nuova foto: i vecchi risultati non valgono più
	foreach (array_keys(FLC_EX_STYLES) as $k) {
		foreach (glob($dir . '/' . $k . '.*') as $old) {
			@unlink($old);
		}
	}
	update_option(FLC_EX_OPTION, array('original' => array('url' => $url . '/originale.jpg?t=' . time())), false);
	wp_safe_redirect(add_query_arg('flc_msg', 'upload_ok', $back));
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
	$src = $dir . '/originale.jpg';
	if (!is_file($src)) {
		return new WP_Error('flc_bad', 'Carica prima la foto d\'esempio.', array('status' => 400));
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
		<p>Carica una foto d'esempio e genera una volta i 3 stili di ridisegno, oppure carica tu le immagini di ogni stile ("Carica il tuo"). Nel configuratore, sotto i pulsanti
			Fedele / Vetrata / Anime, il cliente vede "originale → risultato" e capisce la differenza senza spendere ridisegni.</p>
		<?php if ($msg === 'upload_ok') : ?><div class="notice notice-success"><p>Foto d'esempio caricata. Ora genera gli stili.</p></div><?php endif; ?>
		<?php if ($msg === 'style_ok') : ?><div class="notice notice-success"><p>Esempio caricato.</p></div><?php endif; ?>
		<?php if ($msg === 'upload_err') : ?><div class="notice notice-error"><p>Immagine non valida o non caricata.</p></div><?php endif; ?>

		<h2>1. Foto d'esempio</h2>
		<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
			<input type="hidden" name="action" value="flc_example_upload">
			<?php wp_nonce_field('flc_example_upload'); ?>
			<input type="file" name="example" accept="image/*" required>
			<?php submit_button('Carica foto', 'secondary', 'submit', false); ?>
			<p class="description">Viene ritagliata quadrata al centro (1024×1024). Meglio una foto vera con un soggetto chiaro: una persona o un animale.
				Caricando una nuova foto i vecchi esempi vengono cancellati.</p>
		</form>

		<h2>2. Genera gli stili</h2>
		<p class="description">Ogni stile è un ridisegno a pagamento col fornitore impostato (circa 4 centesimi): 3 stili ≈ 12 centesimi, una volta sola.</p>
		<div style="display:grid;grid-template-columns:repeat(4,minmax(150px,220px));gap:14px;margin:12px 0" id="flcEx">
			<figure style="margin:0;text-align:center">
				<?php if (!empty($ex['original'])) : ?><img src="<?php echo esc_url($ex['original']['url']); ?>" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px" alt="">
				<?php else : ?><div style="width:100%;aspect-ratio:1;border:2px dashed #c3c4c7;border-radius:8px;display:grid;place-items:center;color:#646970">nessuna foto</div><?php endif; ?>
				<figcaption><strong>Originale</strong></figcaption>
			</figure>
			<?php foreach (FLC_EX_STYLES as $k => $label) : ?>
				<figure style="margin:0;text-align:center" data-style="<?php echo esc_attr($k); ?>">
					<?php if (!empty($ex[$k]['url'])) : ?><img src="<?php echo esc_url($ex[$k]['url']); ?>" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px" alt="">
					<?php else : ?><div class="flc-ph" style="width:100%;aspect-ratio:1;border:2px dashed #c3c4c7;border-radius:8px;display:grid;place-items:center;color:#646970">da generare</div><?php endif; ?>
					<figcaption><strong><?php echo esc_html($label); ?></strong>
						<?php if (!empty($ex[$k]['date'])) : ?><br><span class="description"><?php echo esc_html($ex[$k]['date'] . ' · ' . $ex[$k]['provider']); ?></span><?php endif; ?>
						<br><button type="button" class="button flc-gen" data-style="<?php echo esc_attr($k); ?>" <?php disabled(empty($ex['original'])); ?>>Genera</button>
					</figcaption>
					<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data" style="margin-top:6px">
						<input type="hidden" name="action" value="flc_example_style_upload">
						<input type="hidden" name="style" value="<?php echo esc_attr($k); ?>">
						<?php wp_nonce_field('flc_example_style_upload'); ?>
						<label class="button button-small" style="cursor:pointer">Carica il tuo<input type="file" name="example" accept="image/*" style="display:none" onchange="this.form.submit()"></label>
					</form>
				</figure>
			<?php endforeach; ?>
		</div>
		<p><button type="button" class="button button-primary" id="flcGenAll" <?php disabled(empty($ex['original'])); ?>>Genera tutti e 3</button>
			<span id="flcGenMsg" style="margin-left:10px"></span></p>
		<p class="description">Mostrare o nascondere gli esempi ai clienti: Impostazioni → Prompt.</p>
	</div>
	<script>
	(function () {
		const url = <?php echo wp_json_encode(rest_url('francy-lamp/v1/esempio')); ?>;
		const nonce = <?php echo wp_json_encode(wp_create_nonce('wp_rest')); ?>;
		const msg = document.getElementById('flcGenMsg');
		async function gen(style) {
			const fig = document.querySelector('#flcEx figure[data-style="' + style + '"]');
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
			for (const st of ['fedele', 'vetrata', 'anime']) {
				try { await gen(st); } catch (e) { return; }
			}
			msg.textContent = 'Tutti e 3 gli esempi sono pronti.';
		});
	})();
	</script>
	<?php
}
