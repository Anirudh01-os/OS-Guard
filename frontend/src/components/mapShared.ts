import { READINESS_COLOR, urgencyColor } from "../lib/format";
import type { FleetItem } from "../lib/types";

export type ColorMode = "readiness" | "urgency";
export interface FleetMapProps {
  items: FleetItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  dimIds?: Set<string> | null; // machines NOT matching the current filter
  colorMode?: ColorMode;
  reduceMotion?: boolean;
}

export const nodeColor = (it: FleetItem, mode: ColorMode) => (mode === "urgency" ? urgencyColor(it.urgency) : READINESS_COLOR[it.readiness]);
