#!/usr/bin/env node
try {
  const { runPrepareSteps } = await import('@graysonlang/esp/prepare');
  runPrepareSteps([
    {
      label: 'sync launch.json',
      args: ['./scripts/build.mjs', '--sync-launch'],
    },
    {
      label: 'sync .mcp.json',
      args: ['./node_modules/@graysonlang/esp/scripts/sync-mcp.mjs'],
    },
  ]);
} catch (error) {
  console.warn(`prepare: skipped (${error instanceof Error ? error.message : String(error)})`);
}
