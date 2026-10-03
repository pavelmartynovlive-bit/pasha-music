## Audio recovery regression checks

These tests cover the playback position and event ordering around microphone interruptions, remote MediaSession commands, failed/stalled playback, asynchronous cancellation, and decoder replacement. Every strict scenario runs in a fresh page. The native WAV scenarios use actual HTMLAudioElement playback and byte-range responses in both browser engines.

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
