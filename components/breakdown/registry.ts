import type { ComponentType } from "react";
import CubeSatBreakdown from "@/components/orbit/CubeSatBreakdown";
import HydrogenBreakdown from "./hydrogen/HydrogenBreakdown";
import LinesBreakdown from "./lines/LinesBreakdown";
import DiscoBreakdown from "./disco/DiscoBreakdown";
import AlltusBreakdown from "./alltus/AlltusBreakdown";
import CrimsonleadBreakdown from "./crimsonlead/CrimsonleadBreakdown";
import BottleneckBreakdown from "./bottleneck/BottleneckBreakdown";
import BoseBreakdown from "./bose/BoseBreakdown";
import EducationBreakdown from "./education/EducationBreakdown";

/** The scroll breakdown for a project, keyed by its slug. */
export const breakdowns: Record<string, ComponentType<{ className?: string }>> = {
  cubesat: CubeSatBreakdown,
  "hydrogen-plant": HydrogenBreakdown,
  "production-lines": LinesBreakdown,
  disco: DiscoBreakdown,
  alltus: AlltusBreakdown,
  crimsonlead: CrimsonleadBreakdown,
  "bottleneck-radar": BottleneckBreakdown,
  "bose-ar": BoseBreakdown,
  "ai-education-assistant": EducationBreakdown,
};
