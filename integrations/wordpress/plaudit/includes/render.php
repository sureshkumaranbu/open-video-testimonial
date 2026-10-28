<?php
/**
 * Building the embeds. Every value that reaches the page is escaped
 * (esc_url, esc_attr); the SEO include is cleaned with wp_kses and its
 * JSON-LD re-encoded before it's printed.
 *
 * @package Plaudit
 */

defined( 'ABSPATH' ) || exit;

/** A saved widget's id, as the Plaudit dashboard shows it. */
const PLAUDIT_WIDGET_ID = '/^w_[a-z0-9]{12}$/';
/** A project or form slug. */
const PLAUDIT_SLUG = '/^[a-z0-9][a-z0-9-]{0,63}$/';

/**
 * The Plaudit server's address from the settings, without a trailing slash; '' until it's set.
 *
 * @return string
 */
function plaudit_server() {
	$url = esc_url_raw( (string) get_option( 'plaudit_url', '' ), array( 'https', 'http' ) );
	return untrailingslashit( $url );
}

/**
 * A note only editors see (in the block editor's preview or on a page while signed in), so a broken embed is noticed.
 *
 * @param string $message What's wrong.
 * @return string
 */
function plaudit_editor_notice( $message ) {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return '';
	}
	return '<p class="plaudit-notice" style="padding:12px;border:1px dashed #c3c4c7;color:#50575e">' . esc_html( $message ) . '</p>';
}

/**
 * A saved widget: its placeholder (with the SEO include when on) and widget.js.
 *
 * @param string $id   The widget id, w_ and 12 letters or digits.
 * @param array  $args seo: true/false, or null for the site's setting.
 * @return string
 */
function plaudit_render_widget( $id, $args = array() ) {
	static $n = 0;
	$server = plaudit_server();
	$id     = strtolower( trim( (string) $id ) );
	if ( '' === $server ) {
		return plaudit_editor_notice( __( 'Plaudit: set your Plaudit address in Settings › Plaudit.', 'plaudit' ) );
	}
	if ( ! preg_match( PLAUDIT_WIDGET_ID, $id ) ) {
		return plaudit_editor_notice( __( 'Plaudit: that isn’t a widget id. Copy it from Widgets › your widget › Share (it looks like w_abc123def456).', 'plaudit' ) );
	}
	++$n;
	$target = 'plaudit-' . $id . '-' . $n;
	$seo    = isset( $args['seo'] ) && null !== $args['seo'] ? (bool) $args['seo'] : '1' === get_option( 'plaudit_seo', '1' );
	$inner  = $seo ? plaudit_widget_html( $server, $id ) : '';
	$html   = '<div class="plaudit-widget" id="' . esc_attr( $target ) . '" data-plaudit-widget="' . esc_attr( $id ) . '">' . $inner . '</div>';
	$html  .= wp_get_script_tag(
		array(
			'src'         => esc_url( $server . '/widget.js' ),
			'data-widget' => esc_attr( $id ),
			'data-target' => esc_attr( '#' . $target ),
			'async'       => true,
		)
	);
	return $html;
}

/**
 * A collection form, as the iframe embed (it may use the camera).
 *
 * @param string $project The project's slug.
 * @param string $form    The form's slug.
 * @param array  $args    height (px, the frame's starting height) and title.
 * @return string
 */
function plaudit_render_form( $project, $form, $args = array() ) {
	$server  = plaudit_server();
	$project = strtolower( trim( (string) $project ) );
	$form    = strtolower( trim( (string) $form ) );
	if ( '' === $server ) {
		return plaudit_editor_notice( __( 'Plaudit: set your Plaudit address in Settings › Plaudit.', 'plaudit' ) );
	}
	if ( ! preg_match( PLAUDIT_SLUG, $project ) || ! preg_match( PLAUDIT_SLUG, $form ) ) {
		return plaudit_editor_notice( __( 'Plaudit: name the project and the form, e.g. form="acme/stories".', 'plaudit' ) );
	}
	$height = ! empty( $args['height'] ) ? min( max( (int) $args['height'], 200 ), 4000 ) : 640;
	$title  = ! empty( $args['title'] ) ? $args['title'] : __( 'Share your experience', 'plaudit' );
	$src    = $server . '/embed/' . rawurlencode( $project ) . '/form/' . rawurlencode( $form );
	return '<iframe class="plaudit-form" src="' . esc_url( $src ) . '" title="' . esc_attr( $title ) . '" allow="camera; microphone; clipboard-write" loading="lazy" style="width:100%;border:0;min-height:' . esc_attr( (string) $height ) . 'px" data-plaudit-form="' . esc_attr( $form ) . '"></iframe>';
}

