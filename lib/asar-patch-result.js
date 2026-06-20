/**
 * ASAR patch result classification helpers.
 * Used by game-stager applyAsarPatch to decide whether stderr/exit should fail a build.
 */

/**
 * Classify ASAR stderr lines as warnings or errors.
 * ASAR format: /path/file.asm:136: warning: (Wfeature_deprecated): ...
 * @param {string} stderr
 * @returns {{ hasErrors: boolean, hasWarnings: boolean, warningLines: string[], errorLines: string[] }}
 */
function classifyAsarStderr(stderr) {
  const result = {
    hasErrors: false,
    hasWarnings: false,
    warningLines: [],
    errorLines: [],
  };

  if (!stderr || !String(stderr).trim()) {
    return result;
  }

  const lines = String(stderr).split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    if (/:\s*error\s*:/i.test(line)) {
      result.hasErrors = true;
      result.errorLines.push(line);
    } else if (/:\s*warning\s*:/i.test(line)) {
      result.hasWarnings = true;
      result.warningLines.push(line);
    } else {
      result.hasErrors = true;
      result.errorLines.push(line);
    }
  }

  return result;
}

/**
 * Detect fatal ASAR messages in stdout (binary missing, invalid command, etc.).
 * @param {string} stdout
 * @returns {boolean}
 */
function stdoutHasFatalAsarMessage(stdout) {
  if (!stdout || !String(stdout).trim()) {
    return false;
  }
  const text = String(stdout);
  return text.includes('is not an asar command')
    || /\berror\b/i.test(text);
}

/**
 * Decide whether ASAR output should fail the patch step.
 * @param {object} params
 * @param {boolean} params.ignoreWarnings
 * @param {number} params.exitCode
 * @param {string} params.stderr
 * @param {string} params.stdout
 * @param {boolean} params.romModified
 * @returns {{ fail: boolean, error?: string, ignoredWarnings?: string[] }}
 */
function shouldFailAsarOutput({ ignoreWarnings, exitCode, stderr, stdout, romModified }) {
  const stderrInfo = classifyAsarStderr(stderr);
  const stdoutFatal = stdoutHasFatalAsarMessage(stdout);

  if (ignoreWarnings) {
    if (exitCode !== 0) {
      return {
        fail: true,
        error: `ASAR exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ''}`,
      };
    }

    if (stderrInfo.hasErrors) {
      return {
        fail: true,
        error: `ASAR reported an error: ${stderrInfo.errorLines.join('\n') || stderr.trim()}`,
      };
    }

    if (stdoutFatal) {
      return {
        fail: true,
        error: `ASAR reported an error: ${stdout.trim()}`,
      };
    }

    if (!romModified) {
      return {
        fail: true,
        error: 'ASAR did not modify the target ROM',
      };
    }

    return {
      fail: false,
      ignoredWarnings: stderrInfo.warningLines,
    };
  }

  // Default strict behavior: any stderr or fatal stdout fails.
  if (stderr && String(stderr).trim()) {
    return {
      fail: true,
      error: `ASAR reported an error: ${String(stderr).trim()}`,
    };
  }

  if (stdoutFatal) {
    return {
      fail: true,
      error: `ASAR reported an error: ${String(stdout).trim()}`,
    };
  }

  return { fail: false };
}

module.exports = {
  classifyAsarStderr,
  stdoutHasFatalAsarMessage,
  shouldFailAsarOutput,
};
