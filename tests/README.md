## Audio recovery regression checks

These tests cover the playback position and event ordering around microphone interruptions, native auto-resume, remote MediaSession commands, failed/stalled playback, asynchronous cancellation, and decoder replacement. Both full and type-only AudioSession APIs are simulated. Every strict scenario runs in a fresh page. The native WAV scenarios use actual HTMLAudioElement playback and byte-range responses in both browser engines.

The first iPhone report showed native `playing` at the saved 11-second position, immediately followed by the app assigning the source and calling `load()`. The resulting player remained at `readyState=1`, and repeated Control Center commands never completed playback. Recovery tries `play()` on the existing element first, accepts native `playing` without reloading, restores the interruption checkpoint after metadata when necessary, and lets a fresh control command supersede a pending attempt. Decoder replacement runs only in the foreground. An automatic probe with unavailable AudioSession state does not rebuild the player merely because its play promise times out during capture; an opaque background denial/timeout also preserves the native MediaSession interruption state.

The next report (app version 63) showed native `playing` while hidden, but the clock stayed at 11.34 seconds. The 1.5-second watchdog paused the unlocked player and tried a new element, which iOS rejected with `NotAllowedError`. The background watchdog now observes for 3 seconds, reissues the existing playback rate and calls `play()` on the original element once, then checks the clock for another 3 seconds. WebKit forwards a same-value rate assignment to the native player ([HTMLMediaElement](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/html/HTMLMediaElement.cpp#L4332), [AVFoundation](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateAVFoundationObjC.mm#L1694)). Measured clock progression confirms this recovery. These automatic background checks never pause, load, replace the element, change its playback speed, or move its position. A fresh explicit Play can synchronously reload a confirmed stalled original element inside its native control callback.

Repeated `playing` events do not postpone a frozen-clock observation, a timer delivered after process suspension gets one fresh observation window, and seek jumps are sampled separately from clock progress. The optional strict background-admission fixture rejects new or deactivated players without fresh activation; its rate/play wake responses are explicit test scenarios, not guarantees about real iOS. Publishing a paused MediaSession state after a persistent stall does not itself prove that iOS's widget changes appearance: WebKit also uses the underlying HTML media session's state for Now Playing. Physical Control Center behavior still needs a device check.

The iPhone report for version 64 confirmed successful automatic resume after recording a voice message, including clock progression while hidden. Manual Control Center Pause/Play still emitted `playing` with a frozen clock; quick repeated pauses cancelled the three-second watchdog. Version 65 reissued the unchanged rate after native `playing`, but the subsequent physical report showed that command executed three times while the clock remained at 9.60 seconds. That workaround is removed.

A system Play after a confirmed manual Pause now synchronously calls `load()` and `play()` on the original HTMLAudioElement in the iOS background control callback. This rebuilds the native MediaPlayer/AVPlayer instead of repeating commands on its frozen decoder ([HTMLMediaElement](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/html/HTMLMediaElement.cpp), [AVFoundation](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateAVFoundationObjC.mm)). The URL and element stay the same; the saved position is restored and clamped after metadata arrives, and playback speed is preserved across load. No network lookup or await precedes the initial play. This can incur buffering comparable to an initial start. This manual-restart path applies only to hidden iOS with playback intent cleared and the element paused, and skips known active capture. Microphone auto-resume retaining playback intent keeps the existing decoder; foreground/UI Play follows its existing recovery rules. Stable playback category and interruption classification are unchanged. The opt-in strict decoder-wedge fixture makes an already-loaded remote player emit optimistic `playing` while its clock stays frozen despite rate writes, and clears that decoder state on resource reload. Regression checks verify synchronous control admission, checkpoint restoration, repeat toggles, Pause/Next cancellation, and native WAV playback. This fixture models the observed failure and a reconstructed decoder; it does not prove audible recovery on the iPhone.

WebKit exposes `AudioSession.type` separately from its gated `state` property ([IDL](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/Modules/audiosession/DOMAudioSession.idl#L54)). A `statechange` event with no readable state must therefore not be interpreted as proof that capture has ended. Passive native audio pauses retain interruption intent; the remote Pause handler still stops ordinary playback. MediaSession's paused state is published inside the native Pause callback, where WebKit protects its saved interruption state ([implementation](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/platform/audio/PlatformMediaSession.cpp#L221)), without pausing or loading the HTML audio element during that callback. Public MediaSession actions do not identify whether iOS or the user initiated them, so classification uses the available native element events.

From the repository root, install the test dependencies once:

```sh
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install --with-deps webkit chromium
```

Start a static server in a separate terminal:

```sh
python3 -m http.server 8911 --bind 127.0.0.1 --directory .
```

Run all checks:

```sh
python3 tests/audio-recovery.py
```

A failed check exits with status 1. The JSON report defaults to `/tmp/pasha-audio-recovery-results.json`.

Run selected checks:

```sh
python3 tests/audio-recovery.py --list-cases
python3 tests/audio-recovery.py --engines webkit --cases 'pending*,new_capture*'
python3 tests/audio-recovery.py --cases native_wav_playback
```

Optional environment variables:

- `PASHAMUSIC_TEST_URL`: page URL; defaults to `http://127.0.0.1:8911/music/`.
- `PASHAMUSIC_CHROMIUM_EXECUTABLE`: Chromium executable; otherwise the script uses `chromium`/`chromium-browser` from PATH or Playwright's installed Chromium.
- `PASHAMUSIC_TEST_REPORT`: JSON report path.
- `PASHAMUSIC_TEST_ENGINES`: comma-separated browser engines; defaults to `webkit,chromium`.
- `PASHAMUSIC_TEST_CASES`: comma-separated case names or glob patterns.
- `PASHAMUSIC_TEST_REPO`: repository directory override; normally the script resolves the repository from its location under `tests/`.

The tests intercept API calls and use local fixture tracks. Strict simulations shorten the routed JavaScript copy's 8000/10000 ms playback/network timeouts to 350/800 ms; native WAV checks keep production timeouts. Production files are unchanged. The browser user agent is set to iOS 26.5 for the app's browser-specific paths. AudioSession state changes and system control actions are simulated.

## Home navigation and startup checks

With the same test dependencies and local server, run:

```sh
python3 tests/home-navigation.py
python3 tests/startup-loading.py
node tests/service-worker.cjs
```

The navigation checks cover both swipe directions, nested horizontal rails, vertical scrolling, keyboard geometry, settings navigation, and separate scroll positions for Search and My Music in WebKit and Chromium. Touch sequences and the keyboard viewport are simulated; these checks do not replace an iPhone check.

Service-worker checks cover repeat asset loads, offline/slow navigation, cache updates, and bypassing authenticated/API requests. They run in Node without additional dependencies.

Startup checks start their own local fixture server and cover the small cat poster, delayed/failed animation loading, WebKit retry after connectivity returns, lazy loading, cached/offline launch, and preserving a typed search during library loading. API calls use fake local responses.

These checks validate events, playback position, full element volume, and MediaSession commands in headless desktop WebKit/Chromium. They do not measure audible output or reproduce an actual iPhone's microphone ownership, audio routing, and Control Center. A physical iPhone should still be checked with an external voice-recording app, repeated capture/stop cycles, screen lock, manual Pause, remote Play/Next/Previous/seek, and the speaker/Bluetooth route that showed the original reduced-volume issue.
