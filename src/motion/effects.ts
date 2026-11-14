// The tier 1 effects entry (T-031; P-12, D-053). It starts the three DOM motion modules, each exporting
// `start(root, signal)`: the pointer rows (T-031), the reading rows (T-033) and the fact rows (T-034). Each module
// undoes itself when `signal` aborts and may be started again after Play.
import { start as startFacts } from "./effects/facts.ts";
import { start as startPointer } from "./effects/pointer.ts";
import { start as startReading } from "./effects/reading.ts";

export async function startEffects(root: HTMLElement, signal: AbortSignal): Promise<void> {
  await Promise.all([startPointer(root, signal), startReading(root, signal), startFacts(root, signal)]);
}
