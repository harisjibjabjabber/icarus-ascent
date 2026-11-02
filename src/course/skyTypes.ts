export type SkyVariant = 'sky-intro' | 'sky-hop' | 'sky-gap' | 'sky-gauntlet';
export interface Tuft { id: number; x0: number; x1: number; yBase: number; catchH: number; exitX: number; exitY: number; lateral: number; source: 'grate' | 'drain'; segmentId: number }
export interface SkyAnchor { x: number; y: number; lateral: number; kind: 'bracket-left' | 'bracket-right' | 'mast' | 'ship-mast' }
export interface SkyLine { railId: number; anchors: SkyAnchor[]; laundry: boolean }
export interface SkyCluster { bounceId: number; count: number; tether: SkyAnchor; seed: number }
export interface SkyHop { x0: number; x1: number; action: 'down' | 'jump' | 'roll'; targetRail?: number; targetBounce?: number }
export interface SkySegment { id: number; variant: SkyVariant; x0: number; gx: number; xLand: number; x1: number; yBase: number; tuftId: number; lines: SkyLine[]; clusters: SkyCluster[]; hops: SkyHop[]; gapBelow: { x0: number; x1: number } | null }
