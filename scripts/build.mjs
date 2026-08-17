import pluginGlobCopy from '@graysonlang/esp/esbuild-plugin-glob-copy';
import pluginImp from '@graysonlang/esp/esbuild-plugin-imp';
import { runBuild } from '@graysonlang/esp/esbuild-runner';
import { createDefines } from './defines.mjs';

/** @type {import('@graysonlang/esp/esbuild-runner').GetOptions} */
function getOptions(args, verbose, logger) {
  return {
    assetNames: '[name]',
    bundle: true,
    define: createDefines(),
    entryPoints: {
      index: 'src/index.js',
      main: 'app/main.js',
    },
    format: 'esm',
    loader: {
      '.html': 'file',
    },
    outdir: 'www',
    plugins: [pluginGlobCopy({ logger }), pluginImp({ logger, verbose })],
    target: ['esnext'],
    ...args,
  };
}

runBuild(getOptions);