/**
 * SEO mode: the widget's server-rendered HTML (with JSON-LD), cached in a
 * transient for the minutes set in Settings › Plaudit. '' when the server
 * can't be reached, so the live widget still shows.
 *
 * @param string $server The Plaudit address.
 * @param string $id     The widget id.
 * @return string
 */
function plaudit_widget_html( $server, $id ) {
	$url   = $server . '/api/widget/' . rawurlencode( $id ) . '/html?jsonld=1';
	$cache = 'plaudit_html_' . md5( $url );
	$hit   = get_transient( $cache );
	if ( false !== $hit ) {
		return $hit;
	}
	$res  = wp_remote_get(
		$url,
		array(
			'timeout'     => 3,
			'redirection' => 0,
			'headers'     => array( 'Accept' => 'text/html' ),
		)
	);
	$html = ( ! is_wp_error( $res ) && 200 === wp_remote_retrieve_response_code( $res ) ) ? plaudit_clean_include( wp_remote_retrieve_body( $res ) ) : '';
	// A failure is cached briefly too, so a slow server doesn't slow every page.
	set_transient( $cache, $html, $html ? max( 1, (int) get_option( 'plaudit_cache_minutes', 10 ) ) * MINUTE_IN_SECONDS : MINUTE_IN_SECONDS );
	return $html;
}

/**
 * The HTML include, made safe to print: its JSON-LD blocks are decoded and
 * re-encoded (so they can't close their script tag), every other script is
 * dropped, and the rest goes through wp_kses with the tags the include uses.
 *
 * @param string $raw The include as the server sent it.
 * @return string
 */
function plaudit_clean_include( $raw ) {
	$raw = substr( (string) $raw, 0, 512 * 1024 );
	$ld  = '';
	if ( preg_match_all( '#<script type="application/ld\+json">(.*?)</script>#s', $raw, $m ) ) {
		foreach ( $m[1] as $json ) {
			$data = json_decode( $json, true );
			if ( is_array( $data ) ) {
				$ld .= wp_get_inline_script_tag( wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP ), array( 'type' => 'application/ld+json' ) );
			}
		}
	}
	$raw = preg_replace( '#<script\b[^>]*>.*?</script>#is', '', $raw );
	return wp_kses( $raw, plaudit_allowed_html() ) . $ld;
}

/**
 * The tags and attributes the HTML include uses.
 *
 * @return array
 */
function plaudit_allowed_html() {
	$common = array(
		'class'                   => true,
		'role'                    => true,
		'aria-label'              => true,
		'aria-hidden'             => true,
		'data-plaudit-include'    => true,
		'data-layout'             => true,
		'data-testimonial-id'     => true,
	);
	return array(
		'style'      => array( 'type' => true ),
		'div'        => $common,
		'article'    => $common,
		'span'       => $common,
		'p'          => $common,
		'b'          => $common,
		'h3'         => $common,
		'blockquote' => $common,
		'footer'     => $common,
		'details'    => $common,
		'summary'    => $common,
		'time'       => $common + array( 'datetime' => true ),
		'a'          => $common + array( 'href' => true, 'rel' => true, 'target' => true ),
		'img'        => $common + array( 'src' => true, 'alt' => true, 'width' => true, 'height' => true, 'loading' => true, 'decoding' => true ),
		'video'      => $common + array( 'src' => true, 'poster' => true, 'controls' => true, 'preload' => true, 'playsinline' => true, 'width' => true, 'height' => true ),
		'source'     => array( 'src' => true, 'type' => true ),
		'track'      => array( 'src' => true, 'kind' => true, 'srclang' => true, 'label' => true, 'default' => true ),
	);
}
