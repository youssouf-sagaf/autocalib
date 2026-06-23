import type {
  CalibEditEvent,
  CalibEditMode,
  CalibJobStatus,
  CalibProgress,
  CalibTab,
  CalibrationSlotEntry,
  DeviceCalibBbox,
  PairingEditEvent,
  PairingLink,
  PairingTool,
  PairingZone,
  PairingZonePolygon,
  SuggestedZonePairing,
} from '../types';
import type { PairingBySlotId } from '../utils/pairing-map';
import type { CalibBboxProdMeta } from '../utils/calibrationDb';

export type { CalibBboxProdMeta };

export interface CalibState {
  /** Active workspace tab (Production / Generate / Compare). */
  viewTab: CalibTab;
  deviceId: string;
  client: string;
  jobId: string | null;
  jobStatus: CalibJobStatus;
  jobProgress: CalibProgress | null;
  jobError: string | null;
  bboxes: DeviceCalibBbox[];
  frameCount: number;
  totalDetections: number;
  activeFrameIndex: number;
  editMode: CalibEditMode;
  selectedBboxIds: number[];
  lockedBboxIds: number[];
  editHistory: CalibEditEvent[];
  editIndex: number;
  confidenceThreshold: number;
  canvasZoom: number;
  canvasPanX: number;
  canvasPanY: number;
  sessionRevision: number;
  lastCalibSubmitConfidenceThreshold: number | null;
  showCalibEditorResult: boolean;
  imageWidth: number;
  imageHeight: number;
  streetName: string | null;
  calibrationDbSlots: Record<string, CalibrationSlotEntry>;
  /** static_data.calibration.bboxes keys at last DB load (for delete diff logging). */
  calibrationDbBboxKeys: string[];
  /** Prod key → bbox geometry at last DB load or save (for save diff). */
  calibrationDbBboxesByKey: Record<string, DeviceCalibBbox>;
  /** Prod key → canvas spot # at last DB load (for delete labels in save modal). */
  calibrationDbBboxMeta: Record<string, CalibBboxProdMeta>;
  /** Appariement prod snapshot (slot_id → canvas spot #) at last DB load or pairing save. */
  prodPairingBySlotId: PairingBySlotId;
  isSavingCalibration: boolean;
  calibrationLoadedFromDb: boolean;
  /** True while prod/local calibration is being resolved for the active device. */
  calibrationLoading: boolean;
}

export interface AutoSuggestProposal {
  mapSlotIds: string[];
  imageBboxIds: number[];
  mapPolygon: PairingZonePolygon;
  imagePolygon: PairingZonePolygon;
}

export interface AutoSuggestState {
  drawnSide: 'map' | 'image';
  drawnSlotIds: string[];
  drawnBboxIds: number[];
  drawnPolygon: PairingZonePolygon;
  proposals: AutoSuggestProposal[];
  proposalIndex: number;
  maxAttempts: number;
}

export interface PairingState {
  activeTool: PairingTool;
  pairingBySlotId: PairingBySlotId;
  links: PairingLink[];
  zones: PairingZone[];
  selectedSlotId: string | null;
  selectedBboxId: number | null;
  drawingMapPoints: [number, number][];
  drawingImagePoints: [number, number][];
  activeZoneId: string | null;
  activeZoneSide: 'map' | 'image' | null;
  suggestion: SuggestedZonePairing | null;
  zoneMismatchError: string | null;
  autoSuggestMode: boolean;
  autoSuggest: AutoSuggestState | null;
  editHistory: PairingEditEvent[];
  editIndex: number;
}
