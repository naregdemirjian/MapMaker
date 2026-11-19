# Earth through geological time (D134), step 1 of 2: the PALEOMAP PaleoDEMs (C. R. Scotese and N. Wright,
# 2018; CC BY 4.0; https://zenodo.org/records/5460860, the 1 x 1 degree NetCDF files) read and turned into
# the grids Map Maker uses: 360 x 180 cells of one degree (each the mean of the four grid points at its
# corners), heights in whole metres, from the north-west corner. Writes the cells of every map, youngest
# first, as little-endian int16, and their ages and names as JSON, for scripts/pack-paleodem.ts.
#
#   python3 scripts/paleodem-extract.py <folder of the .nc files> <out.i16>   (needs h5py and numpy)
import sys, os, re, json
import h5py
import numpy as np

src, out = sys.argv[1], sys.argv[2]
maps = []
for name in os.listdir(src):
    m = re.match(r'Map([\d.]+)_PALEOMAP_1deg_(.+)_([\d.]+)Ma\.nc$', name)
    if m: maps.append((float(m.group(3)), m.group(2).replace('_', ' ').strip(), name))
maps.sort()
assert len(maps) == 109 and len({a for a, _, _ in maps}) == 109, f'{len(maps)} maps'
cells = []
for age, label, name in maps:
    z = h5py.File(os.path.join(src, name), 'r')['z'][()].astype(np.float64)
    assert z.shape == (181, 361), z.shape
    z = np.nan_to_num(z, nan=-4000.0)
    z = z[::-1, :]  # from the north (the files run from -90 up to 90)
    # One-degree cells between the grid points: the mean of each cell's four corners.
    c = (z[:-1, :-1] + z[:-1, 1:] + z[1:, :-1] + z[1:, 1:]) / 4
    cells.append(np.clip(np.round(c), -32000, 32000).astype('<i2'))
a = np.stack(cells)
assert a.shape == (109, 180, 360)
open(out, 'wb').write(a.tobytes())
json.dump({'ages': [x for x, _, _ in maps], 'labels': [l for _, l, _ in maps]}, open(out + '.json', 'w'), indent=0)
print(a.shape, a.min(), a.max(), 'land at 0 Ma', round(float((a[0] > 0).mean()), 3))
