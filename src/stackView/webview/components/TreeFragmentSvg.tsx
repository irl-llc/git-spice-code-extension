/**
 * React wrapper for createTreeFragmentSvg.
 *
 * The SVG generator produces an SVGSVGElement imperatively; we mount it
 * via useEffect + ref. Re-generates when fragment or colors change.
 */

import { useEffect, useRef, type JSX } from 'react';

import type { TreeFragmentData } from '../../types';
import { createTreeFragmentSvg, type TreeColors } from '../../tree/treeFragment';

export interface TreeFragmentSvgProps {
	fragment: TreeFragmentData;
	colors: TreeColors;
}

export function TreeFragmentSvg({ fragment, colors }: TreeFragmentSvgProps): JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!ref.current) return;
		ref.current.replaceChildren(createTreeFragmentSvg(fragment, colors));
	}, [fragment, colors]);
	return <div ref={ref} className="tree-fragment-host" />;
}
