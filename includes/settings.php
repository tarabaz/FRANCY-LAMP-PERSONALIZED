<?php
// Pagina "Francy Lamp Factory → Impostazioni": fornitori IA, chiavi, prompt, limiti anti-abuso e convalida.

if (!defined('ABSPATH')) {
	exit;
}

const FLC_OPTION = 'flc_settings';

// Prompt usati finché non vengono personalizzati. I vecchi predefiniti vengono sostituiti da quelli nuovi.
function flc_default_prompt() {
	return 'This is a STYLE CONVERSION, not a redesign. Convert the attached image into flat-color vector line art, like a Japanese decorative manhole cover, '
		. 'while keeping EXACTLY the same composition. Treat the input as a tracing template: every element must stay in the same position, size and proportion. '
		. 'Do NOT change the pose, the body orientation, the camera angle, the head direction, the facial expression, the number or position of objects, '
		. 'the framing or the cropping: anything cut off by the image edge stays cut off. '
		. 'Do NOT redraw the subject from memory or from your knowledge of the character, and do not make it more generic, symmetrical or front-facing. '
		. 'Keep identifiable details: for a person the exact face shape, eyes, eyebrows, nose, mouth, smile, hairstyle, hair and skin color; for a character its exact expression, teeth, eyes and markings as shown. '
		. 'Rendering: flat solid colors, at most two tones per area (base color plus one simple shadow tone), thick uniform black outlines around every shape, '
		. 'no gradients, no glow, no blur, no textures, no text, no letters, no frame or border. '
		. 'Reduce the many colors of the original to a small bold palette that matches the original hues, and merge tiny details and busy background texture into a few large flat shapes. '
		. 'The artwork must fill the whole square canvas because it will be cropped to a circle.';
}

function flc_default_prompt_stylized() {
	return 'Convert the attached image into a Japanese decorative manhole cover illustration with flat solid colors (at most 10 different colors) and thick uniform black outlines around every shape. '
		. 'Keep the same subject, pose and general composition as the input, but simplify shapes and details more boldly and make the background simple and decorative. '
		. 'No gradients, no shading, no textures, no glow, no text, no letters, no frame or border. '
		. 'The main subject must stay centered and the artwork must fill the whole square canvas because it will be cropped to a circle.';
}

// Stile anime: atmosfera da film d'animazione giapponese classico, ma resa stampabile (colori piatti + contorni)
function flc_default_prompt_anime() {
	return 'Redraw the attached image as a still from a classic hand-drawn Japanese animated feature film with a warm, whimsical fairy-tale mood: '
		. 'gentle rounded character design, soft friendly expressive faces, cozy storybook atmosphere, nostalgic and magical, nature simplified into charming shapes. '
		. 'Keep the same subject, pose, composition and recognisable features (for a person: face shape, eyes, eyebrows, smile, hairstyle, hair and skin color, expression; '
		. 'for an animal or character: its markings, colors and expression). '
		. 'IMPORTANT, this will be 3D printed in flat colors: render ONLY with flat solid cel-shaded colors (at most 10 colors, at most two tones per area), '
		. 'clean thick uniform black outlines around every shape, no gradients, no watercolor texture, no glow, no blur, no film grain. '
		. 'Simplify the background into a few large flat shapes. No text, no letters, no frame or border. '
		. 'The artwork must fill the whole square canvas because it will be cropped to a circle.';
}

