// test.mjs: boot the disks in disks/ under Node and use the floppy drives
// from LS-DOS. Takes a few seconds.
//
//   node test/test.mjs
import { file, floppy, machine, script } from './harness.mjs';
import { Disk, loadDisk, toJV3, toDMK, toIMD } from '../floppy.js';

let fails = 0;
function expect(what, ok, screen) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) { fails++; console.log(screen); }
}
const lsdosLogin = [['?', '11/09/26'], ['?', '12:00:00']];
const lsdos = (disks, cmds, secs = 400) => {
  const m = machine(file('disks/lsdos631n-m4-hd.hdv.gz'), disks);
  m.bootHd();
  return script(m, [...lsdosLogin, ...cmds.map(c => ['Ready', c]), ['Ready', null]], secs);
};
const fuzixLogin = [['login:', 'root']];

// Fuzix from the hard disk, as the 4P boot ROM or FreHD starts it: root
// hda2 without asking
{
  const m = machine(file('disks/hard4p-0.hdv.gz'));
  const ok = m.bootHd();
  const r = script(m, [...fuzixLogin, ['#', 'uname -a'], ['#', 'df'], ['#', null]], 200);
  expect('Fuzix: boots from the hard disk without asking for the root', ok && !/bootdev:/.test(r.screen) &&
    /Fuzix 0\.5 +trs80/.test(r.screen) && /\/dev\/hda2 .*% \//.test(r.screen), r.screen);
}

// Fuzix from both boot floppies, root on the hard disk (boot.dsk asks)
for (const [disk, ask] of [['disks/boot.dsk.gz', true], ['disks/hdboot.dsk.gz', false]]) {
  const m = machine(file('disks/hard4p-0.hdv.gz'), [await floppy(disk)]);
  const ok = m.bootFloppy();
  const r = script(m, [...(ask ? [['bootdev:', 'hda2']] : []), ...fuzixLogin, ['#', 'df'], ['#', null]], 200);
  expect('Fuzix: boots from ' + disk, ok && /\/dev\/hda2 .*% \//.test(r.screen), r.screen);
}

// Fuzix: a file system on the LS-DOS data floppy in drive 2, read back
// from drive 1 after a reboot
{
  const fd = await floppy('disks/lsdos-data.dsk.gz');
  let m = machine(file('disks/hard4p-0.hdv.gz'), [null, fd]);
  m.bootHd();
  script(m, [...fuzixLogin, ['#', 'mkfs /dev/fd1 32 360'], ['Confirm?', 'y'], ['#', 'mount /dev/fd1 /mnt'],
    ['#', 'echo hallo > /mnt/x'], ['#', 'cp /bin/ls /mnt'], ['#', 'umount /mnt'], ['#', null]], 300);
  m = machine(file('disks/hard4p-0.hdv.gz'), [fd]);
  m.bootHd();
  const r = script(m, [...fuzixLogin, ['#', 'mount /dev/fd0 /mnt'], ['#', 'cat /mnt/x'], ['#', '/mnt/ls /mnt'],
    ['#', 'df'], ['#', null]], 300);
  expect('Fuzix: mkfs on a floppy, read and run from it after a reboot',
    /\nhallo\n/.test(r.screen) && /\nls\nx\n/.test(r.screen) && /\/dev\/fd0 +328 /.test(r.screen), r.screen);
}

// LS-DOS from the hard disk: the data floppy as :1, a blank one formatted as :2
{
  let r = lsdos([], ['FREE']);
  expect('LS-DOS: boots, FREE sees the hard disk', /Drive :0  LSDOS-HD .*6464\.00K/.test(r.screen), r.screen);
  const data = await floppy('disks/lsdos-data.dsk.gz');
  const blank = new Disk('blank');
  r = lsdos([data, blank], ['FORMAT :2 (N="TWEE",M="PASSWORD",DDEN,SIDES=1,CYL=40,ABS)',
    'COPY NOTICE/TXT:0 :1', 'COPY BACKUP/CMD:0 :2', 'FREE']);
  expect('LS-DOS: FORMAT :2 on a blank floppy', /Formatting complete/.test(r.screen), r.screen);
  expect('LS-DOS: FREE sees :1 and :2, 40 cylinders',
    /Drive :1  DATA .*\/ +180\.00K[\s\S]*Drive :2  TWEE .*\/ +180\.00K/.test(r.screen), r.screen);
  // save both, load them back in the other drives
  const d1 = await loadDisk(toJV3(data), 'data.dsk'), d2 = await loadDisk(toDMK(blank), 'twee.dmk');
  r = lsdos([d2, d1], ['DIR :1', 'DIR :2']);
  expect('LS-DOS: saved as .dsk (JV3) and .dmk, read back in the other drives',
    /Drive :1  TWEE[\s\S]*BACKUP\/CMD[\s\S]*Drive :2  DATA[\s\S]*NOTICE\/TXT/.test(r.screen), r.screen);
  const d3 = await loadDisk(toIMD(d1), 'data.imd');
  r = lsdos([d3], ['LIST NOTICE/TXT:1']);
  expect('LS-DOS: saved as .imd, LIST reads the file back', /Roy Soltoff/.test(r.screen), r.screen);
  d3.wp = true;
  r = lsdos([d3], ['COPY BACKUP/CMD:0 :1']);
  expect('LS-DOS: a write protected floppy says so', /protected/i.test(r.screen), r.screen);
}

process.exit(fails ? 1 : 0);
