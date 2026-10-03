export function roadIdFor(fromZone, toZone) {
  const pair = [String(fromZone), String(toZone)].sort();
  return Buffer.from(JSON.stringify(pair)).toString('base64url');
}

export function zonesFromRoadId(roadId) {
  let pair;
  try { pair = JSON.parse(Buffer.from(roadId, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!Array.isArray(pair) || pair.length !== 2 || pair.some((zone) => typeof zone !== 'string' || !zone) || pair[0] === pair[1]) return null;
  return JSON.stringify(pair) === JSON.stringify([...pair].sort()) ? pair : null;
}