// Prompt predefiniti delle versioni precedenti: se salvati nelle impostazioni vengono rimpiazzati dal nuovo
function flc_old_default_prompts() {
	return array(
		'Redraw this image as a Japanese decorative manhole cover illustration. Style: flat solid colors only (at most 10 different colors), thick uniform black outlines around every shape, no gradients, no shading, no textures, no text, no letters, no frame or border. Simplify small details into bold clean shapes, keep the composition, the subject and the main colors recognisable. The main subject must be centered, the artwork must fill the whole square canvas because it will be cropped to a circle.',
		'Redraw this photo as a Japanese decorative manhole cover illustration in a clean anime / cel-shaded style. IMPORTANT: keep the likeness of the subject. Preserve the exact face shape, eye shape and eye color, eyebrows, nose, mouth and smile, ears, hairstyle and hair color, skin tone, expression, head pose, clothing and any object being held. A person who knows the subject must recognise them. Draw the facial features with clear black line art: eyes with pupils and small white highlights, eyebrows, nose, mouth, ears and hair strands. Use flat solid colors with at most two tones per area (base color plus one simple shadow tone), thick uniform black outlines around every shape, no gradients, no blur, no textures, no text, no letters, no frame or border. Simplify only the background into a few bold flat shapes. Keep the subject large and centered; the artwork must fill the whole square canvas because it will be cropped to a circle.',
	);
}

function flc_defaults() {
	return array(
		'enabled'      => 1,
		'primary'      => 'gemini',
		'fallback'     => 'none',
		'gemini_key'   => '',
		'gemini_model' => 'gemini-2.5-flash-image',
		'fal_key'      => '',
		'fal_model'    => 'fal-ai/flux-pro/kontext',
		'prompt'       => '',
		'prompt_stylized' => '',
		'prompt_anime' => '',
		'style_anime' => 1,
		'per_ip_day'   => 10,
		'daily_cap'    => 300,
		'submit_per_ip' => 5,
		'notify_email' => '',
		'templates_enabled' => 1,
		'page_enabled' => 1,
		'page_slug'    => 'lampade-personalizzate',
		'page_title'   => 'Crea la tua lampada – FrancyStore3D',
		'page_description' => '',
		'page_wp_head' => 1,
		'privacy_url'  => 'https://www.francystore3d.it/privacy-policy/',
		'cookie_url'   => '',
		'copyright_name' => 'FrancyStore3D',
		'def_band'     => '#5b9bd5',
		'def_text_color' => '#151515',
		'def_tl'       => '',
		'def_tr'       => 'Testo 2',
		'def_bl'       => 'Testo 3',
		'def_br'       => '',
	);
}

function flc_settings() {
	$s = wp_parse_args(get_option(FLC_OPTION, array()), flc_defaults());
	if (trim((string) $s['prompt']) === '' || in_array(trim((string) $s['prompt']), flc_old_default_prompts(), true)) {
		$s['prompt'] = flc_default_prompt();
	}
	if (trim((string) $s['prompt_stylized']) === '') {
		$s['prompt_stylized'] = flc_default_prompt_stylized();
	}
	if (trim((string) $s['prompt_anime']) === '') {
		$s['prompt_anime'] = flc_default_prompt_anime();
	}
	return $s;
}

// Le pagine stanno nel menu dedicato "Francy Lamp Factory" (vedi designs.php)
add_action('admin_menu', function () {
	add_submenu_page('edit.php?post_type=flc_design', 'Impostazioni Francy Lamp', 'Impostazioni', 'manage_options', 'francy-lamp', 'flc_settings_page');
}, 20);

function flc_settings_url() {
	return admin_url('edit.php?post_type=flc_design&page=francy-lamp');
}

add_action('admin_init', function () {
	register_setting('flc', FLC_OPTION, array('sanitize_callback' => 'flc_sanitize_settings'));
});

