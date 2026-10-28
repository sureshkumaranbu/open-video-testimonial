<?php
/**
 * Runs the plugin's rendering with stand-ins for the few WordPress functions
 * it calls, and prints the results as JSON for tests/integrations.test.ts.
 * Not part of the plugin (it's left out of the zip). The stand-ins are
 * simpler than WordPress's own: they check our code paths, not WordPress.
 *
 *   php integrations/wordpress/tests/render-harness.php
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );

$GLOBALS['options']    = array( 'plaudit_url' => 'https://plaudit.example/', 'plaudit_seo' => '1' );
$GLOBALS['transients'] = array();
$GLOBALS['remote']     = array();
$GLOBALS['fetched']    = array();

function add_action() {}
function add_filter() {}
function add_shortcode() {}
function register_block_type() {}
function plugin_dir_path( $f ) { return dirname( $f ) . '/'; }
function plugin_basename( $f ) { return basename( dirname( $f ) ) . '/' . basename( $f ); }
function __( $s ) { return $s; }
function absint( $v ) { return abs( (int) $v ); }
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['options'] ) ? $GLOBALS['options'][ $k ] : $d; }
function get_transient( $k ) { return isset( $GLOBALS['transients'][ $k ] ) ? $GLOBALS['transients'][ $k ] : false; }
function set_transient( $k, $v ) { $GLOBALS['transients'][ $k ] = $v; return true; }
function current_user_can() { return ! empty( $GLOBALS['editor'] ); }
function is_admin() { return false; }
function is_feed() { return false; }
function is_embed() { return false; }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8', false ); }
function esc_url_raw( $u, $protocols = array( 'http', 'https' ) ) {
	$u = trim( (string) $u );
	return preg_match( '#^(' . implode( '|', $protocols ) . ')://#i', $u ) ? $u : '';
}
function esc_url( $u ) { return esc_attr( esc_url_raw( $u ) ); }
function untrailingslashit( $s ) { return rtrim( $s, '/\\' ); }
function shortcode_atts( $pairs, $atts ) { return array_merge( $pairs, array_intersect_key( (array) $atts, $pairs ) ); }
function wp_json_encode( $d, $f = 0 ) { return json_encode( $d, $f ); }
function wp_get_script_tag( $attrs ) {
	$out = '<script';
	foreach ( $attrs as $k => $v ) {
		$out .= true === $v ? ' ' . $k : ' ' . $k . '="' . esc_attr( $v ) . '"';
	}
	return $out . '></script>';
}
function wp_get_inline_script_tag( $js, $attrs ) { return '<script type="' . esc_attr( $attrs['type'] ) . '">' . $js . '</script>'; }
function wp_kses( $html, $allowed ) { return strip_tags( $html, '<' . implode( '><', array_keys( $allowed ) ) . '>' ); }
function is_wp_error( $r ) { return $r instanceof WP_Error; }
class WP_Error {}
function wp_remote_get( $url ) {
	$GLOBALS['fetched'][] = $url;
	return isset( $GLOBALS['remote'][ $url ] ) ? $GLOBALS['remote'][ $url ] : new WP_Error();
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }

require dirname( __DIR__ ) . '/plaudit/plaudit.php';

$id = 'w_abc123def456';
$GLOBALS['remote'][ 'https://plaudit.example/api/widget/' . $id . '/html?jsonld=1' ] = array(
	'code' => 200,
	'body' => '<div class="plaudit-include"><style>.c{color:red}</style><blockquote class="q"><p>Great &amp; fast</p></blockquote><img src="x" onerror="alert(1)"><script>alert(1)</script></div><script type="application/ld+json">{"@type":"Product","name":"</script><b>x"}</script>',
);

$id2 = 'w_second000000';
$GLOBALS['remote'][ 'https://plaudit.example/api/widget/' . $id2 . '/html?jsonld=1' ] = array(
	'code' => 200,
	'body' => '<div class="plaudit-include"><p>Fine</p></div><script type="application/ld+json">{"@type":"Product","name":"Acme <b>"}</script>',
);

$out = array(
	'jsonLd'       => plaudit_shortcode( array( 'widget' => $id2 ) ),
	'widget'       => plaudit_shortcode( array( 'widget' => $id ) ),
	'widgetNoSeo'  => plaudit_shortcode( array( 'widget' => $id, 'seo' => '0' ) ),
	'widgetAgain'  => plaudit_shortcode( array( 'widget' => $id ) ),
	// Rendered twice with SEO on, fetched once: the second time comes from the transient.
	'fetchedOnce'  => count( array_keys( $GLOBALS['fetched'], 'https://plaudit.example/api/widget/' . $id . '/html?jsonld=1', true ) ),
	'form'         => plaudit_shortcode( array( 'form' => 'acme/stories', 'height' => '99999', 'title' => 'Tell us "more"' ) ),
	'formSplit'    => plaudit_shortcode( array( 'form' => 'stories', 'project' => 'acme' ) ),
	'badWidget'    => plaudit_shortcode( array( 'widget' => '"><script>alert(1)</script>' ) ),
	'block'        => plaudit_render_block( array( 'kind' => 'form', 'project' => 'acme', 'form' => 'stories', 'height' => 720 ) ),
);
$GLOBALS['editor']       = true;
$out['badWidgetEditor']  = plaudit_shortcode( array( 'widget' => '"><script>alert(1)</script>' ) );
$GLOBALS['options']['plaudit_url'] = 'javascript:alert(1)';
$out['badServer']        = plaudit_shortcode( array( 'widget' => $id ) );
$GLOBALS['options']['plaudit_url'] = 'https://plaudit.example';
$GLOBALS['options']['plaudit_toast_widget'] = 'w_toast0000000';
ob_start();
plaudit_site_toast();
$out['toast'] = ob_get_clean();

echo json_encode( $out );
