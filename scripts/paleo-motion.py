# Earth through geological time (D135): how the crust moves between two neighbouring PALEOMAP maps, from the
# PALEOMAP plate model (C. R. Scotese, rotation file and plate polygons v19o_r1c, in A. T. Kocsis and
# C. R. Scotese's PaleoMAP PaleoCoastlines data, CC BY 4.0, https://doi.org/10.5281/zenodo.7994000).
#
# Points every half degree on today's Earth are given the plate they lie on (its polygon, and the age from
# which it exists), and carried back through time by the plate's rotations. For each map and the next older
# one, every one-degree cell of the map is given the mean motion (degrees of longitude and latitude) of the
# points that lie in it at the map's age and exist at both ages; cells with none take their neighbours'.
# Written for scripts/pack-paleodem.ts: little-endian int8 tenths of a degree of arc, east then north, cell by cell
# from the north-west corner, for each pair of maps youngest first (clamped to +-12.7 degrees).
#
#   python3 scripts/paleo-motion.py <rotation file> <plate polygons> <ages json> <out.i8>   (needs pygplates, numpy)
import sys, json
import numpy as np
import pygplates

rot_path, poly_path, ages_path, out = sys.argv[1:5]
ages = json.load(open(ages_path))['ages']
model = pygplates.RotationModel(rot_path)
polygons = pygplates.FeatureCollection(poly_path)
partitioner = pygplates.PlatePartitioner(polygons, model)

# Points every half degree, at the middles of half-degree cells.
lats = np.arange(89.75, -90, -0.5)
lons = np.arange(-179.75, 180, 0.5)
LON, LAT = np.meshgrid(lons, lats)
LON, LAT = LON.ravel(), LAT.ravel()
plate = np.zeros(LON.size, dtype=np.int64)
since = np.full(LON.size, np.inf)
for k in range(LON.size):
    g = partitioner.partition_point(pygplates.PointOnSphere(float(LAT[k]), float(LON[k])))
    if g is None:
        plate[k] = -1
        continue
    f = g.get_feature()
    plate[k] = f.get_reconstruction_plate_id()
    begin, _ = f.get_valid_time()
    since[k] = float(begin) if begin != pygplates.GeoTimeInstant.create_distant_past() else np.inf

xyz0 = np.stack([np.cos(np.radians(LAT)) * np.cos(np.radians(LON)), np.cos(np.radians(LAT)) * np.sin(np.radians(LON)), np.sin(np.radians(LAT))], axis=1)

def at_age(age):
    """Every point's place at an age (unit vectors), and whether its plate's crust exists then."""
    xyz = np.empty_like(xyz0)
    for pid in np.unique(plate):
        sel = plate == pid
        if pid < 0:
            xyz[sel] = xyz0[sel]
            continue
        xyz[sel] = xyz0[sel] @ rotation_matrix(model.get_rotation(float(age), int(pid))).T
    return xyz, (since >= age) & (plate >= 0)

def rotation_matrix(q):
    lat, lon, angle = q.get_lat_lon_euler_pole_and_angle_degrees()
    ax = np.array([np.cos(np.radians(lat)) * np.cos(np.radians(lon)), np.cos(np.radians(lat)) * np.sin(np.radians(lon)), np.sin(np.radians(lat))])
    a = np.radians(angle)
    K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * (K @ K)

W, H = 360, 180
fields = []
prev = at_age(ages[0])
for i in range(len(ages) - 1):
    nxt = at_age(ages[i + 1])
    pA, okA = prev
    pB, okB = nxt
    ok = okA & okB
    lonA = np.degrees(np.arctan2(pA[:, 1], pA[:, 0])); latA = np.degrees(np.arcsin(np.clip(pA[:, 2], -1, 1)))
    # The move east and north, in degrees of arc, in the frame of the place at the younger age.
    east = np.stack([-np.sin(np.radians(lonA)), np.cos(np.radians(lonA)), np.zeros_like(lonA)], axis=1)
    north = np.stack([-np.sin(np.radians(latA)) * np.cos(np.radians(lonA)), -np.sin(np.radians(latA)) * np.sin(np.radians(lonA)), np.cos(np.radians(latA))], axis=1)
    d3 = pB - pA
    dlon = np.degrees((d3 * east).sum(axis=1))
    dlat = np.degrees((d3 * north).sum(axis=1))
    col = np.clip(np.floor(lonA + 180).astype(int), 0, W - 1)
    row = np.clip(np.floor(90 - latA).astype(int), 0, H - 1)
    cell = row * W + col
    s = np.zeros((2, W * H)); n = np.zeros(W * H)
    np.add.at(s[0], cell[ok], dlon[ok]); np.add.at(s[1], cell[ok], dlat[ok]); np.add.at(n, cell[ok], 1)
    have = n > 0
    d = np.zeros((2, W * H)); d[:, have] = s[:, have] / n[have]
    # Cells with no points take their neighbours' mean (a few rounds), the rest stay still.
    for _ in range(6):
        if have.all(): break
        g = d.reshape(2, H, W); hv = have.reshape(H, W).astype(float)
        acc = np.zeros_like(g); cnt = np.zeros_like(hv)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            acc += np.roll(np.roll(g * hv, dy, axis=1), dx, axis=2); cnt += np.roll(np.roll(hv, dy, axis=0), dx, axis=1)
        fill = (~have.reshape(H, W)) & (cnt > 0)
        g[:, fill] = acc[:, fill] / cnt[fill]
        d = g.reshape(2, W * H); have = have | fill.ravel()
    fields.append(np.clip(np.round(d * 10), -127, 127).astype(np.int8))
    print(f'{ages[i]} -> {ages[i + 1]} Ma: {ok.mean():.2f} of points carried, largest move {np.abs(d).max():.1f} degrees', flush=True)
    prev = nxt
np.stack(fields).tofile(out)
