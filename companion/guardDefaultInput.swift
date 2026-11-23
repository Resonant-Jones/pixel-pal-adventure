// companion/guardDefaultInput.swift
//
// Keep macOS's default input device on one device.
//
// WHY THIS EXISTS
//
// macOS 27.2 on this machine has no switch for "automatically switch to the
// iPhone microphone". System Settings was searched three ways — "iPhone",
// "Camera", "Continuity" — and the only matches were iPhone Mirroring,
// iPhone Widgets, Handoff, AirDrop, AirPlay Receiver, Notifications,
// Hearing Devices and the Privacy pane. There is no Control, and no
// writable `defaults` key either: the state belongs to the Continuity
// capture subsystem, not to a preference anyone can read.
//
// What IS there is the cause. This Mac sees the family iPhone — named
// "ScoutNode", model iPhone17,1 — as a *Continuity Camera*, and a
// Continuity Camera brings its microphone with it:
//
//   [0] MacBook Air Microphone        (Built-in)
//   [1] ScoutNode Microphone          (Continuity Camera)
//
// So the iPhone's microphone is a real, selectable input on this machine,
// and macOS selects it when the Continuity Camera is in use.
//
// So the outcome is enforced rather than the switch flipped: this program
// watches the system default input and puts it back on the pinned device
// if it moves.
//
// WHAT IT COSTS
//
// If you are in a call using the iPhone as a camera, the input goes back to
// the Mac's own microphone. That is usually what you want — the built-in
// microphone is right there — but it is a behaviour change and it is
// reversible: stop this program and macOS does whatever it liked before.
//
// USAGE
//
//   guard-default-input --ensure "MacBook Air Microphone" [--once] [--interval 5]
//
//   --once      check and fix, then exit (exit 0 = already correct,
//               1 = moved back, 2 = the pinned device does not exist,
//               3 = could not set it)
//   --interval  seconds between checks when watching (default 5)
//   --list      print every device and the current default, then exit
//   --set NAME  make NAME the default input, then exit
//
// `--set` is here because the guard has to be provable. The only way to know
// that it puts the input back is to let something take the input away and
// watch it take it back — and the way to do that on purpose is to move the
// default input yourself.

import Foundation
import CoreAudio
import AudioToolbox

func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
}

func deviceName(_ device: AudioObjectID) -> String {
    var address = propertyAddress(kAudioObjectPropertyName)
    var size = UInt32(MemoryLayout<CFString>.size)

    // The name comes back as a CFStringRef. Reading it into a CFString
    // variable and passing the address of that variable is the supported
    // pattern; passing `&cfString` directly is not, and warns.
    var cfName: CFString = "" as CFString

    let status = withUnsafeMutablePointer(to: &cfName) { pointer in
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, pointer)
    }

    guard status == noErr else {
        return "<unknown>"
    }

    return cfName as String
}

// Does this device have an input at all?
//
// THIS WAS WRONG AT FIRST, AND THE SYMPTOM WAS QUIET.
//
// The obvious test is `AudioObjectHasProperty(device, kAudioObjectPropertyScopeInput)`.
// On this machine that answers NO for every device — including the built-in
// microphone — so the guard filtered out everything it was supposed to hold
// on to and printed "no input device named ..." while the device it was
// looking for was sitting there, selected, as the system default.
//
// The reliable test is the streams: a device is an input device if any of
// its streams has direction 1 (kAudioObjectPropertyStreamDirectionInput).
//
// The stream selectors are not bridged into Swift, so their four-character
// codes are spelled out here:
//
//   kAudioObjectPropertyStreams         'stm#'
//   kAudioObjectPropertyStreamDirection  'sdir'
//
// If those codes were wrong, `--list` would mark every device as having no
// input — which is exactly the failure this function was written to end, so
// the output is self-checking: the built-in microphone and the phone's
// microphone must read "in" and the speakers must read "out".
let selectorStreams = AudioObjectPropertySelector(0x73746d23) // 'stm#'
let selectorStreamDirection = AudioObjectPropertySelector(0x73646972) // 'sdir'
let streamDirectionInput: UInt32 = 1

