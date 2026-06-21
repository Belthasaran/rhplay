'use strict';

const RETROPAD_KEYS = [
  'network_remote_enable = "true"',
  'network_remote_base_port = "55400"',
  'network_remote_enable_user_p1 = "true"',
];

function mergeAppendConfigRetropad(content) {
  let lines = String(content || '').split(/\r?\n/);
  const existing = new Set(lines.map((l) => l.trim()).filter(Boolean));
  for (const keyLine of RETROPAD_KEYS) {
    const key = keyLine.split('=')[0].trim();
    const hasKey = lines.some((l) => l.trim().startsWith(`${key} =`) || l.trim().startsWith(`${key}=`));
    if (!hasKey) {
      lines.push(keyLine);
    }
  }
  return `${lines.filter((l, i, arr) => !(i === arr.length - 1 && l === '')).join('\n')}\n`;
}

function mergeHeadlessAppend(content) {
  const headlessKeys = [
    'video_driver = "null"',
    'audio_driver = "null"',
  ];
  return mergeAppendConfigRetropad(content)
    .split(/\r?\n/)
    .concat(headlessKeys.filter((k) => {
      const name = k.split('=')[0].trim();
      return !String(content).includes(name);
    }))
    .join('\n') + '\n';
}

module.exports = {
  RETROPAD_KEYS,
  mergeAppendConfigRetropad,
  mergeHeadlessAppend,
};
