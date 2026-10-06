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

// Stile vetrata da cattedrale: perfetto per una lampada retroilluminata (tessere di colore + piombature nere)
function flc_default_prompt_vetrata() {
	return 'Turn the attached image into a stained glass window artwork, like a cathedral window. '
		. 'Keep the same subject, pose and composition, and keep the subject clearly recognisable with its own colors and markings. '
		. 'Build the whole picture from pieces of colored glass separated by thick black lines of uniform width, like the lead lines of a real stained glass window. '
		. 'The subject is made of large glass pieces that follow its shapes. The background is made of clean geometric glass pieces: straight-edged polygons, triangles and long shards radiating outward from the subject. '
		. 'No flowers, no leaves, no petals, no vines, no floral or plant ornaments. '
		. 'Every glass piece is one flat solid color with no shading and no texture. Rich jewel colors matching the original, at most 10 colors. '
		. 'Pieces must be large, no tiny fragments. No text, no frame. Fill the whole square canvas; it will be cropped to a circle.';
}

// Sfondi proposti al cliente quando sceglie "Rimuovi lo sfondo": una riga per sfondo, "Etichetta | descrizione in inglese"
function flc_default_backgrounds() {
	return implode("\n", array(
		'Bianco (luce piena) | a plain pure white empty background, nothing else: no shadow, no ground, no objects',
		'Vetrata da cattedrale | a geometric stained glass mosaic made only of straight-edged angular pieces (triangles, trapezoids, long shards) radiating outward from the subject like sun rays, in jewel tones (deep blue, ruby red, amber, emerald green) separated by thick black lines, each piece one flat color, with no flowers, leaves, petals or floral shapes',
		'Cielo stile anime | a stylised anime sky: deep blue sky with a few large bold white cumulus clouds, flat solid colors with black outlines',
		'Raggi di luce | a sunburst of wide straight rays radiating from behind the subject, alternating two flat warm colors, separated by black lines',
		'Onde giapponesi | a traditional Japanese seigaiha wave pattern (overlapping concentric arcs) in two or three flat blue tones with black outlines',
		'Tinta unita | a single flat solid color that complements the subject, nothing else',
	));
}

// Elenco sfondi: array di array('label' => ..., 'prompt' => ...)
function flc_backgrounds($s = null) {
	$s   = $s ?: flc_settings();
	$out = array();
	foreach (preg_split('/\r?\n/', (string) $s['backgrounds']) as $line) {
		$parts = array_map('trim', explode('|', $line, 2));
		if (count($parts) === 2 && $parts[0] !== '' && $parts[1] !== '') {
			$out[] = array('label' => $parts[0], 'prompt' => $parts[1]);
		}
	}
	return $out;
}

// Istruzione aggiunta al prompt quando il cliente rimuove lo sfondo
function flc_background_instruction($bg) {
	return "\n\nBackground: replace the original background (everything that is not the main subject) with " . $bg['prompt'] . '. '
		. 'The main subject stays as described above, large and centered, with a black outline around it.';
}

