## Audio recovery regression checks

These checks cover microphone interruptions, native auto-resume, manual MediaSession commands, saved positions, stalled playback, asynchronous cancellation, and foreground decoder replacement. Strict scenarios simulate both full and type-only AudioSession APIs. Native WAV scenarios use actual HTMLAudioElement playback and byte-range responses in WebKit and Chromium.

The iPhone reports establish two different outcomes: app version 64 successfully resumed after external microphone capture, but manual Control Center Pause/Play still reported `playing` with a frozen clock. Version 66's background `load()` workaround remained at `readyState=1`, `seeking=true` for several minutes, then completed within about 1.4 seconds after returning to the PWA. Background recovery therefore retains the original loaded player, including after a confirmed clock stall. Decoder reload/replacement is a foreground fallback only.

A confirmed manual iOS background Play re-admits the existing element once, synchronously within the same explicit remote callback. In older WebKit, [`sessionWillBeginPlayback`](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/platform/audio/MediaSessionManagerInterface.cpp#L443) checks activation before [`clientWillBeginPlayback`](https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/platform/audio/PlatformMediaSession.cpp#L269) changes Paused to Playing. The active-session requirement depends on already being Playing. Re-admission after the first call has unpaused a loaded element exercises that activation check again. Both play promises are observed; a denied/paused first call is not repeated. Later [WebKit activation changes](https://github.com/WebKit/WebKit/commit/ee87be3a43275f2c14fbe8248938c6fce3d31651) explicitly activate the producing session before completing playback admission. This is a source-informed workaround; the exact native failure and audible success on the user's iOS build still require a physical check.

The strict inactive-session fixture models that ordering separately from resource loading. It verifies immediate remote admission, preserving the source/position/rate/buffer, repeated manual toggles, denial, and cancellation through Pause/Next. A persistent native stall still has a bounded play-only watchdog; tests do not assume every native stall can be repaired. Neither the fixture nor Linux native WAV playback reproduces iPhone audio-session ownership. The available Linux WebKit engine also rejects the local AAC/HLS fixture, so these checks do not validate native iOS HLS streaming.

Automatic microphone recovery keeps its existing behavior: native `playing` is accepted without resetting the player, an interrupted position is restored when necessary, and unknown capture timeouts preserve native interruption state. The background clock watchdog observes actual time progression for 3 seconds, reissues the unchanged rate and requests playback once, then observes for another 3 seconds. It never pauses, loads, replaces the element, changes speed, or seeks merely to repair a background clock. Repeated playing events and seek jumps do not count as clock progression. A timer delivered after process suspension receives one fresh observation window.

Remote Pause is published inside its native callback, preserving WebKit's saved interruption state. The short classification window distinguishes native capture from manual Pause using available AudioSession/element events; a late event after process suspension does not automatically become a manual Pause. Native APIs do not identify the origin of every Pause. An explicit user Pause always cancels pending recovery, and late completion cannot replace or seek a newer track.

Diagnostics retain at most 80 events and contain no keys, source URLs, or track metadata. They include bounded numeric buffered/seekable ranges, format labels, network/readiness states, lifecycle events, and a current snapshot when copied. Identical noisy lifecycle notifications are throttled; continuous timeupdate/progress events are not logged.

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