function flc_sanitize_settings($in) {
	$d   = flc_defaults();
	$old = flc_settings();
	$providers = array_keys(flc_providers());
	$out = array(
		'enabled'      => empty($in['enabled']) ? 0 : 1,
		'primary'      => in_array($in['primary'] ?? '', $providers, true) ? $in['primary'] : $d['primary'],
		'fallback'     => in_array($in['fallback'] ?? '', array_merge(array('none'), $providers), true) ? $in['fallback'] : 'none',
		'gemini_model' => sanitize_text_field($in['gemini_model'] ?? $d['gemini_model']),
		'fal_model'    => sanitize_text_field($in['fal_model'] ?? $d['fal_model']),
		'prompt'       => sanitize_textarea_field($in['prompt'] ?? ''),
		'prompt_stylized' => sanitize_textarea_field($in['prompt_stylized'] ?? ''),
		'prompt_anime' => sanitize_textarea_field($in['prompt_anime'] ?? ''),
		'style_anime' => empty($in['style_anime']) ? 0 : 1,
		'per_ip_day'   => max(0, (int) ($in['per_ip_day'] ?? $d['per_ip_day'])),
		'daily_cap'    => max(0, (int) ($in['daily_cap'] ?? $d['daily_cap'])),
		'submit_per_ip' => max(0, (int) ($in['submit_per_ip'] ?? $d['submit_per_ip'])),
		'notify_email' => sanitize_email($in['notify_email'] ?? ''),
		'templates_enabled' => empty($in['templates_enabled']) ? 0 : 1,
		'page_enabled' => empty($in['page_enabled']) ? 0 : 1,
		'page_slug'    => sanitize_title($in['page_slug'] ?? '') ?: $d['page_slug'],
		'page_title'   => sanitize_text_field($in['page_title'] ?? '') ?: $d['page_title'],
		'page_description' => sanitize_text_field($in['page_description'] ?? ''),
		'page_wp_head' => empty($in['page_wp_head']) ? 0 : 1,
		'privacy_url'  => esc_url_raw($in['privacy_url'] ?? '') ?: $d['privacy_url'],
		'cookie_url'   => esc_url_raw($in['cookie_url'] ?? ''),
		'copyright_name' => sanitize_text_field($in['copyright_name'] ?? '') ?: $d['copyright_name'],
		'def_band'     => sanitize_hex_color($in['def_band'] ?? '') ?: $d['def_band'],
		'def_text_color' => sanitize_hex_color($in['def_text_color'] ?? '') ?: $d['def_text_color'],
		'def_tl'       => mb_substr(sanitize_text_field($in['def_tl'] ?? ''), 0, 14),
		'def_tr'       => mb_substr(sanitize_text_field($in['def_tr'] ?? ''), 0, 14),
		'def_bl'       => mb_substr(sanitize_text_field($in['def_bl'] ?? ''), 0, 10),
		'def_br'       => mb_substr(sanitize_text_field($in['def_br'] ?? ''), 0, 10),
	);
	// Se il testo è uguale al predefinito non lo salvo: così gli aggiornamenti del plugin migliorano anche il tuo prompt
	if ($out['prompt'] === flc_default_prompt()) {
		$out['prompt'] = '';
	}
	if ($out['prompt_stylized'] === flc_default_prompt_stylized()) {
		$out['prompt_stylized'] = '';
	}
	if ($out['prompt_anime'] === flc_default_prompt_anime()) {
		$out['prompt_anime'] = '';
	}
	// Le chiavi non vengono mai rimandate al browser: campo vuoto = mantieni quella salvata
	foreach (array('gemini_key', 'fal_key') as $k) {
		$v       = trim(sanitize_text_field($in[$k] ?? ''));
		$out[$k] = $v !== '' ? $v : $old[$k];
		if (!empty($in[$k . '_clear'])) {
			$out[$k] = '';
		}
	}
	return $out;
}

