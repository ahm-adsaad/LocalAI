// Set the theme class before first paint to avoid a flash of the wrong theme.
// Lives in its own file so the page needs no inline-script exception in its CSP.
try {
  var stored = localStorage.getItem('localai-theme')
  document.documentElement.classList.toggle('dark', stored ? stored === 'dark' : true)
} catch {}
