<?php
// Endpoint REST: POST /wp-json/francy-lamp/v1/ridisegna  { image: "data:image/jpeg;base64,..." }
// Risposta: { image: "data:image/png;base64,...", remaining: n, provider: "gemini" }
// L'immagine non viene salvata sul server: entra, va al fornitore, torna al browser.

if (!defined('ABSPATH')) {
	exit;
}

const FLC_MAX_UPLOAD = 4 * 1024 * 1024; // 4 MB (il browser manda già un JPEG 1024x1024)

add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/ridisegna', array(
		'methods'             => 'POST',
		'callback'            => 'flc_rest_redraw',
		'permission_callback' => 'flc_rest_permission',
	));
	// Contatori del giorno: quanti ridisegni restano al visitatore e al sito
	register_rest_route('francy-lamp/v1', '/stato', array(
		'methods'             => 'GET',
		'callback'            => function () { return flc_quota_status(); },
		'permission_callback' => 'flc_rest_permission',
	));
});

// used/limit/remaining per il visitatore e per tutto il sito (limit 0 = illimitato, remaining null)
function flc_quota_status() {
	$s      = flc_settings();
	$ipUsed = (int) get_transient(flc_client_key());
	$glUsed = flc_today_count();
	$q      = function ($used, $limit) {
		return array(
			'used'      => $used,
			'limit'     => (int) $limit,
			'remaining' => $limit > 0 ? max(0, $limit - $used) : null,
		);
	};
	return array('user' => $q($ipUsed, $s['per_ip_day']), 'global' => $q($glUsed, $s['daily_cap']));
}

function flc_rest_permission(WP_REST_Request $req) {
	// Il nonce viene stampato dallo shortcode: blocca le chiamate dirette da fuori dal sito
	$nonce = $req->get_header('x_wp_nonce');
	if (!$nonce || !wp_verify_nonce($nonce, 'wp_rest')) {
		return new WP_Error('flc_nonce', 'Sessione scaduta, ricarica la pagina.', array('status' => 403));
	}
	return true;
}

function flc_client_key() {
	// IP anonimizzato con hash: serve solo per il limite giornaliero
	$ip = $_SERVER['REMOTE_ADDR'] ?? '';
	return 'flc_ip_' . md5(wp_salt('nonce') . $ip . current_time('Y-m-d'));
}

function flc_rest_redraw(WP_REST_Request $req) {
	$s = flc_settings();
	if (empty($s['enabled'])) {
		return new WP_Error('flc_off', 'Il ridisegno con IA non è attivo.', array('status' => 503));
	}

	// Limiti
	if ($s['daily_cap'] > 0 && flc_today_count() >= $s['daily_cap']) {
		return new WP_Error('flc_cap', 'Servizio di ridisegno momentaneamente esaurito per oggi, riprova domani.', array('status' => 429, 'quota' => flc_quota_status()));
	}
	$key  = flc_client_key();
	$used = (int) get_transient($key);
	if ($s['per_ip_day'] > 0 && $used >= $s['per_ip_day']) {
		return new WP_Error('flc_limit', 'Hai usato tutti i ridisegni di oggi. Puoi comunque continuare a personalizzare la lampada.', array('status' => 429, 'quota' => flc_quota_status()));
	}

	// Immagine
	$dataUri = (string) $req->get_param('image');
	if (!preg_match('#^data:(image/(?:jpeg|png|webp));base64,(.+)$#s', $dataUri, $m)) {
		return new WP_Error('flc_bad', 'Immagine non valida.', array('status' => 400));
	}
	$mime = $m[1];
	$bin  = base64_decode($m[2], true);
	if ($bin === false || strlen($bin) > FLC_MAX_UPLOAD || !@getimagesizefromstring($bin)) {
		return new WP_Error('flc_bad', 'Immagine non valida o troppo grande.', array('status' => 400));
	}

	// Le IA ci mettono 10–60 s: sugli hosting con limite PHP a 30 s la richiesta verrebbe troncata
	if (function_exists('set_time_limit')) {
		@set_time_limit(420);
	}

	// Il tentativo conta anche se poi fallisce (evita raffiche di richieste)
	set_transient($key, $used + 1, DAY_IN_SECONDS);

	// Stile scelto dal cliente: fedele (predefinito), ritratto, tombino o anime; sfondo: -1 = lascia quello dell'immagine
	$bg  = $req->get_param('bg');
	// formato dell'immagine mandata (la foto intera): il ridisegno torna nello stesso formato
	$aspect = (string) $req->get_param('aspect');
	if (in_array($aspect, array('1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'), true)) {
		$s['aspect'] = $aspect;
	}
	// carta da gioco: via cornice, testi e simboli; si lavora in formato quadrato
	if ($req->get_param('card') && !empty($s['card_enabled'])) {
		$s['card']   = true;
		$s['aspect'] = '1:1';
	}
	// sfondo scritto dal cliente ("Personalizza…")
	if ($bg === 'custom' && !empty($s['bg_enabled']) && !empty($s['bg_custom'])) {
		$s['bg_custom_text'] = (string) $req->get_param('bg_text');
	}
	$gen = flc_generate($bin, $mime, (string) $req->get_param('style'), $s, is_numeric($bg) ? (int) $bg : -1);
	if (!is_wp_error($gen)) {
		$quota = flc_quota_status();
		return array(
			'image'     => 'data:' . $gen['mime'] . ';base64,' . base64_encode($gen['data']),
			'provider'  => $gen['provider'],
			'remaining' => $quota['user']['remaining'],
			'quota'     => $quota,
		);
	}
	$errors = $gen->get_error_data()['errors'] ?? array($gen->get_error_message());

	flc_log_usage(false);
	error_log('[francy-lamp] ridisegno fallito: ' . implode(' | ', $errors));
	$msg = 'Il ridisegno non è riuscito, riprova tra poco.';
	if (strpos(implode(' ', $errors), 'non ha restituito') !== false) {
		$msg = "L'IA non è riuscita a ridisegnare questa immagine: prova con un altro stile, senza cambiare lo sfondo o con un'altra foto.";
	}
	if (current_user_can('manage_options')) {
		$msg .= ' Dettagli (visibili solo agli admin): ' . implode(' | ', $errors);
	}
	return new WP_Error('flc_fail', $msg, array('status' => 502, 'quota' => flc_quota_status()));
}

