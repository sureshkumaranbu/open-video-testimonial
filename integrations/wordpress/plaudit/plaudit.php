<?php
/**
 * Plugin Name:       Plaudit Testimonials
 * Plugin URI:        https://github.com/sureshkumaranbu/open-video-testimonial
 * Description:       Show testimonials from your own Plaudit server: saved widgets, collection forms and a site-wide toast, with server-rendered HTML for search engines.
 * Version:           0.1.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            The Plaudit contributors
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       plaudit
 *
 * @package Plaudit
 */

defined( 'ABSPATH' ) || exit;

define( 'PLAUDIT_VERSION', '0.1.0' );
define( 'PLAUDIT_DIR', plugin_dir_path( __FILE__ ) );

require_once PLAUDIT_DIR . 'includes/render.php';
require_once PLAUDIT_DIR . 'includes/settings.php';
require_once PLAUDIT_DIR . 'includes/rest.php';

add_shortcode( 'plaudit', 'plaudit_shortcode' );
add_action( 'init', 'plaudit_register_block' );
add_action( 'wp_footer', 'plaudit_site_toast' );

/**
 * [plaudit widget="w_abc123def456"] or [plaudit form="stories" project="acme"]
 * (also form="acme/stories"). Optional: seo="0" turns the HTML include off for
 * one widget; height="720" and title="…" for a form.
 *
 * @param array|string $atts Shortcode attributes.
 * @return string
 */
function plaudit_shortcode( $atts ) {
	$atts = shortcode_atts(
		array(
			'widget'  => '',
			'form'    => '',
			'project' => '',
			'seo'     => '',
			'height'  => '',
			'title'   => '',
		),
		$atts,
		'plaudit'
	);
	if ( '' !== $atts['widget'] ) {
		return plaudit_render_widget( $atts['widget'], array( 'seo' => '' === $atts['seo'] ? null : '0' !== $atts['seo'] ) );
	}
	if ( '' !== $atts['form'] ) {
		$project = $atts['project'];
		$form    = $atts['form'];
		if ( '' === $project && false !== strpos( $form, '/' ) ) {
			list( $project, $form ) = explode( '/', $form, 2 );
		}
		return plaudit_render_form(
			$project,
			$form,
			array(
				'height' => absint( $atts['height'] ),
				'title'  => $atts['title'],
			)
		);
	}
	return plaudit_editor_notice( __( 'Plaudit: add widget="w_…" or form="project/form" to the shortcode.', 'plaudit' ) );
}

/** The "Plaudit testimonials" block: no build step, rendered on the server like the shortcode. */
function plaudit_register_block() {
	register_block_type(
		PLAUDIT_DIR . 'blocks/embed',
		array( 'render_callback' => 'plaudit_render_block' )
	);
}

/**
 * @param array $attributes Block attributes.
 * @return string
 */
function plaudit_render_block( $attributes ) {
	$kind = isset( $attributes['kind'] ) ? $attributes['kind'] : 'widget';
	if ( 'form' === $kind ) {
		return plaudit_render_form(
			isset( $attributes['project'] ) ? $attributes['project'] : '',
			isset( $attributes['form'] ) ? $attributes['form'] : '',
			array( 'height' => isset( $attributes['height'] ) ? absint( $attributes['height'] ) : 0 )
		);
	}
	return plaudit_render_widget(
		isset( $attributes['widget'] ) ? $attributes['widget'] : '',
		array( 'seo' => isset( $attributes['seo'] ) ? (bool) $attributes['seo'] : null )
	);
}

/** The site-wide toast (or any widget) on every front-end page, when one is chosen in Settings › Plaudit. */
function plaudit_site_toast() {
	if ( is_admin() || is_feed() || is_embed() ) {
		return;
	}
	$id = get_option( 'plaudit_toast_widget', '' );
	if ( '' === $id ) {
		return;
	}
	// No SEO include here: a toast is a pop-up, not page content.
	echo plaudit_render_widget( $id, array( 'seo' => false ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts in plaudit_render_widget().
}
