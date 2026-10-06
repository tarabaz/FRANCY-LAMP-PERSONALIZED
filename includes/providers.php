<?php
// Adattatori per i fornitori di image editing. Ognuno riceve l'immagine (binario + mime) e il prompt
// e ritorna array('mime' => ..., 'data' => binario) oppure WP_Error.
// Per aggiungere un fornitore: una funzione qui + una voce in flc_providers().

if (!defined('ABSPATH')) {
	exit;
}

function flc_providers() {
	return array(
		'gemini' => array('label' => 'Google Gemini', 'run' => 'flc_run_gemini'),
		'fal'    => array('label' => 'fal.ai', 'run' => 'flc_run_fal'),
	);
}

function flc_http_error($res, $who) {
	if (is_wp_error($res)) {
		return new WP_Error('flc_http', $who . ': ' . $res->get_error_message());
	}
	$code = wp_remote_retrieve_response_code($res);
	$body = wp_remote_retrieve_body($res);
	$msg  = '';
	$j    = json_decode($body, true);
	if (is_array($j)) {
		$msg = $j['error']['message'] ?? ($j['detail'] ?? ($j['message'] ?? ''));
		if (is_array($msg)) {
			$msg = wp_json_encode($msg);
		}
	}
	return new WP_Error('flc_http', sprintf('%s: HTTP %d %s', $who, $code, substr((string) $msg, 0, 1200)));
}

// --- Google Gemini (API generateContent con immagine in input e in output) ---
function flc_run_gemini($image, $mime, $prompt, $s) {
	if (empty($s['gemini_key'])) {
		return new WP_Error('flc_config', 'Gemini: chiave API mancante');
	}
	$model = rawurlencode($s['gemini_model'] ?: 'gemini-2.5-flash-image');
	$url   = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent";
	$body  = array(
		'contents'         => array(array(
			'parts' => array(
				array('text' => $prompt),
				array('inline_data' => array('mime_type' => $mime, 'data' => base64_encode($image))),
			),
		)),
		'generationConfig' => array(
			'responseModalities' => array('TEXT', 'IMAGE'),
			'imageConfig'        => array('aspectRatio' => '1:1'),
		),
	);
	$res = wp_remote_post($url, array(
		'timeout' => 120,
		'headers' => array('Content-Type' => 'application/json', 'x-goog-api-key' => $s['gemini_key']),
		'body'    => wp_json_encode($body),
	));
	if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
		return flc_http_error($res, 'Gemini');
	}
	$j = json_decode(wp_remote_retrieve_body($res), true);
	foreach ($j['candidates'][0]['content']['parts'] ?? array() as $part) {
		$inline = $part['inlineData'] ?? ($part['inline_data'] ?? null);
		if ($inline && !empty($inline['data'])) {
			return array(
				'mime' => $inline['mimeType'] ?? ($inline['mime_type'] ?? 'image/png'),
				'data' => base64_decode($inline['data']),
			);
		}
	}
	$reason = $j['candidates'][0]['finishReason'] ?? ($j['promptFeedback']['blockReason'] ?? 'nessuna immagine');
	return new WP_Error('flc_empty', 'Gemini non ha restituito un\'immagine (' . $reason . ')');
}

// --- fal.ai (endpoint sincrono, vale per FLUX Kontext, Qwen Image Edit, Seedream edit…) ---
function flc_run_fal($image, $mime, $prompt, $s) {
	if (empty($s['fal_key'])) {
		return new WP_Error('flc_config', 'fal.ai: chiave API mancante');
	}
	$model   = trim($s['fal_model'] ?: 'fal-ai/flux-pro/kontext', '/');
	$dataUri = 'data:' . $mime . ';base64,' . base64_encode($image);
	$body    = array('prompt' => $prompt);
	// Alcuni modelli (es. Seedream edit) vogliono una lista di immagini, gli altri una sola
	if (strpos($model, 'seedream') !== false) {
		$body['image_urls'] = array($dataUri);
	} else {
		$body['image_url'] = $dataUri;
	}
	$res = wp_remote_post('https://fal.run/' . $model, array(
		'timeout' => 120,
		'headers' => array('Content-Type' => 'application/json', 'Authorization' => 'Key ' . $s['fal_key']),
		'body'    => wp_json_encode($body),
	));
	if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
		return flc_http_error($res, 'fal.ai');
	}
	$j   = json_decode(wp_remote_retrieve_body($res), true);
	$url = $j['images'][0]['url'] ?? ($j['image']['url'] ?? '');
	if (!$url) {
		return new WP_Error('flc_empty', 'fal.ai non ha restituito un\'immagine');
	}
	if (strpos($url, 'data:') === 0) {
		list($meta, $b64) = explode(',', $url, 2);
		return array('mime' => preg_replace('/^data:([^;]+).*$/', '$1', $meta), 'data' => base64_decode($b64));
	}
	$img = wp_remote_get($url, array('timeout' => 60));
	if (is_wp_error($img) || wp_remote_retrieve_response_code($img) !== 200) {
		return flc_http_error($img, 'fal.ai (download)');
	}
	return array(
		'mime' => wp_remote_retrieve_header($img, 'content-type') ?: 'image/png',
		'data' => wp_remote_retrieve_body($img),
	);
}
