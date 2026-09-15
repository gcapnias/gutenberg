import { assertIsDefined } from '../utils/assert-is-defined';

/**
 * Get the rectangle of a given Range. Returns `null` if no suitable rectangle
 * can be found. Use instead of `Range.getBoundingClientRect()`, which is often
 * broken, especially for collapsed ranges.
 *
 * @param {Range} range The range.
 *
 * @return {DOMRect?} The rectangle.
 */
export default function getRectangleFromRange( range ) {
	// For uncollapsed ranges, get the rectangle that bounds the contents of the
	// range; this a rectangle enclosing the union of the bounding rectangles
	// for all the elements in the range.
	if ( ! range.collapsed ) {
		const rects = Array.from( range.getClientRects() );

		// If there's just a single rect, return it.
		if ( rects.length === 1 ) {
			return rects[ 0 ];
		}

		// Ignore tiny selection at the edge of a range.
		const filteredRects = rects.filter( ( { width } ) => width > 1 );

		// If it's full of tiny selections, return browser default.
		if ( filteredRects.length === 0 ) {
			return range.getBoundingClientRect();
		}

		if ( filteredRects.length === 1 ) {
			return filteredRects[ 0 ];
		}

		let {
			top: furthestTop,
			bottom: furthestBottom,
			left: furthestLeft,
			right: furthestRight,
		} = filteredRects[ 0 ];

		for ( const { top, bottom, left, right } of filteredRects ) {
			if ( top < furthestTop ) {
				furthestTop = top;
			}
			if ( bottom > furthestBottom ) {
				furthestBottom = bottom;
			}
			if ( left < furthestLeft ) {
				furthestLeft = left;
			}
			if ( right > furthestRight ) {
				furthestRight = right;
			}
		}

		return new window.DOMRect(
			furthestLeft,
			furthestTop,
			furthestRight - furthestLeft,
			furthestBottom - furthestTop
		);
	}

	const { startContainer } = range;
	const { ownerDocument } = startContainer;

	// Correct invalid "BR" ranges. The cannot contain any children.
	if ( startContainer.nodeName === 'BR' ) {
		const { parentNode } = startContainer;
		assertIsDefined( parentNode, 'parentNode' );
		const index = /** @type {Node[]} */ (
			Array.from( parentNode.childNodes )
		).indexOf( startContainer );

		assertIsDefined( ownerDocument, 'ownerDocument' );
		range = ownerDocument.createRange();
		range.setStart( parentNode, index );
		range.setEnd( parentNode, index );
	}

	const rects = range.getClientRects();

	// If we have multiple rectangles for a collapsed range, there's no way to
	// know which it is, so don't return anything.
	if ( rects.length > 1 ) {
		return null;
	}

	// A collapsed range at a soft line wrap is equally ambiguous: the same
	// position ends one line and starts the next. Some browsers (Gecko)
	// return a single rectangle for it, on the upper line, regardless of
	// where the caret is. Detect the boundary by measuring the characters
	// around the position: when they sit on different lines, there is no
	// way to know which line the caret is on, so don't return anything.
	if (
		rects.length === 1 &&
		startContainer.nodeType === startContainer.TEXT_NODE &&
		range.startOffset > 0 &&
		range.startOffset < /** @type {Text} */ ( startContainer ).length
	) {
		assertIsDefined( ownerDocument, 'ownerDocument' );
		const measure = (
			/** @type {number} */ start,
			/** @type {number} */ end
		) => {
			const charRange = ownerDocument.createRange();
			charRange.setStart( startContainer, start );
			charRange.setEnd( startContainer, end );
			return charRange.getBoundingClientRect();
		};
		const before = measure( range.startOffset - 1, range.startOffset );
		const after = measure( range.startOffset, range.startOffset + 1 );

		if ( before.bottom <= after.top ) {
			return null;
		}
	}

	const rect = rects[ 0 ];

	// A collapsed range at an element node or in an empty text node has no
	// rectangles in some browsers.
	if ( ! rect || rect.height === 0 ) {
		return getRectangleFromNeighbours( range );
	}

	return rect;
}

/**
 * Measures a collapsed range that has no rectangles of its own from the
 * rendered content around it, without changing the DOM: the position is at
 * the left edge of what follows it, or the right edge of what precedes it,
 * within the same parent. Falls back to the left edge of the parent's box.
 * Inserting a temporary text node to measure would rewrite the tree under
 * the caret, which drops a keystroke that is being inserted on iOS.
 *
 * @param {Range} range The collapsed range.
 *
 * @return {DOMRect?} The rectangle.
 */
function getRectangleFromNeighbours( range ) {
	const { startContainer, startOffset } = range;
	const { ownerDocument } = startContainer;
	assertIsDefined( ownerDocument, 'ownerDocument' );
	const { defaultView } = ownerDocument;
	assertIsDefined( defaultView, 'defaultView' );

	const isText = startContainer.nodeType === startContainer.TEXT_NODE;
	const parent = isText ? startContainer.parentNode : startContainer;
	assertIsDefined( parent, 'parent' );
	const children = /** @type {Node[]} */ ( Array.from( parent.childNodes ) );
	// The index of the first child after the position.
	const index = isText
		? children.indexOf( startContainer ) +
		  ( startOffset === /** @type {Text} */ ( startContainer ).length
				? 1
				: 0 )
		: startOffset;

	const caretRect = ( /** @type {DOMRect} */ box, atEnd = false ) =>
		new defaultView.DOMRect(
			atEnd ? box.right : box.left,
			box.top,
			0,
			box.height
		);

	/**
	 * The first rectangle of a node's rendered content, from its start or
	 * its end.
	 *
	 * @param {Node}    node  The node.
	 * @param {boolean} atEnd Whether to measure the end of the node.
	 *
	 * @return {DOMRect?} The rectangle.
	 */
	const measure = ( node, atEnd ) => {
		let boxes;
		if ( node.nodeType === node.TEXT_NODE ) {
			const probe = ownerDocument.createRange();
			const length = /** @type {Text} */ ( node ).length;
			probe.setStart( node, atEnd ? length : 0 );
			probe.setEnd( node, atEnd ? length : 0 );
			boxes = probe.getClientRects();
		} else if ( node.nodeType === node.ELEMENT_NODE ) {
			boxes = /** @type {Element} */ ( node ).getClientRects();
		}
		const box = boxes && ( atEnd ? boxes[ boxes.length - 1 ] : boxes[ 0 ] );
		return box && box.height > 0 ? caretRect( box, atEnd ) : null;
	};

	for ( let i = index; i < children.length; i++ ) {
		const measured = measure( children[ i ], false );
		if ( measured ) {
			return measured;
		}
	}
	for ( let i = index - 1; i >= 0; i-- ) {
		const measured = measure( children[ i ], true );
		if ( measured ) {
			return measured;
		}
	}

	if ( parent.nodeType === parent.ELEMENT_NODE ) {
		const box = /** @type {Element} */ ( parent ).getBoundingClientRect();
		if ( box.height > 0 ) {
			return caretRect( box );
		}
	}

	return null;
}
