export { analyzeSurface, type SurfaceAnalysis } from './analysis.js';
export { sharedBranchCacheKey, type SharedCacheLifetime } from './reuse.js';
export {
  createBoundedWorkPlan,
  runBoundedIterations,
  type BoundedWorkPlan,
  type BoundedWorkRequest,
} from './work-plan.js';