func hasInputScope(_ device: AudioObjectID) -> Bool {
    var streamsAddress = AudioObjectPropertyAddress(
        mSelector: selectorStreams,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )

    var size: UInt32 = 0

    guard AudioObjectGetPropertyDataSize(device, &streamsAddress, 0, nil, &size) == noErr else {
        return false
    }

    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    guard count > 0 else {
        return false
    }

    var streams = [AudioObjectID](repeating: 0, count: count)

    guard AudioObjectGetPropertyData(device, &streamsAddress, 0, nil, &size, &streams) == noErr else {
        return false
    }

    for stream in streams {
        var directionAddress = AudioObjectPropertyAddress(
            mSelector: selectorStreamDirection,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var direction: UInt32 = 0
        var directionSize = UInt32(MemoryLayout<UInt32>.size)

        guard AudioObjectGetPropertyData(stream, &directionAddress, 0, nil, &directionSize, &direction) == noErr else {
            continue
        }

        if direction == streamDirectionInput {
            return true
        }
    }

    return false
}

func allDevices() -> [AudioObjectID] {
    var address = propertyAddress(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0

    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size
    ) == noErr else {
        return []
    }

    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var devices = [AudioObjectID](repeating: 0, count: count)

    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices
    ) == noErr else {
        return []
    }

    return devices
}

func findInputDevice(named wanted: String) -> AudioObjectID? {
    for device in allDevices() where hasInputScope(device) {
        if deviceName(device) == wanted {
            return device
        }
    }

    return nil
}

func defaultInputDevice() -> AudioObjectID {
    var address = propertyAddress(kAudioHardwarePropertyDefaultInputDevice)
    var device = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)

    _ = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device
    )

    return device
}

func setDefaultInput(_ device: AudioObjectID) -> Bool {
    var address = propertyAddress(kAudioHardwarePropertyDefaultInputDevice)
    var target = device

    return AudioObjectSetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        UInt32(MemoryLayout<AudioObjectID>.size),
        &target
    ) == noErr
}

func tick(wanted: String) -> Int32 {
    guard let target = findInputDevice(named: wanted) else {
        print("guard: no input device named \"\(wanted)\" — nothing to hold on to")
        return 2
    }

    let current = defaultInputDevice()

    if current == target {
        return 0
    }

    let currentName = current == 0 ? "<none>" : deviceName(current)

    if setDefaultInput(target) {
        print("guard: default input was \"\(currentName)\" — moved back to \"\(wanted)\"")
        return 1
    }

    print("guard: could not move the default input back (was \"\(currentName)\")")
    return 3
}

// --- arguments -------------------------------------------------------------

var wanted = "MacBook Air Microphone"
var once = false
var interval = 5.0
var list = false
var setTo: String? = nil

var index = 1
let arguments = CommandLine.arguments

while index < arguments.count {
    switch arguments[index] {
    case "--ensure":
        index += 1
        if index < arguments.count { wanted = arguments[index] }
    case "--once":
        once = true
    case "--list":
        list = true
    case "--set":
        index += 1
        if index < arguments.count { setTo = arguments[index] }
    case "--interval":
        index += 1
        if index < arguments.count, let parsed = Double(arguments[index]) {
            interval = max(1.0, parsed)
        }
    default:
        break
    }

    index += 1
}

if list {
    let current = defaultInputDevice()
    for device in allDevices() {
        let scope = hasInputScope(device) ? "in " : "out"
        let marker = device == current ? "*" : " "
        print("  \(marker) \(device)  \(scope)  \(deviceName(device))")
    }
    print("default input: \(current == 0 ? "<none>" : deviceName(current))")
    exit(0)
}

if let target = setTo {
    guard let device = findInputDevice(named: target) else {
        print("guard: no input device named \"\(target)\"")
        exit(2)
    }

    if setDefaultInput(device) {
        print("guard: default input is now \"\(target)\"")
        exit(0)
    }

    print("guard: could not set the default input to \"\(target)\"")
    exit(3)
}

if once {
    exit(tick(wanted: wanted))
}

print("guard: holding the default input on \"\(wanted)\", checking every \(Int(interval))s")

while true {
    _ = tick(wanted: wanted)
    Thread.sleep(forTimeInterval: interval)
}
