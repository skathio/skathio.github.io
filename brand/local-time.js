// Shows a build time in the visitor's own time zone. The page is built on a server and cannot
// know that zone, so it ships the UTC time and this rewrites it; without script, UTC stays.
// The format matches the page's UTC dates ("24 Nov 2026, 11:12 CET"); only the zone changes.
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var nodes = document.querySelectorAll('time[data-local]');
    for (var i = 0; i < nodes.length; i++) {
      var t = Date.parse(nodes[i].getAttribute('datetime') || '');
      if (isNaN(t)) continue;
      try {
        nodes[i].textContent = new Date(t).toLocaleString('en-GB', {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        });
      } catch (e) { /* an old browser without Intl options: keep the UTC time */ }
    }
  });
})();
