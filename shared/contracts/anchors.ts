export type AnchorType = "point" | "area" | "facing" | "path";

export interface BlockPosition {
  x: number;
  y: number;
  z: number;
}

export interface FacingVector {
  x: number;
  y: number;
  z: number;
}

export interface PointAnchorPayload {
  position: BlockPosition;
}

export interface AreaAnchorPayload {
  cornerA: BlockPosition;
  cornerB: BlockPosition;
}

export interface FacingAnchorPayload {
  origin: BlockPosition;
  direction: FacingVector;
  maxDistance?: number | null;
}

export interface PathAnchorPayload {
  points: BlockPosition[];
}

export type AnchorPayload =
  | PointAnchorPayload
  | AreaAnchorPayload
  | FacingAnchorPayload
  | PathAnchorPayload;

export interface Anchor {
  id: string;
  worldId: string;
  label: string;
  type: AnchorType;
  source:
    | "player_position"
    | "look_direction"
    | "marker_block"
    | "area_corners"
    | "manual";
  payload: AnchorPayload;
  createdAt: string;
  updatedAt: string;
}

export interface AnchorSummary {
  id: string;
  label: string;
  type: AnchorType;
  description: string;
}
