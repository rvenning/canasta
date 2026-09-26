// Screenshot the running app in headless Edge.
//   node tools/shot.cjs <url> <out.png> [width] [height] [steps] [waitMs]
// `steps` is JavaScript, or @file; steps separated by a line "---" run in turn with
// `waitMs` between them. A line "SHOT name" inside a step file takes an extra screenshot.
const { launch, wait } = require('./lib/cdp.cjs');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const [url, out, w = 390, h = 844, js = '', ms = 1200] = process.argv.slice(2);
  const b = await launch({ width: +w, height: +h, dpr: 2 });
  await b.send('Page.navigate', { url });
  await wait(1500);
  const src = js.startsWith('@') ? fs.readFileSync(js.slice(1), 'utf8') : js;
  const shot = async (file) => { const r = await b.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  for (const step of src ? src.split(/\n---\n/) : []) {
    const m = /^SHOT (\S+)/.exec(step.trim());
    if (m) { await shot(path.join(path.dirname(out), m[1] + '.png')); continue; }
    try { const v = await b.evaluate(step); if (v !== undefined) console.log('>', JSON.stringify(v).slice(0, 400)); } catch (e) { console.log('step error', e.message); }
    await wait(+ms);
  }
  await shot(out);
  if (b.logs.length) console.log(b.logs.join('\n'));
  await b.close();
})();
