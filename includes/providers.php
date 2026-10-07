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

// --- Elenco dei modelli Gemini che generano immagini (per sceglierli dalle impostazioni) ---
// Chiede a Google la lista aggiornata (endpoint models) e tiene solo quelli "image" che funzionano con
// generateContent, cioè quelli che ricevono la foto e restituiscono un'immagine. Risultato in cache 12 ore.
const FLC_MODELS_CACHE = 'flc_gemini_models';

function flc_gemini_models($refresh = false) {
	$cached = get_transient(FLC_MODELS_CACHE);
	if (!$refresh && is_array($cached)) {
		return $cached;
	}
	$s = flc_settings();
	if (empty($s['gemini_key'])) {
		return new WP_Error('flc_config', 'Salva prima la chiave API di Gemini.');
	}
	$models = array();
	$token  = '';
	for ($page = 0; $page < 10; $page++) {
		$url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' . ($token ? '&pageToken=' . rawurlencode($token) : '');
		$res = wp_remote_get($url, array('timeout' => 30, 'headers' => array('x-goog-api-key' => $s['gemini_key'])));
		if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
			return flc_http_error($res, 'Gemini (elenco modelli)');
		}
		$j = json_decode(wp_remote_retrieve_body($res), true);
		foreach ($j['models'] ?? array() as $m) {
			$id      = preg_replace('#^models/#', '', (string) ($m['name'] ?? ''));
			$methods = $m['supportedGenerationMethods'] ?? array();
			if ($id === '' || stripos($id, 'image') === false || !in_array('generateContent', $methods, true)) {
				continue;
			}
			$models[] = array(
				'id'          => $id,
				'name'        => (string) ($m['displayName'] ?? $id),
				'version'     => (string) ($m['version'] ?? ''),
				'description' => wp_trim_words((string) ($m['description'] ?? ''), 30),
				'preview'     => (bool) preg_match('/preview|exp/i', $id),
			);
		}
		$token = $j['nextPageToken'] ?? '';
		if (!$token) {
			break;
		}
	}
	// prima i modelli stabili, poi le anteprime; dentro ogni gruppo i più nuovi in alto
	usort($models, function ($a, $b) {
		if ($a['preview'] !== $b['preview']) {
			return $a['preview'] ? 1 : -1;
		}
		return strnatcasecmp($b['id'], $a['id']);
	});
	$out = array('time' => current_time('Y-m-d H:i'), 'models' => $models);
	set_transient(FLC_MODELS_CACHE, $out, 12 * HOUR_IN_SECONDS);
	return $out;
}

add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/modelli', array(
		'methods'             => 'POST',
		'callback'            => function () {
			$r = flc_gemini_models(true);
			return is_wp_error($r) ? new WP_Error('flc_models', $r->get_error_message(), array('status' => 400)) : $r;
		},
		'permission_callback' => function () {
			return current_user_can('manage_options');
		},
	));
});

// --- Google Gemini (API generateContent con immagine in input e in output) ---
function flc_run_gemini($image, $mime, $prompt, $s) {
	if (empty($s['gemini_key'])) {
		return new WP_Error('flc_config', 'Gemini: chiave API mancante');
	}
	$model = rawurlencode($s['gemini_model'] ?: 'gemini-2.5-flash-image');
	$url   = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent";
	// Gemini a volte rifiuta senza motivo (finishReason IMAGE_OTHER / NO_IMAGE / solo testo): spesso basta
	// riprovare. 2° tentativo: un po' più di libertà; 3°: prima l'immagine e poi un comando corto e diretto.
	// I tentativi falliti non producono immagini, quindi costano pochissimo.
	$attempts = array(
		array('temp' => 0.3, 'image_first' => false, 'prompt' => $prompt),
		array('temp' => 0.7, 'image_first' => false, 'prompt' => $prompt),
		array('temp' => 0.9, 'image_first' => true, 'prompt' => 'Generate a new image from the attached picture following these instructions. ' . $prompt),
	);
	$reasons = array();
	foreach ($attempts as $a) {
		$img_part  = array('inline_data' => array('mime_type' => $mime, 'data' => base64_encode($image)));
		$text_part = array('text' => $a['prompt']);
		$body = array(
			'contents'         => array(array('parts' => $a['image_first'] ? array($img_part, $text_part) : array($text_part, $img_part))),
			'generationConfig' => array(
				'temperature'        => $a['temp'], // più basso = meno libertà creativa, più fedele all'originale
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
			return flc_http_error($res, 'Gemini'); // chiave, credito, quota: inutile riprovare
		}
		$j    = json_decode(wp_remote_retrieve_body($res), true);
		$said = '';
		foreach ($j['candidates'][0]['content']['parts'] ?? array() as $part) {
			$inline = $part['inlineData'] ?? ($part['inline_data'] ?? null);
			if ($inline && !empty($inline['data'])) {
				return array(
					'mime' => $inline['mimeType'] ?? ($inline['mime_type'] ?? 'image/png'),
					'data' => base64_decode($inline['data']),
				);
			}
			if (!empty($part['text'])) {
				$said .= ' ' . $part['text'];
			}
		}
		$reason = $j['candidates'][0]['finishReason'] ?? ($j['promptFeedback']['blockReason'] ?? 'nessuna immagine');
		$reasons[] = $reason . ($said !== '' ? ': "' . mb_substr(trim($said), 0, 160) . '"' : '');
		// blocchi di sicurezza veri: riprovare non serve
		if (in_array($reason, array('SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST'), true)) {
			break;
		}
	}
	return new WP_Error('flc_empty', 'Gemini non ha restituito un\'immagine dopo ' . count($reasons) . ' tentativi (' . implode(' / ', $reasons) . ')');
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
