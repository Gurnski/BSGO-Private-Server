/*
 * Regression-check the extractor against the four hulls whose hardpoints are already in cards.js
 * and confirmed working in-game. If these do not reproduce, nothing else the extractor says is
 * trustworthy either.
 */
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(__dirname + '/spots.json', 'utf8'));

const KNOWN = {
  HumanT1Fighter: {
    bullet01:      [-1.029611, -0.203091,  2.184256, 0, 0, -1, 0],
    bullet02:      [ 0.000000, -0.431652,  3.357222, 0, 0, -1, 0],
    bullet03:      [ 1.029971, -0.203091,  2.184257, 0, 0, -1, 0],
    elitebullet04: [ 0.000000, -0.713463,  0.305092, 0, 0, -1, 0],
    sticker1:      [ 0, 0, 0, 0, 1, 0, 0],
  },
  HumanT1Command: {
    bullet01:      [-1.511584, -1.343623,  1.924034, 0, 0, 1, 0],
    bullet02:      [-0.411881, -1.473099,  1.695256, 0, 0, 1, 0],
    bullet03:      [ 1.529279, -1.343623,  1.917449, 0, 0, 1, 0],
    elitebullet04: [ 0.401728, -1.473099,  1.695786, 0, 0, 1, 0],
  },
  CylonT1Fighter: {
    bullet01:      [-1.161417, -0.310141,  2.245296, 0, 0, 0, 1],
    bullet02:      [ 0.000000, -0.284514, -0.577745, 0, 0, 0, 1],
    bullet03:      [ 1.161211, -0.310141,  2.245296, 0, 0, 0, 1],
    elitebullet04: [ 0.000000, -0.197869,  0.486459, 0, 0, 0, 1],
  },
  HumanT1Defender: {
    bullet01:      [-4.997623,  0.519668,  1.994869, 0, 0, 1, 0],
    bullet02:      [-2.003812,  1.296431,  1.715895, 0, 0, 0, 1],
    bullet03:      [ 5.029077,  0.549518,  2.026034, 0, 0, 1, 0],
    elitebullet04: [ 1.987213,  1.309609,  1.699099, 0, 0, 1, 0],
    elitebullet05: [ 0.000000,  1.100879, -4.389983, 1, 0, 0, 0],
  },
};

const TOL = 2e-4;
let pass = 0, fail = 0, missing = 0;
for (const [prefab, pts] of Object.entries(KNOWN)) {
  const got = j[prefab];
  if (!got) { console.log('MISSING PREFAB ' + prefab); missing++; continue; }
  for (const [name, exp] of Object.entries(pts)) {
    const s = got.find(x => x.name === name);
    if (!s) { console.log('MISSING  ' + prefab + '.' + name); missing++; continue; }
    // q and -q are the same rotation, so compare the quaternion up to sign.
    const dp = s.pos.map((v, i) => Math.abs(v - exp[i]));
    const sign = (s.rot[0] * exp[3] + s.rot[1] * exp[4] + s.rot[2] * exp[5] + s.rot[3] * exp[6]) < 0 ? -1 : 1;
    const dr = s.rot.map((v, i) => Math.abs(v * sign - exp[3 + i]));
    const ok = Math.max(...dp, ...dr) < TOL;
    if (ok) pass++;
    else {
      fail++;
      console.log('MISMATCH ' + prefab + '.' + name +
        '\n   expected pos(' + exp.slice(0, 3).join(', ') + ') rot(' + exp.slice(3).join(',') + ')' +
        '\n   got      pos(' + s.pos.join(', ') + ') rot(' + s.rot.join(',') + ')');
    }
  }
}
console.log('\n' + pass + ' match, ' + fail + ' mismatch, ' + missing + ' missing');
process.exit(fail + missing ? 1 : 0);
