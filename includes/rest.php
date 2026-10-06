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
		@set_time_limit(180);
	}

	// Il tentativo conta anche se poi fallisce (evita raffiche di richieste)
	set_transient($key, $used + 1, DAY_IN_SECONDS);

	// Modalità scelta dal cliente: fedele al soggetto (predefinita) o più stilizzata
	$style     = (string) $req->get_param('style');
	if ($style === 'anime' && !empty($s['style_anime'])) {
		$prompt = $s['prompt_anime'];
	} elseif ($style === 'stilizzato') {
		$prompt = $s['prompt_stylized'];
	} else {
		$prompt = $s['prompt'];
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
		$quota = flc_quota_status();
		return array(
			'image'     => 'data:' . $out['mime'] . ';base64,' . base64_encode($out['data']),
			'provider'  => $p,
			'remaining' => $quota['user']['remaining'],
			'quota'     => $quota,
		);
	}

	flc_log_usage(false);
	error_log('[francy-lamp] ridisegno fallito: ' . implode(' | ', $errors));
	$msg = 'Il ridisegno non è riuscito, riprova tra poco.';
	if (current_user_can('manage_options')) {
		$msg .= ' Dettagli (visibili solo agli admin): ' . implode(' | ', $errors);
	}
	return new WP_Error('flc_fail', $msg, array('status' => 502, 'quota' => flc_quota_status()));
}
