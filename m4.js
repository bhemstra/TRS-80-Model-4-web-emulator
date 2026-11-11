// TRS-80 Model 4 / 4P hardware: 128K RAM in two 64K halves with the bank
// and memory map bits of port 84H, video RAM (80x24 or 64x16), the
// keyboard matrix, the real time clock interrupt (IM 1), the FD1793 floppy
// controller with its NMI (floppy.js), the WD1010 hard disk (256 byte
// sectors, 8 heads, 32 sectors per track) with the clock of a FreHD, and
// optionally the clock chip on ports B0H-BCH. There is no ROM: bootHd()
// and bootFloppy() do what the Model 4P boot ROM (and the FreHD auto
// boot) do.

import { FDC } from './floppy.js';

export const CPU_HZ = 4000000;

// The keyboard matrix: row and bit of each key
export const KEYS = {};
'@ABCDEFG'.split('').forEach((c, i) => KEYS[c] = [0, i]);
'HIJKLMNO'.split('').forEach((c, i) => KEYS[c] = [1, i]);
'PQRSTUVW'.split('').forEach((c, i) => KEYS[c] = [2, i]);
'XYZ'.split('').forEach((c, i) => KEYS[c] = [3, i]);
'01234567'.split('').forEach((c, i) => KEYS[c] = [4, i]);
'89:;,-./'.split('').forEach((c, i) => KEYS[c] = [5, i]);
Object.assign(KEYS, {
  ENTER: [6, 0], CLEAR: [6, 1], BREAK: [6, 2], UP: [6, 3], DOWN: [6, 4],
  LEFT: [6, 5], RIGHT: [6, 6], ' ': [6, 7],
  SHIFT: [7, 0], RSHIFT: [7, 1], CTRL: [7, 2], CAPS: [7, 3], F1: [7, 4], F2: [7, 5], F3: [7, 6],
});
// Characters that need SHIFT on the TRS-80 keyboard
export const SHIFTED = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7',
  '(': '8', ')': '9', '*': ':', '+': ';', '<': ',', '=': '-', '>': '.', '?': '/' };

// The keys (names of KEYS) that give a character
export function keysFor(ch) {
  if (ch === '\r' || ch === '\n') return ['ENTER'];
  if (ch === '\b') return ['LEFT'];
  if (ch === '\x1B') return ['BREAK'];
  const c = ch.charCodeAt(0);
  if (c >= 1 && c <= 26) return ['CTRL', String.fromCharCode(c + 64)];	// Ctrl-A to Ctrl-Z
  if (SHIFTED[ch]) return ['SHIFT', SHIFTED[ch]];
  const u = ch.toUpperCase();
  if (KEYS[u] && u !== ch.toLowerCase()) return ch === u ? ['SHIFT', u] : [u];	// letters
  if (KEYS[ch]) return [ch];
  return null;
}

export class Model4 {
  constructor(Z80, hdimg) {
    this.ram = new Uint8Array(0x20000);		// two 64K halves
    this.video = new Uint8Array(0x800).fill(32);
    this.opreg = 0; this.modout = 0;
    this.lo = 0; this.hi = 0x8000;		// where 0000-7FFF, 8000-FFFF are in ram
    this.rows = new Uint8Array(8);		// keys held from the page
    this.typed = new Uint8Array(8);		// keys of typed text
    this.typing = []; this.phase = 0;
    this.mask = 0; this.latch = 0;		// interrupts; the clock is bit 2
    this.crtc = new Uint8Array(16); this.crtcReg = 0;
    this.img = hdimg;				// may be null: no hard disk
    this.hd = { sdh: 0, cyl: 0, sec: 0, status: 0x50, buf: null, ptr: 0, wr: false, off: 0 };
    this.frehd = { buf: [], ptr: 0, set: false };	// the FreHD clock commands
    this.clockOffset = 0;			// ms the clock runs ahead of the PC (set by SET_TIME)
    this.clockChip = false;			// the clock chip at B0H-BCH (not in a stock Model 4)
    this.fdc = new FDC(this);
    this.nmiPending = false;
    this.dirty = false;
    const self = this;
    this.hal = {
      tStateCount: 0,
      readMemory: a => self.rd(a), writeMemory: (a, v) => self.wr(a, v),
      contendMemory() {}, contendPort() {},
      readPort: a => self.inp(a & 0xFF), writePort: (a, v) => self.outp(a & 0xFF, v),
    };
    this.z = new Z80(this.hal);
    this.z.reset();
    this.tick = CPU_HZ / 30;
    this.nextTick = this.tick;
  }

