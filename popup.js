const PRESETS = [1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const DEFAULTS = { multiplier: 2, delay: 200, autoSkip: true };
const $ = (id) => document.getElementById(id);

const speed = $("speed");
const custom = $("custom");
const delay = $("delay");
speed.max = PRESETS.length - 1;

for (const [i, p] of PRESETS.entries()) {
  $("dots").append(document.createElement("span"));
  const b = document.createElement("button");
  b.textContent = `${p}×`;
  b.onclick = () => setSpeed(p, true);
  $("labels").append(b);
}

const setFill = (input) =>
  input.parentElement.style.setProperty("--p", (input.value - input.min) / (input.max - input.min));

function setSpeed(m, save) {
  const exact = PRESETS.indexOf(m);
  // Non-preset value: park the thumb on the nearest stop and mark it as custom.
  const idx = exact >= 0 ? exact : PRESETS.reduce((b, p, i) => (Math.abs(p - m) < Math.abs(PRESETS[b] - m) ? i : b), 0);
  speed.value = idx;
  setFill(speed);
  $("speedCard").classList.toggle("is-custom", exact < 0);
  $("dots").querySelectorAll("span").forEach((d, i) => d.classList.toggle("on", exact >= 0 && i <= idx));
  $("labels").querySelectorAll("button").forEach((b, i) => b.classList.toggle("sel", i === exact));
  $("speedOut").textContent = `${m}×`;
  if (document.activeElement !== custom) custom.value = m;
  if (save) chrome.storage.sync.set({ multiplier: m });
}

function setDelay(ms, save) {
  delay.value = ms;
  setFill(delay);
  $("delayOut").textContent = `${ms} ms`;
  if (save) chrome.storage.sync.set({ delay: ms });
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  setSpeed(s.multiplier, false);
  setDelay(s.delay, false);
  $("autoSkip").checked = s.autoSkip;
});

speed.addEventListener("input", () => setSpeed(PRESETS[speed.value], true));
$("autoSkip").addEventListener("change", (e) => chrome.storage.sync.set({ autoSkip: e.target.checked }));
delay.addEventListener("input", () => setDelay(+delay.value, true));
custom.addEventListener("input", () => {
  const v = Math.round(parseFloat(custom.value) * 100) / 100;
  // Chrome rejects playbackRate outside 0.0625–16.
  if (v >= 0.25 && v <= 16) setSpeed(v, true);
});
custom.addEventListener("blur", () => (custom.value = parseFloat($("speedOut").textContent)));
