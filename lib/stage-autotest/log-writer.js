'use strict';

const fs = require('fs');
const path = require('path');

class StageAutoTestLogWriter {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(process.cwd(), 'stage-autotest-logs');
    this.meta = options.meta || {};
    this.lines = [];
    this.phases = {};
    this.failures = [];
    this.warnings = [];
    this.result = 'PENDING';
    this.logPath = null;
    this.jsonPath = null;
  }

  header() {
    this.line('=== STAGE AUTO TEST ===');
    for (const [k, v] of Object.entries(this.meta)) {
      this.line(`${k}=${v}`);
    }
    this.line(`result=${this.result}`);
    this.line('');
  }

  line(text = '') {
    this.lines.push(String(text));
  }

  phase(name, fields = {}) {
    this.phases[name] = fields;
    this.line(`--- PHASE ${name} ---`);
    for (const [k, v] of Object.entries(fields)) {
      this.line(`${k}=${v}`);
    }
    this.line('');
  }

  section(title, fields = {}) {
    this.line(`--- ${title} ---`);
    for (const [k, v] of Object.entries(fields)) {
      this.line(`${k}=${v}`);
    }
    this.line('');
  }

  addFailure(message) {
    this.failures.push(message);
  }

  addWarning(message) {
    this.warnings.push(message);
  }

  setResult(result) {
    this.result = result;
  }

  finalize() {
    this.line('--- FAILURES ---');
    if (this.failures.length === 0) {
      this.line('(none)');
    } else {
      for (const f of this.failures) this.line(f);
    }
    this.line('');
    if (this.warnings.length > 0) {
      this.line('--- WARNINGS ---');
      for (const w of this.warnings) this.line(w);
      this.line('');
    }
  }

  write() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${this.meta.gameid || 'game'}_v${this.meta.version || '1'}_${this.meta.levelnumber || 'lvl'}_${ts}`;
    this.logPath = path.join(this.logDir, `${base}.log`);
    this.jsonPath = path.join(this.logDir, `${base}.json`);

    const headerIdx = this.lines.findIndex((l) => l.startsWith('result='));
    if (headerIdx >= 0) {
      this.lines[headerIdx] = `result=${this.result}`;
    }

    fs.writeFileSync(this.logPath, `${this.lines.join('\n')}\n`, 'utf8');
    const summary = {
      result: this.result,
      meta: this.meta,
      phases: this.phases,
      failures: this.failures,
      warnings: this.warnings,
      logPath: this.logPath,
    };
    fs.writeFileSync(this.jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return { logPath: this.logPath, jsonPath: this.jsonPath, summary };
  }
}

module.exports = { StageAutoTestLogWriter };
