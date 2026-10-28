import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints:['tests/detection/run.ts'], outfile:'.test-output/detection.mjs', bundle:true, platform:'node', format:'esm', packages:'external' });
const args=process.argv.slice(2);
const suites=args.length?[args]:[[],['--fallback']];
for (const suite of suites) {
  const run=spawnSync(process.execPath,['.test-output/detection.mjs',...suite],{stdio:'inherit'});
  if(run.status!==0)process.exitCode=1;
}