// Stile anime: atmosfera da film d'animazione giapponese classico, ma resa stampabile (colori piatti + contorni)
function flc_default_prompt_anime() {
	return 'Redraw the attached image in the visual style of the Japanese anime film "Your Name" (Kimi no Na wa, 2016, directed by Makoto Shinkai): '
		. 'clean modern anime character design with large expressive eyes with highlights and finely drawn hair, luminous dreamy atmosphere, '
		. 'vivid saturated colors (deep blue sky, warm sunset orange and pink, bright highlights), cinematic and emotional mood. '
		. 'Keep the same subject, pose, composition and recognisable features (for a person: face shape, eyes, eyebrows, smile, hairstyle, hair and skin color, expression; '
		. 'for an animal or character: its markings, colors and expression). '
		. 'IMPORTANT, this will be 3D printed in flat colors: translate that look into flat solid cel-shaded colors ONLY (at most 10 colors, at most two tones per area), '
		. 'clean thick uniform black outlines around every shape, no gradients, no lens flare, no glow, no light rays, no blur, no film grain. '
		. 'Simplify the background into a few large flat shapes (for example a stylised sky with a few bold clouds). No text, no letters, no frame or border. '
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
		'prompt_vetrata' => '',
		'backgrounds'  => '',
		'bg_enabled'   => 1,
		'style_anime' => 1,
		'examples_enabled' => 1,
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
		'sl_mode'      => 'outline',
		'sl_colors'    => 10,
		'sl_line'      => 1.2,
		'sl_add'       => 1,
		'sl_thick'     => 0.15,
		'sl_smooth'    => 2,
		'sl_feat'      => 0.8,
		'sl_area'      => 4,
		'sl_ppmm'      => 5,
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
	// prima versione del prompt Vetrata (faceva rosoni a fiori e veniva rifiutato spesso da Gemini)
	if (trim((string) $s['prompt_vetrata']) === '' || md5(trim((string) $s['prompt_vetrata'])) === 'f8f8d0135758c19deefd4e49764a9b7c') {
		$s['prompt_vetrata'] = flc_default_prompt_vetrata();
	}
	if (trim((string) $s['backgrounds']) === '') {
		$s['backgrounds'] = flc_default_backgrounds();
	}
	// vecchio sfondo "Vetrata da cattedrale" a rosone: sostituito con quello geometrico
	$s['backgrounds'] = preg_replace('/^Vetrata da cattedrale \\| a Gothic cathedral stained glass mosaic.*$/m', explode("\n", flc_default_backgrounds())[1], $s['backgrounds']);
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
		'prompt_vetrata' => sanitize_textarea_field($in['prompt_vetrata'] ?? ''),
		'backgrounds'  => sanitize_textarea_field($in['backgrounds'] ?? ''),
		'bg_enabled'   => empty($in['bg_enabled']) ? 0 : 1,
		'style_anime' => empty($in['style_anime']) ? 0 : 1,
		'examples_enabled' => empty($in['examples_enabled']) ? 0 : 1,
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
		'sl_mode'      => ($in['sl_mode'] ?? '') === 'keep' ? 'keep' : 'outline',
		'sl_colors'    => min(13, max(2, (int) ($in['sl_colors'] ?? $d['sl_colors']))),
		'sl_line'      => min(2.5, max(0.6, round((float) ($in['sl_line'] ?? $d['sl_line']), 1))),
		'sl_add'       => empty($in['sl_add']) ? 0 : 1,
		'sl_thick'     => min(1, max(0, round((float) ($in['sl_thick'] ?? $d['sl_thick']), 2))),
		'sl_smooth'    => min(4, max(0, (int) ($in['sl_smooth'] ?? $d['sl_smooth']))),
		'sl_feat'      => min(2.5, max(0.4, round((float) ($in['sl_feat'] ?? $d['sl_feat']), 1))),
		'sl_area'      => min(20, max(0.5, round((float) ($in['sl_area'] ?? $d['sl_area']) * 2) / 2)),
		'sl_ppmm'      => min(8, max(3, (int) ($in['sl_ppmm'] ?? $d['sl_ppmm']))),
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
	if ($out['prompt_vetrata'] === flc_default_prompt_vetrata()) {
		$out['prompt_vetrata'] = '';
	}
	if (str_replace("\r", '', $out['backgrounds']) === flc_default_backgrounds()) {
		$out['backgrounds'] = '';
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
			<p><strong>Vetrata</strong>: vetrata da cattedrale, tessere di colore pieno divise da piombature nere (rende benissimo retroilluminata).</p>
			<textarea name="<?php echo esc_attr($opt); ?>[prompt_vetrata]" rows="7" class="large-text code"><?php echo esc_textarea($s['prompt_vetrata']); ?></textarea>
			<p><strong>Anime</strong> (atmosfera da film d'animazione giapponese classico, resa a colori piatti stampabili)
				<label style="margin-left:12px"><input type="checkbox" name="<?php echo esc_attr($opt); ?>[style_anime]" value="1" <?php checked($s['style_anime'], 1); ?>> mostra questa scelta ai clienti</label></p>
			<textarea name="<?php echo esc_attr($opt); ?>[prompt_anime]" rows="7" class="large-text code"><?php echo esc_textarea($s['prompt_anime']); ?></textarea>
			<p><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[examples_enabled]" value="1" <?php checked($s['examples_enabled'], 1); ?>> Mostra ai clienti gli esempi dei 3 stili</label>
				– si generano in <a href="<?php echo esc_url(admin_url('edit.php?post_type=flc_design&page=flc-esempi')); ?>">Francy Lamp Factory → Esempi stili</a></p>
						<p class="description">Il nome del film resta solo nel prompt (il cliente vede "Anime"). Il prompt descrive anche le caratteristiche dello stile, così funziona anche se il modello ignora il nome.</p>
			<h2>Sfondo</h2>
			<p><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[bg_enabled]" value="1" <?php checked($s['bg_enabled'], 1); ?>> Mostra ai clienti l'interruttore <strong>Rimuovi lo sfondo</strong> con la scelta del nuovo sfondo</label></p>
			<p>Sfondi proposti, uno per riga: <code>Nome che vede il cliente | descrizione in inglese per l'IA</code>. Il primo è quello scelto in partenza.</p>
			<textarea name="<?php echo esc_attr($opt); ?>[backgrounds]" rows="7" class="large-text code"><?php echo esc_textarea($s['backgrounds']); ?></textarea>
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

			<h2>Regolazioni predefinite</h2>
			<p class="description">I valori di partenza degli slider nel configuratore (il cliente può sempre cambiarli).</p>
			<table class="form-table" role="presentation">
				<tr><th>Modalità iniziale</th><td><select name="<?php echo esc_attr($opt); ?>[sl_mode]">
					<option value="outline" <?php selected($s['sl_mode'], 'outline'); ?>>Foto / disegno (creo io i contorni neri)</option>
					<option value="keep" <?php selected($s['sl_mode'], 'keep'); ?>>Grafica pronta (contorni neri già presenti)</option>
				</select><p class="description">Dopo un ridisegno con l'IA si passa comunque a "Grafica pronta".</p></td></tr>
				<tr><th>Colori</th><td><input type="number" min="2" max="13" step="1" name="<?php echo esc_attr($opt); ?>[sl_colors]" value="<?php echo esc_attr($s['sl_colors']); ?>" style="width:90px"> <span class="description">2–13, nero compreso (il limite totale di 13 con bianco, banda e scritte resta comunque)</span></td></tr>
				<tr><th>Spessore contorni (mm)</th><td><input type="number" min="0.6" max="2.5" step="0.1" name="<?php echo esc_attr($opt); ?>[sl_line]" value="<?php echo esc_attr($s['sl_line']); ?>" style="width:90px"> <span class="description">contorni neri creati dal configuratore</span></td></tr>
				<tr><th>Contorni mancanti</th><td><label><input type="checkbox" name="<?php echo esc_attr($opt); ?>[sl_add]" value="1" <?php checked($s['sl_add'], 1); ?>> In "Grafica pronta" aggiungi i contorni neri dove mancano</label></td></tr>
				<tr><th>Ingrossa il nero (mm)</th><td><input type="number" min="0" max="1" step="0.05" name="<?php echo esc_attr($opt); ?>[sl_thick]" value="<?php echo esc_attr($s['sl_thick']); ?>" style="width:90px"> <span class="description">solo "Grafica pronta"</span></td></tr>
				<tr><th>Semplificazione</th><td><input type="number" min="0" max="4" step="1" name="<?php echo esc_attr($opt); ?>[sl_smooth]" value="<?php echo esc_attr($s['sl_smooth']); ?>" style="width:90px"> <span class="description">0 = nessuna, 4 = molto forte</span></td></tr>
				<tr><th>Dettaglio minimo (mm)</th><td><input type="number" min="0.4" max="2.5" step="0.1" name="<?php echo esc_attr($opt); ?>[sl_feat]" value="<?php echo esc_attr($s['sl_feat']); ?>" style="width:90px"> <span class="description">zone più strette diventano nere</span></td></tr>
				<tr><th>Area minima zona (mm²)</th><td><input type="number" min="0.5" max="20" step="0.5" name="<?php echo esc_attr($opt); ?>[sl_area]" value="<?php echo esc_attr($s['sl_area']); ?>" style="width:90px"> <span class="description">zone più piccole vengono assorbite</span></td></tr>
				<tr><th>Risoluzione (px/mm)</th><td><input type="number" min="3" max="8" step="1" name="<?php echo esc_attr($opt); ?>[sl_ppmm]" value="<?php echo esc_attr($s['sl_ppmm']); ?>" style="width:90px"> <span class="description">più alta = più dettaglio, più lenta</span></td></tr>
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
