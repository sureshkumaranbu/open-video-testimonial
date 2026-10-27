<?php
/**
 * One REST route for the block editor: the widgets and forms the saved API
 * key can see, so an editor picks one instead of pasting an id. The key is
 * used here, on the server; the browser only gets names and ids.
 *
 * @package Plaudit
 */

defined( 'ABSPATH' ) || exit;

add_action( 'rest_api_init', 'plaudit_rest_routes' );

function plaudit_rest_routes() {
	register_rest_route(
		'plaudit/v1',
		'/embeds',
		array(
			'methods'             => 'GET',
			'callback'            => 'plaudit_rest_embeds',
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}

/**
 * @return WP_REST_Response|WP_Error
 */
function plaudit_rest_embeds() {
	$cached = get_transient( 'plaudit_embeds' );
	if ( false !== $cached ) {
		return rest_ensure_response( $cached );
	}
	$projects = plaudit_api_get( '/projects' );
	if ( is_wp_error( $projects ) ) {
		return new WP_Error( 'plaudit_unreachable', $projects->get_error_message(), array( 'status' => 502 ) );
	}
	$out = array( 'widgets' => array(), 'forms' => array() );
	foreach ( array_slice( isset( $projects['data'] ) ? (array) $projects['data'] : array(), 0, 20 ) as $p ) {
		if ( empty( $p['slug'] ) ) {
			continue;
		}
		$slug    = (string) $p['slug'];
		$widgets = plaudit_api_get( '/projects/' . rawurlencode( $slug ) . '/widgets' );
		foreach ( is_wp_error( $widgets ) ? array() : (array) $widgets['data'] as $w ) {
			$out['widgets'][] = array( 'id' => (string) $w['id'], 'name' => (string) $w['name'], 'layout' => (string) $w['layout'], 'project' => (string) $p['name'] );
		}
		$forms = plaudit_api_get( '/projects/' . rawurlencode( $slug ) . '/forms' );
		foreach ( is_wp_error( $forms ) ? array() : (array) $forms['data'] as $f ) {
			$out['forms'][] = array( 'project' => $slug, 'form' => (string) $f['slug'], 'name' => (string) $f['name'], 'projectName' => (string) $p['name'] );
		}
	}
	set_transient( 'plaudit_embeds', $out, 5 * MINUTE_IN_SECONDS );
	return rest_ensure_response( $out );
}
