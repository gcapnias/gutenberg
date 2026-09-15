import { afterEach, describe, expect, it } from 'vitest';
import getRectangleFromRange from '../get-rectangle-from-range';

describe( 'getRectangleFromRange', () => {
	afterEach( () => {
		delete window.Range.prototype.getClientRects;
		document.body.innerHTML = '';
	} );

	// jsdom does not lay out, and its ranges have no `getClientRects`: give
	// listed start containers a rectangle, everything else none.
	function rectsFor( ranges ) {
		window.Range.prototype.getClientRects = function () {
			const match = ranges.find(
				( [ node ] ) => node === this.startContainer
			);
			return match ? [ match[ 1 ] ] : [];
		};
	}

	it( 'measures a caret in an empty text node from the text after it, without changing the DOM', () => {
		document.body.innerHTML = '<p></p>';
		const paragraph = document.querySelector( 'p' );
		const empty = document.createTextNode( '' );
		const padding = document.createTextNode( '﻿' );
		paragraph.append( empty, padding );
		rectsFor( [ [ padding, new window.DOMRect( 40, 100, 0, 24 ) ] ] );
		const mutations = [];
		new window.MutationObserver( ( records ) =>
			mutations.push( ...records )
		).observe( paragraph, { childList: true, subtree: true } );

		const range = document.createRange();
		range.setStart( empty, 0 );
		range.setEnd( empty, 0 );
		const rect = getRectangleFromRange( range );

		expect( rect ).toMatchObject( {
			left: 40,
			top: 100,
			width: 0,
			height: 24,
		} );
		expect( Array.from( paragraph.childNodes ) ).toEqual( [
			empty,
			padding,
		] );
		return Promise.resolve().then( () => {
			expect( mutations ).toEqual( [] );
		} );
	} );

	it( 'measures a caret at the end of an element from the text before it', () => {
		document.body.innerHTML = '<p>ab</p>';
		const paragraph = document.querySelector( 'p' );
		rectsFor( [
			[ paragraph.firstChild, new window.DOMRect( 60, 100, 0, 24 ) ],
		] );

		const range = document.createRange();
		range.setStart( paragraph, 1 );
		range.setEnd( paragraph, 1 );

		expect( getRectangleFromRange( range ) ).toMatchObject( {
			left: 60,
			top: 100,
			height: 24,
		} );
	} );

	it( 'returns null when nothing around the caret is rendered', () => {
		document.body.innerHTML = '<p></p>';
		const paragraph = document.querySelector( 'p' );
		rectsFor( [] );

		const range = document.createRange();
		range.setStart( paragraph, 0 );
		range.setEnd( paragraph, 0 );

		expect( getRectangleFromRange( range ) ).toBeNull();
		expect( paragraph.childNodes.length ).toBe( 0 );
	} );
} );
