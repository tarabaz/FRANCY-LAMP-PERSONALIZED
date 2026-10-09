<?php
// Accessi del configuratore: codici che dai tu (biglietti da fiera, clienti fissi…), senza account WordPress.
// - Profili (Ospite, Fiera, VIP…): quali funzioni del configuratore si possono usare e quanti ridisegni IA.
//   "Ospite" = chi non ha fatto l'accesso: sono le spunte di sempre (Impostazioni → Funzioni, prima colonna).
// - Account: un codice (es. LUCCA26-K7M4) legato a un profilo, con scadenza e limiti propri se servono.
//   Si entra dal pulsante "🔑 Accedi" in alto nel configuratore o con il link/QR ?accesso=CODICE.
// Tutto è controllato dal server (ridisegno, convalida…): nascondere i pulsanti non basta.

if (!defined('ABSPATH')) {
	exit;
}

const FLC_ACCESS        = 'flc_access';
const FLC_ACCESS_USAGE  = 'flc_access_usage';
const FLC_ACCESS_COOKIE = 'flc_acc';

// funzioni dell'IA accese nel profilo "Fiera" di partenza
function flc_access_ai_keys() {
	return array('enabled', 'style_ritratto', 'style_tombino', 'style_anime', 'card_enabled', 'bg_enabled', 'examples_enabled');
}

// spunte dell'Ospite (= impostazioni di sempre)
function flc_access_guest_feats($s = null) {
	$s   = $s ?: flc_settings();
	$out = array();
	foreach (array_keys(flc_features()) as $k) {
		$out[$k] = empty($s[$k]) ? 0 : 1;
	}
	return $out;
}

function flc_access_default() {
	$guest = flc_access_guest_feats();
	$fiera = $guest;
	foreach (flc_access_ai_keys() as $k) {
		$fiera[$k] = 1;
	}
	$vip = array_map(function () { return 1; }, $guest);
	return array(
		'v'        => 1,
		'profiles' => array(
			'fiera' => array('name' => 'Fiera', 'feats' => $fiera, 'ai_day' => 10, 'ai_total' => 300),
			'vip'   => array('name' => 'VIP', 'feats' => $vip, 'ai_day' => 30, 'ai_total' => 0),
		),
		'accounts' => array(),
	);
}

function flc_access_reset_cache() {
	$GLOBALS['flc_access_cache'] = null;
}

function flc_access() {
	if (!empty($GLOBALS['flc_access_cache'])) {
		return $GLOBALS['flc_access_cache'];
	}
	$a = get_option(FLC_ACCESS, null);
	if (!is_array($a) || empty($a['v'])) {
		$a = flc_access_default();
	}
	$a['profiles'] = is_array($a['profiles'] ?? null) ? $a['profiles'] : array();
	$a['accounts'] = is_array($a['accounts'] ?? null) ? $a['accounts'] : array();
	$keys          = array_keys(flc_features());
	foreach ($a['profiles'] as $pid => $p) {
		$f = (array) ($p['feats'] ?? array());
		foreach ($keys as $k) {
			$f[$k] = empty($f[$k]) ? 0 : 1; // funzioni aggiunte dopo: spente finché non le spunti
		}
		$a['profiles'][$pid] = array(
			'name'     => (string) ($p['name'] ?? $pid),
			'feats'    => $f,
			'ai_day'   => max(0, (int) ($p['ai_day'] ?? 0)),
			'ai_total' => max(0, (int) ($p['ai_total'] ?? 0)),
		);
	}
	return $GLOBALS['flc_access_cache'] = $a;
}

// ---------------- salvataggio (stesso modulo delle impostazioni) ----------------
add_action('admin_init', function () {
	register_setting('flc', FLC_ACCESS, array('sanitize_callback' => 'flc_access_sanitize'));
});

function flc_access_code_clean($c) {
	return substr(preg_replace('/[^A-Z0-9-]/', '', strtoupper(remove_accents((string) $c))), 0, 32);
}