function flc_settings_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$s   = flc_settings();
	$p   = flc_providers();
	$log = flc_usage_log();
	$opt = FLC_OPTION;
	$sel = function ($name, $value, $choices) use ($opt) {
		echo '<select name="' . esc_attr("{$opt}[{$name}]") . '">';
		foreach ($choices as $k => $label) {
			echo '<option value="' . esc_attr($k) . '"' . selected($value, $k, false) . '>' . esc_html($label) . '</option>';
		}
		echo '</select>';
	};
	$labels = array_map(function ($x) { return $x['label']; }, $p);
	?>
	<div class="wrap">
		<h1>Francy Lamp Factory – Impostazioni</h1>
		<p>Inserisci il configuratore in una pagina con lo shortcode <code>[francy_lamp]</code>.
			Endpoint del ridisegno IA: <code><?php echo esc_html(rest_url('francy-lamp/v1/ridisegna')); ?></code></p>

		<?php
		$today  = flc_today_count();
		$cap    = (int) $s['daily_cap'];
		$left   = $cap > 0 ? max(0, $cap - $today) : null;
		$pct    = $cap > 0 ? min(100, round($today / $cap * 100)) : 0;
		$color  = $cap > 0 && $left === 0 ? '#d63638' : ($pct >= 80 ? '#dba617' : '#00a32a');
		?>
		<div style="max-width:640px;background:#fff;border:1px solid #c3c4c7;border-left:4px solid <?php echo esc_attr($color); ?>;padding:12px 16px;margin:16px 0">
			<strong style="font-size:15px">Ridisegni di oggi: <?php echo (int) $today; ?><?php echo $cap > 0 ? ' / ' . $cap : ''; ?></strong>
			&nbsp;–&nbsp;<?php echo $cap > 0 ? 'ne restano <strong>' . (int) $left . '</strong>' : '<strong>senza limite</strong> (tetto giornaliero a 0)'; ?>
			<?php if ($cap > 0) : ?>
				<div style="height:8px;background:#f0f0f1;border-radius:4px;margin-top:8px;overflow:hidden"><div style="height:100%;width:<?php echo (int) $pct; ?>%;background:<?php echo esc_attr($color); ?>"></div></div>
			<?php endif; ?>
			<p class="description" style="margin:8px 0 0">Limite per visitatore: <?php echo $s['per_ip_day'] > 0 ? (int) $s['per_ip_day'] . ' al giorno' : 'nessuno'; ?>. Il conteggio riparte a mezzanotte (ora del sito). Contano anche i tentativi falliti.</p>
		</div>

		<form method="post" action="options.php">
			<?php settings_fields('flc'); ?>
			<h2>Pagina del configuratore</h2>
			<table class="form-table" role="presentation">
				<tr><th>Pagina dedicata</th><td><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[page_enabled]" value="1" <?php checked($s['page_enabled'], 1); ?>> Attiva la pagina a schermo intero (senza header e footer del tema)</label>
					<?php if (!empty($s['page_enabled']) && function_exists('flc_page_url')) : ?><p><a href="<?php echo esc_url(flc_page_url()); ?>" target="_blank" rel="noopener"><strong><?php echo esc_html(flc_page_url()); ?></strong></a></p><?php endif; ?></td></tr>
				<tr><th>Indirizzo</th><td><code><?php echo esc_html(home_url('/')); ?></code><input type="text" name="<?php echo esc_attr($opt); ?>[page_slug]" value="<?php echo esc_attr($s['page_slug']); ?>" class="regular-text" style="width:240px"><code>/</code>
					<p class="description">Solo lettere minuscole, numeri e trattini (es. <code>lampade-personalizzate</code>). Non deve coincidere con una pagina esistente.</p></td></tr>
				<tr><th>Titolo della pagina</th><td><input type="text" class="regular-text" name="<?php echo esc_attr($opt); ?>[page_title]" value="<?php echo esc_attr($s['page_title']); ?>"><p class="description">Quello che si vede nella scheda del browser e su Google.</p></td></tr>
				<tr><th>Descrizione</th><td><input type="text" class="large-text" name="<?php echo esc_attr($opt); ?>[page_description]" value="<?php echo esc_attr($s['page_description']); ?>" placeholder="Es. Crea la tua lampada tombino personalizzata con la tua foto: anteprima 3D accesa e spenta."><p class="description">Facoltativa, per Google e le anteprime dei link.</p></td></tr>
				<tr><th>Script del sito</th><td><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[page_wp_head]" value="1" <?php checked($s['page_wp_head'], 1); ?>> Carica gli script degli altri plugin (Pixel di Meta, analytics, banner cookie)</label>
					<p class="description">Lascialo attivo se usi Pixel/analytics o un banner cookie. Se il tema "sporca" la pagina, toglilo: la pagina diventa più leggera.</p></td></tr>
				<tr><th>Footer</th><td>
					<p><label>Privacy Policy<br><input type="url" class="regular-text" name="<?php echo esc_attr($opt); ?>[privacy_url]" value="<?php echo esc_attr($s['privacy_url']); ?>"></label></p>
					<p><label>Cookie Policy<br><input type="url" class="regular-text" name="<?php echo esc_attr($opt); ?>[cookie_url]" value="<?php echo esc_attr($s['cookie_url']); ?>" placeholder="vuoto = stessa pagina della Privacy Policy"></label></p>
					<p><label>Nome nel copyright<br><input type="text" class="regular-text" name="<?php echo esc_attr($opt); ?>[copyright_name]" value="<?php echo esc_attr($s['copyright_name']); ?>"></label></p>
					<p class="description">Il footer mostra: Privacy Policy · Cookie Policy · © <?php echo esc_html(current_time('Y')); ?> nome · Tutti i diritti riservati (l'anno si aggiorna da solo).</p>
				</td></tr>
			</table>

			<h2>Ridisegno con IA</h2>
			<table class="form-table" role="presentation">
				<tr><th>Attivo</th><td><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[enabled]" value="1" <?php checked($s['enabled'], 1); ?>> Mostra il pulsante "Ridisegna in stile tombino"</label></td></tr>
				<tr><th>Fornitore principale</th><td><?php $sel('primary', $s['primary'], $labels); ?></td></tr>
				<tr><th>Fornitore di riserva</th><td><?php $sel('fallback', $s['fallback'], array('none' => 'Nessuno') + $labels); ?>
					<p class="description">Usato in automatico se il principale dà errore.</p></td></tr>
			</table>

			<h2>Google Gemini</h2>
			<table class="form-table" role="presentation">
				<tr><th>Chiave API</th><td>
					<input type="password" class="regular-text" autocomplete="new-password" name="<?php echo esc_attr($opt); ?>[gemini_key]" placeholder="<?php echo $s['gemini_key'] ? 'Salvata (…' . esc_attr(substr($s['gemini_key'], -4)) . ') – lascia vuoto per non cambiarla' : 'Incolla la chiave da aistudio.google.com'; ?>">
					<?php if ($s['gemini_key']) : ?><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[gemini_key_clear]" value="1"> cancella</label><?php endif; ?>
					<p class="description">Per i test va bene la chiave gratuita di Google AI Studio (limiti giornalieri bassi e i dati possono essere usati da Google). In produzione attiva la fatturazione.</p>
				</td></tr>
				<tr><th>Modello</th><td><input type="text" class="regular-text" name="<?php echo esc_attr($opt); ?>[gemini_model]" value="<?php echo esc_attr($s['gemini_model']); ?>"></td></tr>
			</table>

			<h2>fal.ai (FLUX Kontext, Seedream, Qwen Image Edit…)</h2>
			<table class="form-table" role="presentation">
				<tr><th>Chiave API</th><td>
					<input type="password" class="regular-text" autocomplete="new-password" name="<?php echo esc_attr($opt); ?>[fal_key]" placeholder="<?php echo $s['fal_key'] ? 'Salvata (…' . esc_attr(substr($s['fal_key'], -4)) . ') – lascia vuoto per non cambiarla' : 'Chiave da fal.ai/dashboard/keys'; ?>">
					<?php if ($s['fal_key']) : ?><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[fal_key_clear]" value="1"> cancella</label><?php endif; ?>
				</td></tr>
				<tr><th>Modello</th><td><input type="text" class="regular-text" name="<?php echo esc_attr($opt); ?>[fal_model]" value="<?php echo esc_attr($s['fal_model']); ?>">
					<p class="description">Esempi: <code>fal-ai/flux-pro/kontext</code>, <code>fal-ai/qwen-image-edit</code>, <code>fal-ai/bytedance/seedream/v4/edit</code>. Controlla il nome esatto sulla pagina del modello su fal.ai.</p></td></tr>
			</table>

			<h2>Prompt</h2>
			<p><strong>Fedele</strong> (predefinito per il cliente): conversione di stile che blocca posa, espressione e composizione.</p>
			<textarea name="<?php echo esc_attr($opt); ?>[prompt]" rows="7" class="large-text code"><?php echo esc_textarea($s['prompt']); ?></textarea>
			<p><strong>Stilizzato</strong>: semplifica di più, utile per sfondi, paesaggi e oggetti.</p>
			<textarea name="<?php echo esc_attr($opt); ?>[prompt_stylized]" rows="5" class="large-text code"><?php echo esc_textarea($s['prompt_stylized']); ?></textarea>
			<p><strong>Anime</strong> (atmosfera da film d'animazione giapponese classico, resa a colori piatti stampabili)
				<label style="margin-left:12px"><input type="checkbox" name="<?php echo esc_attr($opt); ?>[style_anime]" value="1" <?php checked($s['style_anime'], 1); ?>> mostra questa scelta ai clienti</label></p>
			<textarea name="<?php echo esc_attr($opt); ?>[prompt_anime]" rows="7" class="large-text code"><?php echo esc_textarea($s['prompt_anime']); ?></textarea>
			<p class="description">Il prompt descrive lo stile senza nominare artisti o studi: alcuni modelli rifiutano i nomi, e non usarli evita problemi di marchio.</p>
			<p class="description">In inglese i modelli rispondono meglio. Le scritte le aggiunge il configuratore, quindi nel prompt chiedi "no text". Per tornare al testo predefinito svuota il campo e salva.</p>

			<h2>Limiti anti-abuso</h2>
			<table class="form-table" role="presentation">
				<tr><th>Ridisegni per visitatore al giorno</th><td><input type="number" min="0" name="<?php echo esc_attr($opt); ?>[per_ip_day]" value="<?php echo (int) $s['per_ip_day']; ?>"> <span class="description">(per indirizzo IP; 0 = nessun limite)</span></td></tr>
				<tr><th>Tetto giornaliero totale</th><td><input type="number" min="0" name="<?php echo esc_attr($opt); ?>[daily_cap]" value="<?php echo (int) $s['daily_cap']; ?>"> <span class="description">(blocca tutto oltre questa soglia: protegge il budget; 0 = nessun limite, il contatore conta comunque)</span></td></tr>
			</table>
			<h2>Disco predefinito</h2>
			<p class="description">Come si presenta il disco quando un cliente apre il configuratore. Il cliente poi può cambiare tutto.</p>
			<table class="form-table" role="presentation">
				<tr><th>Colore della banda</th><td><input type="color" name="<?php echo esc_attr($opt); ?>[def_band]" value="<?php echo esc_attr($s['def_band']); ?>">
					<span class="description">Con il catalogo filamenti attivo viene usata la bobina più vicina.</span></td></tr>
				<tr><th>Colore delle scritte</th><td><input type="color" name="<?php echo esc_attr($opt); ?>[def_text_color]" value="<?php echo esc_attr($s['def_text_color']); ?>"></td></tr>
				<tr><th>Testi sulla banda</th><td>
					<div style="display:grid;grid-template-columns:repeat(2,minmax(160px,240px));gap:8px">
						<label>Testo 1 – in alto a sinistra<br><input type="text" maxlength="14" name="<?php echo esc_attr($opt); ?>[def_tl]" value="<?php echo esc_attr($s['def_tl']); ?>" style="width:100%"></label>
						<label>Testo 2 – in alto a destra<br><input type="text" maxlength="14" name="<?php echo esc_attr($opt); ?>[def_tr]" value="<?php echo esc_attr($s['def_tr']); ?>" style="width:100%"></label>
						<label>Testo 3 – in basso a sinistra<br><input type="text" maxlength="10" name="<?php echo esc_attr($opt); ?>[def_bl]" value="<?php echo esc_attr($s['def_bl']); ?>" style="width:100%"></label>
						<label>Testo 4 – in basso a destra<br><input type="text" maxlength="10" name="<?php echo esc_attr($opt); ?>[def_br]" value="<?php echo esc_attr($s['def_br']); ?>" style="width:100%"></label>
					</div>
					<p class="description">Lascia vuoto un testo per non mostrarlo.</p></td></tr>
			</table>

			<h2>Disegni pronti</h2>
			<table class="form-table" role="presentation">
				<tr><th>Galleria nel configuratore</th><td><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[templates_enabled]" value="1" <?php checked($s['templates_enabled'], 1); ?>> Mostra il pulsante "Scegli un disegno pronto"</label>
					<p class="description">I disegni si gestiscono in <a href="<?php echo esc_url(admin_url('edit.php?post_type=flc_template')); ?>">Francy Lamp Factory → Disegni pronti</a>. Se togli la spunta, i clienti non li vedono.</p></td></tr>
			</table>

			<h2>Convalida dei dischi</h2>
			<table class="form-table" role="presentation">
				<tr><th>Invii per visitatore al giorno</th><td><input type="number" min="0" name="<?php echo esc_attr($opt); ?>[submit_per_ip]" value="<?php echo (int) $s['submit_per_ip']; ?>"> <span class="description">(anti-spam; 0 = nessun limite)</span></td></tr>
				<tr><th>Email per le notifiche</th><td><input type="email" class="regular-text" name="<?php echo esc_attr($opt); ?>[notify_email]" value="<?php echo esc_attr($s['notify_email']); ?>" placeholder="<?php echo esc_attr(get_option('admin_email')); ?>">
					<p class="description">Ti arriva una mail a ogni disco convalidato. Vuoto = email dell'amministratore.</p></td></tr>
				<tr><th>Limiti di upload del server</th><td>
					<?php
					$up   = wp_convert_hr_to_bytes(ini_get('upload_max_filesize'));
					$post = wp_convert_hr_to_bytes(ini_get('post_max_size'));
					$ok   = min($up, $post) >= 32 * MB_IN_BYTES;
					?>
					<span style="color:<?php echo $ok ? '#00a32a' : '#d63638'; ?>;font-weight:600">
						upload_max_filesize <?php echo esc_html(ini_get('upload_max_filesize')); ?> · post_max_size <?php echo esc_html(ini_get('post_max_size')); ?>
					</span>
					<p class="description">Ogni invio pesa circa 5–20 MB (foto originale, anteprime, STL compressi). <?php echo $ok ? 'I limiti vanno bene.' : 'Consigliato almeno 32M per entrambi: chiedi all\'hosting di alzarli (php.ini o pannello).'; ?></p>
				</td></tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<h2>Utilizzo ultimi 30 giorni</h2>
		<?php if (!$log) : ?>
			<p>Ancora nessun ridisegno.</p>
		<?php else : ?>
			<table class="widefat striped" style="max-width:640px">
				<thead><tr><th>Giorno</th><th>Riusciti</th><th>Errori</th><th>Per fornitore</th></tr></thead>
				<tbody>
				<?php foreach (array_reverse($log, true) as $day => $row) : ?>
					<tr>
						<td><?php echo esc_html($day); ?></td>
						<td><?php echo (int) ($row['ok'] ?? 0); ?></td>
						<td><?php echo (int) ($row['err'] ?? 0); ?></td>
						<td><?php
							$parts = array();
							foreach ($row['by'] ?? array() as $prov => $n) {
								$parts[] = esc_html($prov) . ': ' . (int) $n;
							}
							echo implode(', ', $parts);
						?></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>
	</div>
	<?php
}

// Log giornaliero compatto (ultimi 30 giorni) salvato in un'opzione
function flc_usage_log() {
	$log = get_option('flc_usage', array());
	return is_array($log) ? $log : array();
}

function flc_log_usage($ok, $provider = '') {
	$log = flc_usage_log();
	$day = current_time('Y-m-d');
	if (!isset($log[$day])) {
		$log[$day] = array('ok' => 0, 'err' => 0, 'by' => array());
	}
	$log[$day][$ok ? 'ok' : 'err']++;
	if ($ok && $provider) {
		$log[$day]['by'][$provider] = ($log[$day]['by'][$provider] ?? 0) + 1;
	}
	ksort($log);
	$log = array_slice($log, -30, null, true);
	update_option('flc_usage', $log, false);
}

function flc_today_count() {
	$log = flc_usage_log();
	$day = current_time('Y-m-d');
	return (int) ($log[$day]['ok'] ?? 0) + (int) ($log[$day]['err'] ?? 0);
}
