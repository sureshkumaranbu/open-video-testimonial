<?php
/**
 * Settings › Plaudit: the server address, the API key (kept as an option and
 * only ever used from PHP, never sent to a browser), SEO mode, the cache time
 * and the site-wide toast. Saving goes through options.php (its nonce and the
 * manage_options check); "Test connection" has its own nonce and check.
 *
 * @package Plaudit
 */

defined( 'ABSPATH' ) || exit;

add_action( 'admin_menu', 'plaudit_admin_menu' );
add_action( 'admin_init', 'plaudit_register_settings' );
add_action( 'admin_post_plaudit_test', 'plaudit_test_connection' );
add_filter( 'plugin_action_links_' . plugin_basename( PLAUDIT_DIR . 'plaudit.php' ), 'plaudit_action_links' );

function plaudit_admin_menu() {
	add_options_page( __( 'Plaudit', 'plaudit' ), __( 'Plaudit', 'plaudit' ), 'manage_options', 'plaudit', 'plaudit_settings_page' );
}

/**
 * @param array $links The plugin row's links.
 * @return array
 */
function plaudit_action_links( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=plaudit' ) ) . '">' . esc_html__( 'Settings', 'plaudit' ) . '</a>' );
	return $links;
}

function plaudit_register_settings() {
	register_setting( 'plaudit', 'plaudit_url', array( 'type' => 'string', 'sanitize_callback' => 'plaudit_sanitize_url', 'default' => '' ) );
	register_setting( 'plaudit', 'plaudit_api_key', array( 'type' => 'string', 'sanitize_callback' => 'plaudit_sanitize_key', 'default' => '' ) );
	register_setting( 'plaudit', 'plaudit_seo', array( 'type' => 'string', 'sanitize_callback' => 'plaudit_sanitize_flag', 'default' => '1' ) );
	register_setting( 'plaudit', 'plaudit_cache_minutes', array( 'type' => 'integer', 'sanitize_callback' => 'plaudit_sanitize_minutes', 'default' => 10 ) );
	register_setting( 'plaudit', 'plaudit_toast_widget', array( 'type' => 'string', 'sanitize_callback' => 'plaudit_sanitize_widget', 'default' => '' ) );
}

/**
 * @param string $value What was typed.
 * @return string
 */
function plaudit_sanitize_url( $value ) {
	$url = untrailingslashit( esc_url_raw( trim( (string) $value ), array( 'https', 'http' ) ) );
	if ( '' !== trim( (string) $value ) && '' === $url ) {
		add_settings_error( 'plaudit_url', 'plaudit_url', __( 'Enter your Plaudit address, starting with https://', 'plaudit' ) );
	}
	return $url;
}

/**
 * An empty field keeps the saved key (it's never shown again); "-" removes it.
 *
 * @param string $value What was typed.
 * @return string
 */
function plaudit_sanitize_key( $value ) {
	$value = trim( (string) $value );
	if ( '' === $value ) {
		return (string) get_option( 'plaudit_api_key', '' );
	}
	if ( '-' === $value ) {
		return '';
	}
	if ( ! preg_match( '/^plk_[A-Za-z0-9_-]{20,}$/', $value ) ) {
		add_settings_error( 'plaudit_api_key', 'plaudit_api_key', __( 'That isn’t a Plaudit API key: it starts with plk_. The saved key was kept.', 'plaudit' ) );
		return (string) get_option( 'plaudit_api_key', '' );
	}
	return $value;
}

/**
 * @param mixed $value The checkbox.
 * @return string
 */
function plaudit_sanitize_flag( $value ) {
	return $value ? '1' : '0';
}

/**
 * @param mixed $value Minutes.
 * @return int
 */
function plaudit_sanitize_minutes( $value ) {
	return min( max( absint( $value ), 1 ), 1440 );
}

/**
 * @param string $value A widget id, or empty.
 * @return string
 */
function plaudit_sanitize_widget( $value ) {
	$value = strtolower( trim( (string) $value ) );
	if ( '' !== $value && ! preg_match( PLAUDIT_WIDGET_ID, $value ) ) {
		add_settings_error( 'plaudit_toast_widget', 'plaudit_toast_widget', __( 'The toast needs a widget id like w_abc123def456.', 'plaudit' ) );
		return '';
	}
	return $value;
}

/**
 * GET a path of the Plaudit REST API with the saved key, from PHP only.
 *
 * @param string $path e.g. /projects.
 * @return array|WP_Error The decoded JSON.
 */