function flc_access_sanitize($in) {
	$old = flc_access();
	if (!is_array($in) || empty($in['present'])) {
		return $old; // modulo senza la sezione accessi: non tocco niente
	}
	$keys = array_keys(flc_features());
	$out  = array('v' => 1, 'profiles' => array(), 'accounts' => array());
	foreach ((array) ($in['profiles'] ?? array()) as $pid => $p) {
		$pid = sanitize_key($pid);
		if ($pid === '' || $pid === 'ospite' || !is_array($p)) {
			continue;
		}
		$f = array();
		foreach ($keys as $k) {
			$f[$k] = empty($p['feats'][$k]) ? 0 : 1;
		}
		$name = trim(sanitize_text_field((string) ($p['name'] ?? '')));
		$out['profiles'][$pid] = array(
			'name'     => mb_substr($name !== '' ? $name : 'Profilo', 0, 40),
			'feats'    => $f,
			'ai_day'   => max(0, min(9999, (int) ($p['ai_day'] ?? 0))),
			'ai_total' => max(0, min(999999, (int) ($p['ai_total'] ?? 0))),
		);
	}
	$first = array_key_first($out['profiles']);
	$seen  = array();
	foreach ((array) ($in['accounts'] ?? array()) as $aid => $a) {
		$aid = sanitize_key($aid);
		if ($aid === '' || !is_array($a)) {
			continue;
		}
		$code = flc_access_code_clean($a['code'] ?? '');
		if (strlen($code) < 6) {
			$code = strtoupper(wp_generate_password(8, false, false));
		}
		while (isset($seen[$code])) {
			$code .= strtoupper(wp_generate_password(2, false, false));
		}
		$seen[$code] = 1;
		$prof = sanitize_key($a['profile'] ?? '');
		if (!isset($out['profiles'][$prof])) {
			$prof = (string) $first; // profilo cancellato senza spostare gli account: vanno nel primo
		}
		$exp = (string) ($a['expires'] ?? '');
		$exp = preg_match('/^\d{4}-\d{2}-\d{2}$/', $exp) ? $exp : '';
		$lim = function ($v) {
			$v = trim((string) $v);
			return $v === '' ? '' : max(0, min(999999, (int) $v));
		};
		$name = trim(sanitize_text_field((string) ($a['name'] ?? '')));
		$out['accounts'][$aid] = array(
			'code'     => $code,
			'name'     => mb_substr($name !== '' ? $name : $code, 0, 60),
			'profile'  => $prof,
			'expires'  => $exp,
			'active'   => empty($a['active']) ? 0 : 1,
			'ai_day'   => $lim($a['ai_day'] ?? ''),   // vuoto = quello del profilo
			'ai_total' => $lim($a['ai_total'] ?? ''),
			'created'  => (int) ($old['accounts'][$aid]['created'] ?? time()),
		);
	}
	if (!$out['profiles']) {
		$out['accounts'] = array(); // senza profili gli account non possono fare niente
	}
	flc_access_reset_cache();
	return $out;
}

// ---------------- chi sta usando il configuratore ----------------
function flc_access_find_code($code) {
	$code = flc_access_code_clean($code);
	if ($code === '') {
		return null;
	}
	foreach (flc_access()['accounts'] as $aid => $a) {
		if (hash_equals($a['code'], $code)) {
			return $aid;
		}
	}
	return null;
}

function flc_access_errors() {
	return array(
		'codice'      => 'Codice non valido.',
		'disattivato' => 'Questo codice è stato disattivato.',
		'scaduto'     => 'Questo codice è scaduto.',
		'tentativi'   => 'Troppi tentativi sbagliati: riprova tra 15 minuti.',
	);
}

// perché un account non vale: '' se va bene, altrimenti la chiave di flc_access_errors()
function flc_access_invalid_key($aid) {
	$acc = flc_access();
	$a   = $acc['accounts'][$aid] ?? null;
	if (!$a || !isset($acc['profiles'][$a['profile']])) {
		return 'codice';
	}
	if (empty($a['active'])) {
		return 'disattivato';
	}
	if ($a['expires'] && $a['expires'] < current_time('Y-m-d')) {
		return 'scaduto';
	}
	return '';
}

// messaggio per cui un account non vale (o '' se va bene)
function flc_access_invalid($aid) {
	$k = flc_access_invalid_key($aid);
	return $k === '' ? '' : flc_access_errors()[$k];
}

function flc_access_sign($aid, $exp) {
	$a = flc_access()['accounts'][$aid] ?? array('code' => '');
	// il codice entra nella firma: se lo cambi, chi era dentro con quello vecchio esce
	return hash_hmac('sha256', $aid . '|' . $exp . '|' . $a['code'], wp_salt('auth') . 'flc_acc');
}