  // Port 84H bits 4-6 choose which 32K halves of the 128K are seen (as
  // xtrs has it), bits 0-1 the memory map
  setOpreg(v) {
    this.opreg = v;
    switch ((v >> 4) & 7) {
      case 2: this.lo = 0; this.hi = 0x10000; break;		// upper: second 64K, low half
      case 3: this.lo = 0; this.hi = 0x18000; break;		// upper: second 64K, high half
      case 6: this.lo = 0x10000; this.hi = 0x8000; break;	// lower: second 64K, low half
      case 7: this.lo = 0x18000; this.hi = 0x8000; break;	// lower: second 64K, high half
      default: this.lo = 0; this.hi = 0x8000;
    }
  }
  map() { return this.opreg & 3; }
  kbd(a) {
    let v = 0;
    for (let r = 0; r < 8; r++) if (a & (1 << r)) v |= this.rows[r] | this.typed[r];
    return v;
  }
  rd(a) {
    const m = this.map();
    if (m === 2 && a >= 0xF400) return a >= 0xF800 ? this.video[a - 0xF800] : this.kbd(a);
    if (m < 2 && a >= 0x3800 && a < 0x4000) {
      if (a >= 0x3C00) return this.video[((this.opreg & 0x80) ? 0x400 : 0) + a - 0x3C00];
      return this.kbd(a);
    }
    if (m === 0 && a < 0x3800) return 0xFF;			// no ROM
    return this.ram[a < 0x8000 ? this.lo + a : this.hi + a - 0x8000];
  }
  wr(a, v) {
    const m = this.map();
    if (m === 2 && a >= 0xF400) { if (a >= 0xF800) this.video[a - 0xF800] = v; return; }
    if (m < 2 && a >= 0x3800 && a < 0x4000) {
      if (a >= 0x3C00) this.video[((this.opreg & 0x80) ? 0x400 : 0) + a - 0x3C00] = v;
      return;
    }
    if (m === 0 && a < 0x3800) return;
    this.ram[a < 0x8000 ? this.lo + a : this.hi + a - 0x8000] = v;
  }

  // ---- WD1010, 256 byte sectors
  hdCmd(v) {
    const h = this.hd, c = v & 0xF0;
    if (c === 0x10 || c === 0x70) { h.status = (h.sdh & 0x18) ? 0x51 : 0x50; return; }
    if (!this.img) { h.status = 0x51; return; }
    const off = 256 + ((h.cyl * 8 + (h.sdh & 7)) * 32 + h.sec) * 256;
    if ((h.sdh & 0x60) || (h.sdh & 0x18) || h.sec >= 32 || off + 256 > this.img.length) { h.status = 0x51; return; }
    h.ptr = 0; h.status = 0x58;
    if (c === 0x20) { h.buf = this.img.subarray(off, off + 256); h.wr = false; }
    else if (c === 0x30) { h.buf = new Uint8Array(256); h.wr = true; h.off = off; }
  }

  now() { return new Date(Date.now() + this.clockOffset); }

  // The FreHD clock: command 1 (GET_TIME) to port C4H gives, and command 2
  // (SET_TIME) takes, 6 bytes through C2H: seconds, minutes, hours, year
  // from 2000, day, month 1-12, binary. Other FreHD commands are not there.
  frehdCmd(v) {
    const f = this.frehd, d = this.now();
    f.ptr = 0; f.set = v === 2; f.buf = [];
    if (v === 1) f.buf = [d.getSeconds(), d.getMinutes(), d.getHours(), d.getFullYear() - 2000, d.getDate(), d.getMonth() + 1];
  }
  frehdData(v) {
    const f = this.frehd;
    if (!f.set) return;
    f.buf.push(v);
    if (f.buf.length === 6) {
      const [s, mi, h, y, day, mo] = f.buf;
      this.clockOffset = new Date(2000 + y, mo - 1, day, h, mi, s).getTime() - Date.now();
      f.set = false;
    }
  }

  // The clock chip Fuzix looks for at B0H-BCH: BCD digits of the time now
  rtc(p) {
    if (!this.clockChip) return 0xFF;
    const d = this.now(), two = (x, hi) => hi ? Math.floor(x / 10) : x % 10;
    switch (p) {
      case 0xB0: return two(d.getSeconds(), 0); case 0xB1: return two(d.getSeconds(), 1);
      case 0xB2: return two(d.getMinutes(), 0); case 0xB3: return two(d.getMinutes(), 1);
      case 0xB4: return two(d.getHours(), 0); case 0xB5: return two(d.getHours(), 1);
      case 0xB6: return d.getDay();
      case 0xB7: return two(d.getDate(), 0); case 0xB8: return two(d.getDate(), 1);
      case 0xB9: return two(d.getMonth() + 1, 0); case 0xBA: return two(d.getMonth() + 1, 1);
      case 0xBB: return two(d.getFullYear() % 100, 0); case 0xBC: return two(d.getFullYear() % 100, 1);
    }
    return 0xFF;
  }

  inp(p) {
    const h = this.hd;
    if (p >= 0xB0 && p <= 0xBC) return this.rtc(p);
    if (p >= 0xF0 && p <= 0xF3) return this.fdc.in(p);
    switch (p & 0xFC) {
      case 0xE0: return ~this.latch & 0xFF;		// interrupts, active low
      case 0xE4: return this.fdc.in(0xE4);
      case 0xEC: this.latch &= ~4; return 0xFF;	// clears the clock interrupt
      case 0xE8: return p === 0xEA ? 0x40 : 0xFF;	// RS-232: nothing received
    }
    switch (p) {
      case 0xC8:
        if (h.buf && !h.wr && h.ptr < 256) {
          const v = h.buf[h.ptr++];
          if (h.ptr === 256) h.status = 0x50;
          return v;
        }
        return 0;
      case 0xC9: return 0;
      case 0xC2: return this.frehd.ptr < this.frehd.buf.length ? this.frehd.buf[this.frehd.ptr++] : 0xFF;
      case 0xCF: return h.status;
    }
    return 0xFF;
  }