function plaudit_api_get( $path ) {
	$server = plaudit_server();
	$key    = (string) get_option( 'plaudit_api_key', '' );
	if ( '' === $server || '' === $key ) {
		return new WP_Error( 'plaudit_not_set', __( 'Set the Plaudit address and an API key first.', 'plaudit' ) );
	}
	$res = wp_remote_get(
		$server . '/api/v1' . $path,
		array(
			'timeout'     => 8,
			'redirection' => 0,
			'headers'     => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
			),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( 200 !== $code ) {
		/* translators: 1: HTTP status, 2: the server's message. */
		return new WP_Error( 'plaudit_http', sprintf( __( 'Plaudit answered %1$d: %2$s', 'plaudit' ), $code, is_array( $body ) && isset( $body['error'] ) ? $body['error'] : '' ) );
	}
	return is_array( $body ) ? $body : new WP_Error( 'plaudit_json', __( 'Plaudit sent something that isn’t JSON. Check the address.', 'plaudit' ) );
}

/** "Test connection": lists the projects the key can see. */
function plaudit_test_connection() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You can’t change these settings.', 'plaudit' ), 403 );
	}
	check_admin_referer( 'plaudit_test' );
	$res = plaudit_api_get( '/projects' );
	if ( is_wp_error( $res ) ) {
		$result = array( 'ok' => false, 'message' => $res->get_error_message() );
	} else {
		$names  = array_map(
			function ( $p ) {
				return isset( $p['name'] ) ? (string) $p['name'] : '';
			},
			isset( $res['data'] ) && is_array( $res['data'] ) ? $res['data'] : array()
		);
		/* translators: %s: project names. */
		$result = array( 'ok' => true, 'message' => sprintf( __( 'Connected. Projects: %s', 'plaudit' ), $names ? implode( ', ', $names ) : __( 'none yet', 'plaudit' ) ) );
	}
	set_transient( 'plaudit_test_' . get_current_user_id(), $result, MINUTE_IN_SECONDS );
	delete_transient( 'plaudit_embeds' );
	wp_safe_redirect( admin_url( 'options-general.php?page=plaudit&tested=1' ) );
	exit;
}

function plaudit_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$key    = (string) get_option( 'plaudit_api_key', '' );
	$tested = get_transient( 'plaudit_test_' . get_current_user_id() );
	if ( $tested ) {
		delete_transient( 'plaudit_test_' . get_current_user_id() );
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Plaudit', 'plaudit' ); ?></h1>
		<?php settings_errors(); ?>
		<?php if ( $tested ) : ?>
			<div class="notice <?php echo esc_attr( $tested['ok'] ? 'notice-success' : 'notice-error' ); ?>"><p><?php echo esc_html( $tested['message'] ); ?></p></div>
		<?php endif; ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'plaudit' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="plaudit_url"><?php esc_html_e( 'Plaudit address', 'plaudit' ); ?></label></th>
					<td>
						<input type="url" class="regular-text" id="plaudit_url" name="plaudit_url" value="<?php echo esc_attr( get_option( 'plaudit_url', '' ) ); ?>" placeholder="https://plaudit.example.com">
						<p class="description"><?php esc_html_e( 'Your Plaudit server, as in your browser’s address bar.', 'plaudit' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="plaudit_api_key"><?php esc_html_e( 'API key', 'plaudit' ); ?></label></th>
					<td>
						<input type="password" class="regular-text" id="plaudit_api_key" name="plaudit_api_key" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( $key ? substr( $key, 0, 8 ) . '…' : 'plk_…' ); ?>">
						<p class="description"><?php esc_html_e( 'A read-only key from Plaudit › Settings › API keys. It lets the block list your widgets and forms; it stays on this server and never reaches visitors. Leave empty to keep the saved key, or enter - to remove it.', 'plaudit' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Search engines', 'plaudit' ); ?></th>
					<td>
						<label><input type="checkbox" name="plaudit_seo" value="1" <?php checked( '1', get_option( 'plaudit_seo', '1' ) ); ?>> <?php esc_html_e( 'Put each widget’s testimonials in the page as HTML (with review markup), so search engines read them', 'plaudit' ); ?></label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="plaudit_cache_minutes"><?php esc_html_e( 'Keep that HTML for', 'plaudit' ); ?></label></th>
					<td><input type="number" min="1" max="1440" id="plaudit_cache_minutes" name="plaudit_cache_minutes" value="<?php echo esc_attr( (string) get_option( 'plaudit_cache_minutes', 10 ) ); ?>" class="small-text"> <?php esc_html_e( 'minutes', 'plaudit' ); ?></td>
				</tr>
				<tr>
					<th scope="row"><label for="plaudit_toast_widget"><?php esc_html_e( 'Site-wide toast', 'plaudit' ); ?></label></th>
					<td>
						<input type="text" class="regular-text code" id="plaudit_toast_widget" name="plaudit_toast_widget" value="<?php echo esc_attr( get_option( 'plaudit_toast_widget', '' ) ); ?>" placeholder="w_abc123def456">
						<p class="description"><?php esc_html_e( 'A widget with the toast layout, shown on every page. Leave empty for none.', 'plaudit' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="plaudit_test">
			<?php wp_nonce_field( 'plaudit_test' ); ?>
			<?php submit_button( __( 'Test connection', 'plaudit' ), 'secondary', 'submit', false ); ?>
		</form>
		<h2><?php esc_html_e( 'Using it', 'plaudit' ); ?></h2>
		<p><?php esc_html_e( 'Add the “Plaudit testimonials” block, or a shortcode:', 'plaudit' ); ?></p>
		<p><code>[plaudit widget="w_abc123def456"]</code> <code>[plaudit form="acme/stories"]</code></p>
		<p><?php esc_html_e( 'Using a caching or optimisation plugin? Exclude widget.js from combining and minifying (see the plugin’s readme).', 'plaudit' ); ?></p>
	</div>
	<?php
}
