<?php
/**
 * Removes the plugin's settings and cached HTML.
 *
 * @package Plaudit
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

foreach ( array( 'plaudit_url', 'plaudit_api_key', 'plaudit_seo', 'plaudit_cache_minutes', 'plaudit_toast_widget' ) as $option ) {
	delete_option( $option );
}
delete_transient( 'plaudit_embeds' );
global $wpdb;
// The SEO include's transients are keyed by a hash of their URL.
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_plaudit\\_html\\_%' OR option_name LIKE '\\_transient\\_timeout\\_plaudit\\_html\\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
