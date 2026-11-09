# TRS-80 Model 4 web emulator

A TRS-80 Model 4 (4P) in a web page: the Z80, 128K of banked memory, the
screen, the keyboard, the real time clock, the hard disk and two 5.25"
floppy drives. It boots from the hard disk, as a Model 4P or a Model 4
with a FreHD does, or from floppy, and comes with LS-DOS 6.3.1 and Fuzix
to try. The page is in Dutch.

| File          | Contents                                                     |
|---------------|--------------------------------------------------------------|
| `index.html`  | the page: screen, keyboard, disk and floppy choice, buttons for both systems |
| `m4.js`       | the Model 4: memory, video, keyboard, clock, hard disk, boot |
| `floppy.js`   | the floppy drives: FD1793, disk images                       |
| `z80.js`      | z80-emulator 2.3.0 and z80-base 2.0.1 by Lawrence Kesteloot (MIT), bundled with esbuild |
| `disks.json`  | the disks the page offers                                    |
| `disks/`      | the disk images (with their own licences, see `disks/README.md`) |
| `mkdisk.sh`   | puts a hard disk image in `disks/`                           |
| `test/`       | `test.mjs` boots the disks under Node and uses the floppies   |

## Use

Serve the directory with any web server and open `index.html`:

```
python3 -m http.server 8000
```

then http://localhost:8000/. It has to come over http(s), not from a
file. Nothing needs building.

On a web site, copy `index.html`, `m4.js`, `floppy.js`, `z80.js`,
`disks.json` and `disks/` into one folder. To put it in another page
(RapidWeaver, for example), use an iframe:

```html
<iframe src="/m4/index.html?embed=1" title="TRS-80 Model 4"
        style="width:100%; height:1000px; border:0"></iframe>
```

Address options: `?disk=` the hard disk (file or name, `none` for none),
`?fd1=` and `?fd2=` the floppies, `?boot=fd` to start from floppy 1,
`?embed=1` without the title and the explanation.

## disks.json

```json
[
  { "name": "LS-DOS 6.3.1", "file": "disks/lsdos631n-m4-hd.hdv.gz", "os": "lsdos" },
  { "name": "Fuzix-opstartfloppy", "file": "disks/boot.dsk.gz", "type": "floppy", "os": "fuzix" }
]
```

Hard disks are `.hdv` files (the FreHD/xtrs/trs80gp format, 256 byte
sectors, without the Model II flag in byte 8), plain, gzipped (`.gz`) or
gzipped and base64 encoded (`.b64.txt`). Floppies (`"type": "floppy"`,
or a floppy file name) are `.dsk` (JV3 or JV1), `.jv3`, `.dmk` or `.imd`,
plain or gzipped. `"os"` (`fuzix` or `lsdos`) picks the buttons and the
explanation shown; without it the page guesses from the name. Visitors
can also load their own images; they stay in the browser.

## The machine

- Z80 at 4 MHz, 128K RAM; port 84H picks the memory map (all RAM, or the
  keyboard at F400H and the video at F800H, or the Model III layout with
  both at 3800H-3FFFH) and which 32K halves of the second 64K are seen
- video 80x24 or 64x16, with reverse video or the 2x3 block graphics
- the keyboard matrix, with CLEAR, BREAK, F1-F3, CTRL and CAPS
- the 30 Hz real time clock interrupt (IM 1, ports E0H and ECH)
- WD1010 hard disk at C8H-CFH: drive 0, 8 heads, 32 sectors of 256 bytes
- two 5.25" floppy drives on the FD1793 (F0H-F3H, select F4H) with the
  NMI at the end of a command (E4H)
- the clock chip at B0H-BCH that Fuzix reads (the time of the PC)
- the boot: there is no ROM. Like the Model 4P ROM and the FreHD auto
  boot ROM, the page loads hard disk cylinder 0 head 0 sector 1 into
  4300H and jumps there; from floppy, the first sector of track 0.

### Keyboard

Type on the PC keyboard after clicking the screen. Esc is BREAK, Home is
CLEAR, F1-F3 are F1-F3, Ctrl is CTRL; the arrow keys are the arrows.
Typed characters are fed to the keyboard matrix one at a time (with
SHIFT where the TRS-80 needs it), so the layout of the PC keyboard does
not matter. The buttons under the screen hold BREAK, CLEAR, F1-F3 and
CAPS.

### Floppies

The controller is emulated at the level of sectors: a disk is a list of
tracks with their sectors' IDs, density, data mark (normal FBH or deleted
F8H, which LS-DOS uses for its directory) and data. Restore, seek, step
(with verify), read and write sector (also multiple), read address,
write track (formatting: the ID and data marks in the written bytes
become sectors) and force interrupt are there, with write protection,
two sided disks, single and double density and the index pulse. The CPU
moves the data itself; the Model 4's wait states are not needed because
the controller always has the next byte ready, and the NMI ends the
transfer as on the real machine. A select byte without a drive bit keeps
the last drive selected, as in xtrs.

Not emulated: read track (no raw track data is kept), timing (commands
finish at once), CRC errors.

Images: JV3 (`.dsk`, `.jv3`), JV1 (`.dsk`, single density 10 sectors),
DMK (`.dmk`, `.dsk`) and ImageDisk (`.imd`). Floppies are saved as JV3
`.dsk`, `.dmk` or `.imd`. A blank floppy can be formatted from LS-DOS
(`FORMAT :1`).

In LS-DOS booted from the hard disk floppy 1 and 2 are `:1` and `:2`.
Fuzix boots from its floppies, but its floppy driver cannot use a floppy
file system on the Model 4 (see Fuzix below).

### Fuzix

The Fuzix images (`hard4p-0.hdv`, `boot.jv3`, `hdboot.jv3`) are those of
`make TARGET=trs80 diskimage` and run unchanged. At `bootdev:` answer
`hda2`. Its floppy driver (`Kernel/platform/platform-trs80/devfd.c`)
leaves the `config` field out of the `fdcmodes[]` initializers, so each
value moves up one field: it then asks for 40 sectors per track, which no
5.25" floppy has. Booting from floppy works, because the boot sector
loads the kernel itself.

## Tests

```
node test/test.mjs
```

Boots Fuzix from the hard disk and from both its boot floppies; boots
LS-DOS from the hard disk, formats a blank floppy, copies files to both
drives, saves the floppies as `.dsk` (JV3), `.dmk` and `.imd`, reads them
back in the other drives, and checks write protection.

## Licence

The emulator (everything but `disks/` and the bundled library in
`z80.js`) is under the MIT licence, see `LICENSE`. `z80.js` holds
z80-emulator and z80-base by Lawrence Kesteloot, MIT licence, see its
header (https://github.com/lkesteloot/trs80). The disk images have their
own licences: Fuzix is GPL version 2, LS-DOS comes with a permission
notice that has to stay with it; see `disks/README.md`.