function flc_access_set_cookie($aid) {
	$a   = flc_access()['accounts'][$aid];
	$exp = time() + 30 * DAY_IN_SECONDS;
	if ($a['expires']) {
		$exp = min($exp, strtotime($a['expires'] . ' 23:59:59') ?: $exp);
	}
	$val  = $aid . '|' . $exp . '|' . flc_access_sign($aid, $exp);
	$path = COOKIEPATH ?: '/';
	setcookie(FLC_ACCESS_COOKIE, $val, array('expires' => $exp, 'path' => $path, 'domain' => COOKIE_DOMAIN ?: '', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax'));
	// segnale leggibile dal configuratore (pagina in cache: chiede la configurazione giusta al server)
	setcookie(FLC_ACCESS_COOKIE . '_n', '1', array('expires' => $exp, 'path' => $path, 'domain' => COOKIE_DOMAIN ?: '', 'secure' => is_ssl(), 'httponly' => false, 'samesite' => 'Lax'));
	$_COOKIE[FLC_ACCESS_COOKIE] = $val;
	// contatore per persona: con lo stesso codice entrano tante persone (stesso wifi della fiera)
	if (empty($_COOKIE['flc_dev'])) {
		$dev = wp_generate_password(20, false, false);
		setcookie('flc_dev', $dev, array('expires' => time() + YEAR_IN_SECONDS, 'path' => $path, 'domain' => COOKIE_DOMAIN ?: '', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax'));
		$_COOKIE['flc_dev'] = $dev;
	}
	$u = get_option(FLC_ACCESS_USAGE, array());
	$u = is_array($u) ? $u : array();
	$u[$aid]['logins'] = (int) ($u[$aid]['logins'] ?? 0) + 1;
	$u[$aid]['last']   = time();
	update_option(FLC_ACCESS_USAGE, $u, false);
}

function flc_access_clear_cookie() {
	$path = COOKIEPATH ?: '/';
	foreach (array(FLC_ACCESS_COOKIE, FLC_ACCESS_COOKIE . '_n') as $c) {
		setcookie($c, '', array('expires' => time() - 3600, 'path' => $path, 'domain' => COOKIE_DOMAIN ?: '', 'secure' => is_ssl(), 'httponly' => $c === FLC_ACCESS_COOKIE, 'samesite' => 'Lax'));
	}
	unset($_COOKIE[FLC_ACCESS_COOKIE]);
}

// account con cui sta lavorando questo visitatore: array(id, account, profile_id, profile) oppure null
function flc_access_current() {
	$raw = (string) ($_COOKIE[FLC_ACCESS_COOKIE] ?? '');
	if ($raw === '') {
		return null;
	}
	$p = explode('|', $raw);
	if (count($p) !== 3 || (int) $p[1] < time()) {
		return null;
	}
	$aid = sanitize_key($p[0]);
	if (!hash_equals(flc_access_sign($aid, (int) $p[1]), $p[2]) || flc_access_invalid($aid) !== '') {
		return null;
	}
	$acc = flc_access();
	$a   = $acc['accounts'][$aid];
	return array('id' => $aid, 'account' => $a, 'profile_id' => $a['profile'], 'profile' => $acc['profiles'][$a['profile']]);
}

// una funzione è accesa per almeno qualcuno (ospite o un profilo)?
function flc_access_feature_any($k, $s = null) {
	$s = $s ?: flc_settings();
	if (!empty($s[$k])) {
		return true;
	}
	foreach (flc_access()['profiles'] as $p) {
		if (!empty($p['feats'][$k])) {
			return true;
		}
	}
	return false;
}

// Impostazioni con le funzioni di chi sta usando il configuratore:
// ospite = come sempre; account = spunte del suo profilo; amministratore = tutto ciò che è acceso per qualcuno.
function flc_settings_effective($s = null) {
	$s = $s ?: flc_settings();
	if (current_user_can('manage_options')) {
		foreach (array_keys(flc_features()) as $k) {
			$s[$k] = flc_access_feature_any($k, $s) ? 1 : 0;
		}
		return $s;
	}
	$cur = flc_access_current();
	if ($cur) {
		foreach ($cur['profile']['feats'] as $k => $v) {
			$s[$k] = $v;
		}
	}
	return $s;
}

// ---------------- limiti IA dell'account ----------------
function flc_access_limits($cur) {
	$a = $cur['account'];
	return array(
		'day'   => $a['ai_day'] === '' ? (int) $cur['profile']['ai_day'] : (int) $a['ai_day'],
		'total' => $a['ai_total'] === '' ? (int) $cur['profile']['ai_total'] : (int) $a['ai_total'],
	);
}

function flc_access_person_key($aid) {
	$who = (string) ($_COOKIE['flc_dev'] ?? '') ?: ($_SERVER['REMOTE_ADDR'] ?? '');
	return 'flc_accd_' . md5(wp_salt('nonce') . $aid . '|' . $who . '|' . current_time('Y-m-d'));
}

function flc_access_used_total($aid) {
	$u = get_option(FLC_ACCESS_USAGE, array());
	return (int) ($u[$aid]['ai'] ?? 0);
}

// stato per il contatore del configuratore: per persona oggi + totale del codice
function flc_access_quota($cur) {
	$l     = flc_access_limits($cur);
	$day   = (int) get_transient(flc_access_person_key($cur['id']));
	$total = flc_access_used_total($cur['id']);
	return array(
		'user'    => array('used' => $day, 'limit' => $l['day'], 'remaining' => $l['day'] > 0 ? max(0, $l['day'] - $day) : null),
		'account' => array('used' => $total, 'limit' => $l['total'], 'remaining' => $l['total'] > 0 ? max(0, $l['total'] - $total) : null, 'name' => $cur['account']['name']),
	);
}

// controlla e conta un ridisegno dell'account; ritorna '' oppure il messaggio di errore
function flc_access_take_ai($cur) {
	$q = flc_access_quota($cur);
	if ($q['account']['remaining'] === 0) {
		return 'I ridisegni di questo codice d\'accesso sono finiti. Puoi comunque continuare a personalizzare la lampada.';
	}
	if ($q['user']['remaining'] === 0) {
		return 'Hai usato tutti i ridisegni di oggi. Puoi comunque continuare a personalizzare la lampada.';
	}
	set_transient(flc_access_person_key($cur['id']), $q['user']['used'] + 1, DAY_IN_SECONDS);
	$u = get_option(FLC_ACCESS_USAGE, array());
	$u = is_array($u) ? $u : array();
	$u[$cur['id']]['ai'] = (int) ($u[$cur['id']]['ai'] ?? 0) + 1;
	update_option(FLC_ACCESS_USAGE, $u, false);
	return '';
}

// ---------------- entrare e uscire ----------------
function flc_access_ip_key() {
	return 'flc_accf_' . md5(wp_salt('nonce') . ($_SERVER['REMOTE_ADDR'] ?? ''));
}
function flc_access_blocked() {
	return (int) get_transient(flc_access_ip_key()) >= 5;
}
function flc_access_fail() {
	$k = flc_access_ip_key();
	set_transient($k, (int) get_transient($k) + 1, 15 * MINUTE_IN_SECONDS);
}

// info per il pulsante in alto
function flc_access_public() {
	$out = array(
		'loginUrl'  => esc_url_raw(rest_url('francy-lamp/v1/accesso/entra')),
		'logoutUrl' => esc_url_raw(rest_url('francy-lamp/v1/accesso/esci')),
		'configUrl' => esc_url_raw(rest_url('francy-lamp/v1/accesso/config')),
		'account'   => null,
		'admin'     => current_user_can('manage_options') ? wp_get_current_user()->display_name : '',
		'contact'   => esc_url_raw(flc_settings()['acc_contact_url'] ?? ''), // link "Non hai un codice? Scrivici"
		'error'     => '',
	);
	$cur = current_user_can('manage_options') ? null : flc_access_current();
	if ($cur) {
		$out['account'] = array('name' => $cur['account']['name'], 'profile' => $cur['profile']['name']);
	}
	// ridisegno riservato: l'ospite non ce l'ha ma un profilo sì → "Accedi per usarlo"
	$s = flc_settings();
	$out['aiLocked'] = !$cur && !current_user_can('manage_options') && empty($s['enabled']) && flc_access_feature_any('enabled', $s)
		&& (!empty($s['gemini_key']) || !empty($s['fal_key']));
	if (isset($_GET['accesso_err'])) {
		// solo codici: nessun testo arbitrario dal link finisce sulla pagina
		$msg          = flc_access_errors();
		$out['error'] = $msg[sanitize_key($_GET['accesso_err'])] ?? $msg['codice'];
	}
	return $out;
}

add_action('rest_api_init', function () {
	register_rest_route('francy-lamp/v1', '/accesso/entra', array(
		'methods'             => 'POST',
		'callback'            => 'flc_rest_access_login',
		'permission_callback' => '__return_true',
	));
	register_rest_route('francy-lamp/v1', '/accesso/esci', array(
		'methods'             => 'POST',
		'callback'            => 'flc_rest_access_logout',
		'permission_callback' => '__return_true',
	));
	// pagina servita dalla cache con la configurazione dell'ospite: il configuratore chiede quella giusta
	register_rest_route('francy-lamp/v1', '/accesso/config', array(
		'methods'             => 'GET',
		'callback'            => function () {
			nocache_headers();
			return array('config' => flc_frontend_config());
		},
		'permission_callback' => '__return_true',
	));
});

function flc_rest_access_login(WP_REST_Request $req) {
	if (flc_access_blocked()) {
		return new WP_Error('flc_acc_block', 'Troppi tentativi sbagliati: riprova tra 15 minuti.', array('status' => 429));
	}
	$user = trim((string) $req->get_param('user'));
	$pass = (string) $req->get_param('pass');
	// amministratore: accesso a WordPress direttamente dal configuratore
	if ($user !== '' && $pass !== '') {
		$u = wp_signon(array('user_login' => $user, 'user_password' => $pass, 'remember' => true), is_ssl());
		if (is_wp_error($u)) {
			flc_access_fail();
			return new WP_Error('flc_acc_bad', 'Nome utente o password non corretti.', array('status' => 403));
		}
		return array('ok' => true, 'admin' => user_can($u, 'manage_options'));
	}
	$aid = flc_access_find_code((string) $req->get_param('code'));
	$why = $aid ? flc_access_invalid($aid) : 'Codice non valido.';
	if ($why !== '') {
		flc_access_fail();
		return new WP_Error('flc_acc_bad', $why, array('status' => 403));
	}
	flc_access_set_cookie($aid);
	$a = flc_access()['accounts'][$aid];
	return array('ok' => true, 'name' => $a['name']);
}

function flc_rest_access_logout(WP_REST_Request $req) {
	flc_access_clear_cookie();
	// uscita da WordPress solo con il nonce della pagina (niente link esterni che ti scollegano)
	if (is_user_logged_in()) {
		$nonce = $req->get_header('x_wp_nonce');
		if ($nonce && wp_verify_nonce($nonce, 'wp_rest')) {
			wp_logout();
		}
	}
	return array('ok' => true);
}

// link o QR: …/configuratore/?accesso=CODICE → entra e torna all'indirizzo pulito
add_action('template_redirect', function () {
	if (!isset($_GET['accesso']) || is_admin()) {
		return;
	}
	$back = remove_query_arg(array('accesso', 'accesso_err'));
	if (flc_access_blocked()) {
		wp_safe_redirect(add_query_arg('accesso_err', 'tentativi', $back));
		exit;
	}
	$aid = flc_access_find_code(wp_unslash($_GET['accesso']));
	$why = $aid ? flc_access_invalid_key($aid) : 'codice';
	if ($why !== '') {
		flc_access_fail();
		wp_safe_redirect(add_query_arg('accesso_err', $why, $back));
		exit;
	}
	flc_access_set_cookie($aid);
	nocache_headers();
	wp_safe_redirect($back);
	exit;
}, 1);

// ---------------- provenienza dei dischi convalidati ----------------
function flc_access_stamp($post_id) {
	$cur = current_user_can('manage_options') ? null : flc_access_current();
	if (!$cur) {
		update_post_meta($post_id, '_flc_acc', 'ospite');
		return;
	}
	update_post_meta($post_id, '_flc_acc', $cur['id']);
	update_post_meta($post_id, '_flc_acc_prof', $cur['profile_id']);
	// i nomi restano sul disco anche se un giorno cancelli l'account o il profilo
	update_post_meta($post_id, '_flc_acc_info', array('name' => $cur['account']['name'], 'code' => $cur['account']['code'], 'profile' => $cur['profile']['name']));
	$u = get_option(FLC_ACCESS_USAGE, array());
	$u = is_array($u) ? $u : array();
	$u[$cur['id']]['sent'] = (int) ($u[$cur['id']]['sent'] ?? 0) + 1;
	update_option(FLC_ACCESS_USAGE, $u, false);
}

function flc_access_origin_html($post_id) {
	$aid = (string) get_post_meta($post_id, '_flc_acc', true);
	if ($aid === '' || $aid === 'ospite') {
		return $aid === 'ospite' ? '<span class="description">Ospite</span>' : '';
	}
	$acc  = flc_access();
	$info = (array) get_post_meta($post_id, '_flc_acc_info', true);
	$a    = $acc['accounts'][$aid] ?? null;
	$name = $a ? $a['name'] : ($info['name'] ?? $aid);
	$pid  = (string) get_post_meta($post_id, '_flc_acc_prof', true);
	$prof = isset($acc['profiles'][$pid]) ? $acc['profiles'][$pid]['name'] : ($info['profile'] ?? '');
	return '🎟️ <strong>' . esc_html($name) . '</strong>' . ($prof ? ' · ' . esc_html($prof) : '') . (!$a ? ' <span class="description">(account eliminato)</span>' : '');
}
