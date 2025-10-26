window.addEventListener('DOMContentLoaded', () => {
    const versionEl = document.getElementById('version');
    if (versionEl && window.rhtools) {
        versionEl.textContent = window.rhtools.version;
    }
});


