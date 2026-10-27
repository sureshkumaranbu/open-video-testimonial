/**
 * The "Plaudit testimonials" block, in plain JavaScript (no build step). The
 * editor shows a picker and a placeholder; the page itself is rendered by PHP
 * (plaudit_render_block), exactly like the shortcode.
 */
( function ( wp ) {
	var el = wp.element.createElement;
	var useState = wp.element.useState;
	var useEffect = wp.element.useEffect;
	var __ = wp.i18n.__;
	var c = wp.components;
	var be = wp.blockEditor;

	function Edit( props ) {
		var a = props.attributes;
		var set = props.setAttributes;
		var blockProps = be.useBlockProps();
		var state = useState( null );
		var embeds = state[ 0 ];
		var setEmbeds = state[ 1 ];

		useEffect( function () {
			wp.apiFetch( { path: '/plaudit/v1/embeds' } )
				.then( setEmbeds )
				.catch( function () {
					setEmbeds( { widgets: [], forms: [], failed: true } );
				} );
		}, [] );

		var widgetOptions = [ { label: __( 'Choose a widget…', 'plaudit' ), value: '' } ].concat(
			( embeds ? embeds.widgets : [] ).map( function ( w ) {
				return { label: w.name + ' (' + w.layout + ', ' + w.project + ')', value: w.id };
			} )
		);
		var formOptions = [ { label: __( 'Choose a form…', 'plaudit' ), value: '' } ].concat(
			( embeds ? embeds.forms : [] ).map( function ( f ) {
				return { label: f.name + ' (' + f.projectName + ')', value: f.project + '/' + f.form };
			} )
		);
		var chosen = a.kind === 'form' ? ( a.project && a.form ? a.project + '/' + a.form : '' ) : a.widget;

		return el(
			'div',
			blockProps,
			el(
				be.InspectorControls,
				null,
				el(
					c.PanelBody,
					{ title: __( 'Plaudit', 'plaudit' ) },
					a.kind === 'widget' &&
						el( c.ToggleControl, {
							label: __( 'HTML for search engines', 'plaudit' ),
							checked: a.seo,
							onChange: function ( v ) {
								set( { seo: v } );
							},
						} ),
					a.kind === 'form' &&
						el( c.RangeControl, {
							label: __( 'Starting height (px)', 'plaudit' ),
							min: 320,
							max: 1600,
							value: a.height,
							onChange: function ( v ) {
								set( { height: v } );
							},
						} )
				)
			),
			el(
				c.Placeholder,
				{ icon: 'format-quote', label: __( 'Plaudit testimonials', 'plaudit' ) },
				el( c.SelectControl, {
					label: __( 'Show', 'plaudit' ),
					value: a.kind,
					options: [
						{ label: __( 'A saved widget', 'plaudit' ), value: 'widget' },
						{ label: __( 'A collection form', 'plaudit' ), value: 'form' },
					],
					onChange: function ( v ) {
						set( { kind: v } );
					},
				} ),
				embeds && ! embeds.failed && ( a.kind === 'widget' ? embeds.widgets.length : embeds.forms.length )
					? el( c.SelectControl, {
							label: a.kind === 'widget' ? __( 'Widget', 'plaudit' ) : __( 'Form', 'plaudit' ),
							value: chosen,
							options: a.kind === 'widget' ? widgetOptions : formOptions,
							onChange: function ( v ) {
								if ( a.kind === 'widget' ) set( { widget: v } );
								else set( { project: v.split( '/' )[ 0 ] || '', form: v.split( '/' )[ 1 ] || '' } );
							},
					  } )
					: a.kind === 'widget'
					? el( c.TextControl, {
							label: __( 'Widget id (w_…)', 'plaudit' ),
							help: __( 'From Widgets › your widget › Share in Plaudit. Add an API key in Settings › Plaudit to pick from a list.', 'plaudit' ),
							value: a.widget,
							onChange: function ( v ) {
								set( { widget: v.trim() } );
							},
					  } )
					: el(
							'div',
							null,
							el( c.TextControl, {
								label: __( 'Project slug', 'plaudit' ),
								value: a.project,
								onChange: function ( v ) {
									set( { project: v.trim() } );
								},
							} ),
							el( c.TextControl, {
								label: __( 'Form slug', 'plaudit' ),
								value: a.form,
								onChange: function ( v ) {
									set( { form: v.trim() } );
								},
							} )
					  ),
				el( 'p', { className: 'components-placeholder__instructions' }, chosen ? __( 'It shows on the published page.', 'plaudit' ) : '' )
			)
		);
	}

	wp.blocks.registerBlockType( 'plaudit/embed', {
		edit: Edit,
		save: function () {
			return null;
		},
	} );
} )( window.wp );