  outp(p, v) {
    const h = this.hd;
    if (p >= 0xF0 && p <= 0xF7) { this.fdc.out(p < 0xF4 ? p : 0xF4, v); return; }
    switch (p & 0xFC) {
      case 0x84: this.setOpreg(v); return;
      case 0x88: if (p & 1) this.crtc[this.crtcReg] = v; else this.crtcReg = v & 15; return;
      case 0xE0: this.mask = v; return;
      case 0xE4: this.fdc.out(0xE4, v); return;
      case 0xEC: this.modout = v; return;
    }
    switch (p) {
      case 0xC8:
        if (h.wr) {
          h.buf[h.ptr++] = v;
          if (h.ptr === 256) { this.img.set(h.buf, h.off); h.wr = false; h.status = 0x50; this.dirty = true; }
        }
        return;
      case 0xC2: this.frehdData(v); return;
      case 0xC4: this.frehdCmd(v); return;
      case 0xCB: h.sec = v; return;
      case 0xCC: h.cyl = (h.cyl & 0xFF00) | v; return;
      case 0xCD: h.cyl = (h.cyl & 0xFF) | (v << 8); return;
      case 0xCE: h.sdh = v; return;
      case 0xCF: this.hdCmd(v); return;
    }
  }

  // The 4P boot ROM / FreHD auto boot: hard disk cylinder 0, head 0,
  // sector 1 to 4300H, and there. Most boot sectors start with 00 FE.
  bootHd() {
    if (!this.img || this.img.length < 768) return false;
    const s = this.img.subarray(256 + 256, 256 + 512);
    if (s.every(x => x === 0)) return false;
    this.setOpreg(0);
    this.ram.set(s, 0x4300);
    this.z.regs.pc = 0x4300;
    this.z.regs.sp = 0x4200;
    return true;
  }

  // The floppy boot ROM: track 0 side 0, the first sector, of drive 0 to
  // 4300H, and there
  bootFloppy() {
    const d = this.fdc.drives[0];
    if (!d) return false;
    const t = d.track(0, 0).filter(s => s.data.length === 256).sort((a, b) => a.r - b.r);
    if (!t.length) return false;
    this.setOpreg(0);
    this.ram.set(t[0].data, 0x4300);
    this.fdc.sel = 0x81 | (t[0].mfm ? 0x80 : 0);
    this.fdc.pos[0] = 0;
    this.z.regs.pc = 0x4300;
    this.z.regs.sp = 0x4200;
    return true;
  }

  fdcNmi() { this.nmiPending = true; }
  nmi() {
    const r = this.z.regs;
    this.nmiPending = false;
    if (r.halted) { r.pc = (r.pc + 1) & 0xFFFF; r.halted = 0; }
    this.z.pushWord(r.pc);
    r.pc = 0x66;
    r.iff2 = r.iff1;
    r.iff1 = 0;
  }

  // Typed text: each key down for two clock ticks and up for two
  key(ch) { this.typing.push(ch); }
  keyTick() {
    this.typed.fill(0);
    if (!this.typing.length) return;
    if (this.phase < 2) {
      const k = keysFor(this.typing[0]);
      if (k) for (const n of k) this.typed[KEYS[n][0]] |= 1 << KEYS[n][1];
    }
    if (++this.phase === 4) { this.phase = 0; this.typing.shift(); }
  }
  // Keys held down from the page
  press(name, down) {
    const k = KEYS[name];
    if (!k) return;
    if (down) this.rows[k[0]] |= 1 << k[1]; else this.rows[k[0]] &= ~(1 << k[1]);
  }

  run(n) {
    const end = this.hal.tStateCount + n, z = this.z;
    while (this.hal.tStateCount < end) {
      z.step();
      if (this.nmiPending) this.nmi();
      if (this.hal.tStateCount >= this.nextTick) {
        this.nextTick += this.tick;
        this.latch |= 4;
        this.keyTick();
      }
      if ((this.latch & this.mask & 4) && z.regs.iff1) z.maskableInterrupt();
    }
  }

  wide() { return !!(this.opreg & 4); }		// 80x24, else 64x16

  text() {
    const w = this.wide() ? 80 : 64, hgt = this.wide() ? 24 : 16, base = this.wide() ? 0 : ((this.opreg & 0x80) ? 0x400 : 0);
    const rows = [];
    for (let y = 0; y < hgt; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const c = this.video[base + y * w + x] & 0x7F;
        s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
      }
      rows.push(s.replace(/ +$/, ''));
    }
    return rows.join('\n');
  }
}
