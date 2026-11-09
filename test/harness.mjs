// Test helpers: a Model 4 with disks, and a script of [wait for, type]
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { Z80 } from '../z80.js';
import { Model4, CPU_HZ } from '../m4.js';
import { loadDisk } from '../floppy.js';

const here = f => new URL('../' + f, import.meta.url);
export function file(f) {
  let b = readFileSync(f.startsWith('/') ? f : here(f));
  if (b[0] === 0x1F) b = gunzipSync(b);
  return new Uint8Array(b);
}
export async function floppy(f) { return loadDisk(file(f), f.split('/').pop()); }
export function machine(hdimg, floppies = []) {
  const m = new Model4(Z80, hdimg);
  floppies.forEach((d, i) => { m.fdc.drives[i] = d; });
  return m;
}
// Each step waits (up to secs of emulated time in all) until the last line
// on the screen ends with its text, then types its line (null: nothing)
export function script(m, steps, secs = 200) {
  steps = steps.slice();
  let seen = '';
  for (let t = 0; t < secs * 10 && steps.length; t++) {
    m.run(CPU_HZ / 10);
    const scr = m.text();
    const last = (scr.split('\n').filter(x => x.trim()).pop() || '').replace(/[_\s]+$/, '');
    if (!m.typing.length && last.endsWith(steps[0][0]) && scr !== seen) {
      seen = scr;
      const s = steps.shift()[1];
      if (s !== null) for (const ch of s + '\r') m.key(ch);
    }
  }
  for (let t = 0; t < 20; t++) m.run(CPU_HZ / 10);
  return { screen: m.text(), left: steps.length };
}
