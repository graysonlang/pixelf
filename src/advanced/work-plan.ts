export interface BoundedWorkRequest {
  bytesPerPixel: number;
  height: number;
  iterations: number;
  maxBytes: number;
  maxIterations: number;
  maxWorkgroups: number;
  width: number;
  workgroupHeight?: number;
  workgroupWidth?: number;
}

export interface BoundedWorkPlan {
  bytes: number;
  height: number;
  iterations: number;
  pingPongBuffers: 2;
  width: number;
  workgroupsPerIteration: number;
}

export function createBoundedWorkPlan(request: BoundedWorkRequest): BoundedWorkPlan {
  const values = [
    request.width,
    request.height,
    request.iterations,
    request.bytesPerPixel,
    request.maxBytes,
    request.maxIterations,
    request.maxWorkgroups,
  ];
  if (!values.every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('Bounded work values must be positive integers');
  }
  if (request.iterations > request.maxIterations) {
    throw new Error('Iterative operation exceeds its declared iteration limit');
  }
  const workgroupWidth = request.workgroupWidth ?? 8;
  const workgroupHeight = request.workgroupHeight ?? 8;
  const workgroupsPerIteration =
    Math.ceil(request.width / workgroupWidth) * Math.ceil(request.height / workgroupHeight);
  if (workgroupsPerIteration * request.iterations > request.maxWorkgroups) {
    throw new Error('Iterative operation exceeds its declared workgroup limit');
  }
  const bytes = request.width * request.height * request.bytesPerPixel * 2;
  if (bytes > request.maxBytes) {
    throw new Error('Iterative operation exceeds its declared memory limit');
  }
  return {
    bytes,
    height: request.height,
    iterations: request.iterations,
    pingPongBuffers: 2,
    width: request.width,
    workgroupsPerIteration,
  };
}

export async function runBoundedIterations(
  plan: BoundedWorkPlan,
  step: (iteration: number) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<number> {
  let completed = 0;
  for (let iteration = 0; iteration < plan.iterations; iteration += 1) {
    if (signal?.aborted) break;
    await step(iteration);
    completed += 1;
  }
  return completed;
}
