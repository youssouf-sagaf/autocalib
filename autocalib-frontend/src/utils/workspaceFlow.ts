import type { WorkspaceStep } from '../types';

const STEP_ORDER: WorkspaceStep[] = ['absmap', 'calib', 'pairing'];

const PATH_BY_STEP: Record<WorkspaceStep, string> = {
  absmap: '/absmap',
  calib: '/calib',
  pairing: '/pairing',
};

/**
 * Route to the furthest completed workflow step for this device (`recentDevices[].completedSteps`).
 * Order is Absmap → Calib → Pairing; e.g. if calib is done, opens `/calib`.
 * If nothing is marked complete yet, opens Absmap.
 */
export function pathForLastCompletedStep(completed?: WorkspaceStep[]): string {
  const done = new Set(completed ?? []);
  for (let i = STEP_ORDER.length - 1; i >= 0; i--) {
    const step = STEP_ORDER[i]!;
    if (done.has(step)) return PATH_BY_STEP[step];
  }
  return '/absmap';
}
