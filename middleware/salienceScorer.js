const PRIORITY_SCORE = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function scoreSalience(packet) {
  if (!packet) {
    return 0;
  }

  const priority = String(packet.priority || "low").toLowerCase();
  return PRIORITY_SCORE[priority] || 0;
}

function pickHighest(packets = []) {
  return packets
    .slice()
    .sort((left, right) => scoreSalience(right) - scoreSalience(left))[0] || null;
}

module.exports = {
  scoreSalience,
  pickHighest
};
