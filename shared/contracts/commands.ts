import type { AnchorType, BlockPosition } from "./anchors";

export interface CommandEnvelope {
  commandId: string;
  timestamp: string;
  correlationId?: string;
}

export interface RunTaskCommand extends CommandEnvelope {
  type: "run_task";
  taskText: string;
  requestedBy: string;
  anchorId?: string | null;
}

export interface PauseCommand extends CommandEnvelope {
  type: "pause";
}

export interface ResumeCommand extends CommandEnvelope {
  type: "resume";
}

export interface ReconnectCommand extends CommandEnvelope {
  type: "reconnect";
  reason?: string;
}

export interface WhatWorkedCommand extends CommandEnvelope {
  type: "what_worked";
}

export interface CreateAnchorFromPlayerPositionCommand extends CommandEnvelope {
  type: "create_anchor_from_player_position";
  label: string;
}

export interface CreateAnchorFromLookDirectionCommand extends CommandEnvelope {
  type: "create_anchor_from_look_direction";
  label: string;
  maxDistance?: number | null;
}

export interface CreateAnchorFromMarkerBlockCommand extends CommandEnvelope {
  type: "create_anchor_from_marker_block";
  label: string;
  markerBlockName: string;
}

export interface CreateAreaAnchorFromCornersCommand extends CommandEnvelope {
  type: "create_area_anchor_from_corners";
  label: string;
  cornerA: BlockPosition;
  cornerB: BlockPosition;
}

export interface CreateManualAnchorCommand extends CommandEnvelope {
  type: "create_manual_anchor";
  label: string;
  anchorType: AnchorType;
}

export type DashboardCommand =
  | RunTaskCommand
  | PauseCommand
  | ResumeCommand
  | ReconnectCommand
  | WhatWorkedCommand
  | CreateAnchorFromPlayerPositionCommand
  | CreateAnchorFromLookDirectionCommand
  | CreateAnchorFromMarkerBlockCommand
  | CreateAreaAnchorFromCornersCommand
  | CreateManualAnchorCommand;
