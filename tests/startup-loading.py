"""Run: python3 tests/startup-loading.py [--engines webkit,chromium].
Local fixtures, real images/SW, fake API credentials; no production API calls.
"""
import argparse, asyncio, json, os, shutil, socket, threading, time
from collections import Counter
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(os.getenv('PASHAMUSIC_TEST_REPO', Path(__file__).resolve().parents[1]))
IDLE = "document.querySelector('.cat-mascot-idle')"
POSTER = "document.querySelector('.cat-mascot-poster')"
PLAYING_PATH = '/music/assets/cat-playing.webp'
class Fixture:
    mode = 'normal'
    def __init__(self):
        self.counts, self.starts, self.release = Counter(), {}, threading.Event()
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        try:
            self.serve_get()
        except (BrokenPipeError, ConnectionResetError):
            pass  # A closed browser page can cancel an outstanding fixture request.
    def serve_get(self):
        fixture, key = self.server.fixture, self.path.split('?')[0]
        fixture.counts[key] += 1
        fixture.starts.setdefault(key, []).append(time.monotonic())
        if fixture.mode == 'offline':
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            return
        if key.startswith('/api/'):
            if key in ('/api/health', '/api/sections'):
                time.sleep(.8)
            if key.startswith('/api/sections/'):
                time.sleep(.3)
                data = {'result': {'title': 'Fixture', 'tracks': []}}
            elif key == '/api/health':
                data = {'hasCookieP': True, 'hasRemixSid': True}
            elif key == '/api/sections':
                data = {'result': {'defaultSection': 'all', 'sections': [{'id': 'all', 'title': 'Fixture'}]}}
            else:
                data = {'result': {'suggestions': [], 'tracks': [], 'albums': []}}
            body = json.dumps(data).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if key.endswith('cat-idle.webp'):
            if fixture.mode == 'slow':
                fixture.release.wait(8)
            elif fixture.mode in ('failed', 'failed-both'):
                self.send_error(503)
                return
        if key.endswith('cat-poster.webp') and fixture.mode == 'failed-both':
            self.send_error(503)
            return
        super().do_GET()
    def log_message(self, *args):
        pass
async def new_page(browser, origin, workers='block'):
    context = await browser.new_context(service_workers=workers, viewport={'width': 393, 'height': 852})
    config = json.dumps({'backendUrl': origin, 'apiKey': 'test-only'})
    await context.add_init_script(f"localStorage.setItem('pashaMusicConnectionV1', {json.dumps(config)});")
    return context, await context.new_page()
async def check_engine(browser, engine, server):
    fixture, origin = server.fixture, f'http://127.0.0.1:{server.server_port}'
    fixture.counts.clear()
    context, page = await new_page(browser, origin, 'allow')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto(origin + '/music/')
    await asyncio.wait_for(page.evaluate('navigator.serviceWorker.ready'), 15)
    await page.wait_for_function('!!navigator.serviceWorker.controller')
    await page.wait_for_function(f"{IDLE}.dataset.ready === 'true'")
    assert not errors and fixture.counts[PLAYING_PATH] == 0, errors
    # The first controlled load populates runtime caches after a clean install.
    await page.reload()
    await page.wait_for_function(f"{IDLE}.dataset.ready === 'true'")
    await page.wait_for_timeout(100)
    before = fixture.counts['/music/assets/cat-idle.webp']
    await page.reload()
    await page.wait_for_function(f"{IDLE}.dataset.ready === 'true'")
    assert fixture.counts['/music/assets/cat-idle.webp'] == before, 'Repeated launch downloaded the cached animation'
    fixture.mode = 'offline'
    await page.reload()
    await page.wait_for_function(f"{IDLE}.dataset.ready === 'true'")
    await context.close()
    for mode in ('slow', 'failed', 'failed-both'):
        fixture.mode = mode
        fixture.release.clear()
        context, page = await new_page(browser, origin)
        await page.goto(origin + '/music/', wait_until='domcontentloaded')
        if mode == 'failed-both':
            await page.wait_for_function(f"{IDLE}.dataset.failed === 'true' && {POSTER}.dataset.ready === 'false'")
            assert await page.evaluate(f"getComputedStyle({POSTER}).visibility === 'hidden'")
        else:
            await page.wait_for_function(f"{POSTER}.naturalWidth > 0 && getComputedStyle({POSTER}).opacity === '1'")
            if mode == 'failed':
                await page.wait_for_function(f"{IDLE}.dataset.failed === 'true'")
        assert await page.evaluate(f"getComputedStyle({IDLE}).visibility === 'hidden'"), 'Broken/loading image became visible'
        assert await page.locator('.cat-mascot-playing').get_attribute('src') is None
        if mode == 'failed':
            fixture.mode = 'normal'
            await page.evaluate("window.dispatchEvent(new Event('online'))")
            await page.wait_for_function(f"{IDLE}.dataset.ready === 'true'", timeout=2500)
        fixture.release.set()
        await context.close()
    fixture.mode = 'normal'
    fixture.starts.clear()
    context, page = await new_page(browser, origin)
    await page.goto(origin + '/music/', wait_until='domcontentloaded')
    await page.locator('#searchInput').fill('Кино')
    await page.wait_for_function("document.querySelector('#sectionTitle').textContent === 'Fixture'")
    assert await page.locator('#searchInput').input_value() == 'Кино', 'Startup erased the typed search'
    gap = abs(fixture.starts['/api/health'][0] - fixture.starts['/api/sections'][0])
    assert gap < .2, 'Startup health and sections requests were serialized'
    await context.close()
    print(f'PASS {engine}: cached/offline launch, lazy playing, slow/failed poster, Safari online retry, all failed images hidden, typed search preserved', flush=True)
async def main(engines, server):
    async with async_playwright() as playwright:
        for engine in engines:
            options = {}
            executable = os.getenv('PASHAMUSIC_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('chromium-browser')
            if engine == 'chromium' and executable:
                options = {'executable_path': executable, 'args': ['--no-sandbox']}
            browser = await getattr(playwright, engine).launch(**options)
            try:
                await check_engine(browser, engine, server)
            finally:
                await browser.close()
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engines', default=os.getenv('PASHAMUSIC_TEST_ENGINES', 'webkit,chromium'))
    engines = parser.parse_args().engines.split(',')
    if any(engine not in ('webkit', 'chromium') for engine in engines):
        parser.error('Engines must be webkit and/or chromium')
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    server.fixture = Fixture()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(main(engines, server))
    finally:
        server.fixture.release.set()
        server.shutdown()
        server.server_close()
