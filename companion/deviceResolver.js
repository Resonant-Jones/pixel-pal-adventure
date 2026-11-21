// companion/deviceResolver.js
//
// Which audio device the voice link actually uses.
//
// THE PROBLEM THIS SOLVES
//
// Audio device lists are not stable. They reorder whenever something connects
// or disconnects — an iPhone waking up nearby, AirPods pairing, a USB
// microphone being unplugged, a virtual node appearing. A device pinned by
// *index* therefore silently becomes a different device without anything
// failing. It was listening to a virtual node's microphone for hours while
// the configuration said "index 0" and the operator believed it was on the
// laptop's own microphone.
//
// So a device is identified by NAME. A name does not move.
//
// THE IPHONE QUESTION
//
// macOS will switch an input device to an iPhone that is nearby, and the
// iPhone's microphone then becomes a legitimate input for anything asking
// for one. That is the right behaviour for the operating system and the
// wrong behaviour for this system, for two reasons:
//
//   * the phone belongs to the son, and the voice link is not going to take
//     his microphone without being asked
//   * a Continuity input can carry the machine's own audio back in, which is
//     a loop rather than a microphone
//
// So an iPhone or iPad is refused outright, by name, and the refusal is
// logged rather than being silent.

// Devices that must never be used as a capture device.
const DEFAULT_BLOCKED_INPUTS = ["iphone", "ipad"];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function isBlockedInput(name, blockedInputs = DEFAULT_BLOCKED_INPUTS) {
  const value = normalize(name);
  if (!value) return false;

  return blockedInputs.some((blocked) => {
    const needle = normalize(blocked);
    return needle.length > 0 && value.includes(needle);
  });
}

/**
 * Resolve the configured capture device to a concrete one.
 *
 * @param {{index: number|null, name: string|null}|null} device
 * @param {Array<{index: number, name: string}>} devices
 * @param {{blockedInputs?: string[]}} [options]
 * @returns {{ok: boolean, reason: string|null, device: object|null, wanted: string|null}}
 */
function resolveInputDevice(device, devices = [], options = {}) {
  const blockedInputs = options.blockedInputs || DEFAULT_BLOCKED_INPUTS;

  if (!device) {
    return { ok: false, reason: "not_configured", device: null, wanted: null };
  }

  const candidates = Array.isArray(devices) ? devices : [];

  const match = device.name
    ? candidates.find((candidate) => normalize(candidate.name) === normalize(device.name))
    : candidates.find((candidate) => candidate.index === device.index);

  if (!match) {
    return {
      ok: false,
      reason: "not_present",
      device: null,
      wanted: device.name || `device ${device.index}`
    };
  }

  if (isBlockedInput(match.name, blockedInputs)) {
    return {
      ok: false,
      reason: "blocked",
      device: { index: match.index, name: match.name },
      wanted: match.name
    };
  }

  return {
    ok: true,
    reason: null,
    device: { index: match.index, name: match.name },
    wanted: device.name || `device ${device.index}`
  };
}

/**
 * Resolve the configured playback device.
 *
 * The playback side cannot enumerate its own list — audiotoolbox is
 * output-only — so a named output device is passed straight through to ffmpeg
 * by name, which is unambiguous and reorder-proof.
 */
function resolveOutputDevice(device) {
  if (!device) {
    return { ok: false, reason: "not_configured", device: null, wanted: null };
  }

  if (device.name) {
    return { ok: true, reason: null, device: { index: null, name: device.name }, wanted: device.name };
  }

  return {
    ok: true,
    reason: null,
    device: { index: device.index, name: null },
    wanted: `device ${device.index}`
  };
}

module.exports = {
  resolveInputDevice,
  resolveOutputDevice,
  isBlockedInput,
  DEFAULT_BLOCKED_INPUTS
};