function flc_prompt_for_style($style, $s) {
	if ($style === 'anime' && !empty($s['style_anime'])) {
		return $s['prompt_anime'];
	}
	if ($style === 'ritratto' && !empty($s['style_ritratto'])) {
		return $s['prompt_ritratto'];
	}
	if ($style === 'tombino' && !empty($s['style_tombino'])) {
		return $s['prompt_tombino'];
	}
	return $style === 'stilizzato' ? $s['prompt_stylized'] : $s['prompt']; // "stilizzato": vecchie pagine ancora in cache
}

// Ridisegno con il fornitore principale e, se fallisce, con quello di riserva.
// Ritorna array(mime, data, provider) oppure WP_Error con la lista degli errori in data['errors'].
function flc_generate($bin, $mime, $style, $s, $bg = -1) {
	$prompt    = flc_prompt_for_style($style, $s);
	// carta da gioco: prima si pulisce la carta (via cornice e scritte), poi si applica lo stile all'illustrazione
	if (!empty($s['card'])) {
		$prompt = $s['prompt_card'] . "\n\nThen redraw that cleaned artwork following these instructions (where they talk about the framing of the input, use the cleaned artwork filling the square):\n\n" . $prompt;
	}
	$bgs       = flc_backgrounds($s);
	if (!empty($s['bg_enabled']) && $bg >= 0 && isset($bgs[$bg])) {
		$prompt .= flc_background_instruction($bgs[$bg]);
	} elseif (!empty($s['bg_custom_text'])) {
		$prompt .= flc_background_custom_instruction($s['bg_custom_text']);
	}
	$providers = flc_providers();
	$order     = array($s['primary']);
	if ($s['fallback'] !== 'none' && $s['fallback'] !== $s['primary']) {
		$order[] = $s['fallback'];
	}
	$errors = array();
	foreach ($order as $p) {
		if (empty($providers[$p])) {
			continue;
		}
		$out = call_user_func($providers[$p]['run'], $bin, $mime, $prompt, $s);
		if (is_wp_error($out)) {
			$errors[] = $out->get_error_message();
			continue;
		}
		if (empty($out['data']) || !@getimagesizefromstring($out['data'])) {
			$errors[] = $p . ': risposta non valida';
			continue;
		}
		flc_log_usage(true, $p);
		return array('mime' => $out['mime'], 'data' => $out['data'], 'provider' => $p);
	}
	return new WP_Error('flc_fail', implode(' | ', $errors), array('errors' => $errors));
}
