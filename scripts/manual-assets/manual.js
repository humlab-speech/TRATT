// Progressive enhancement only: the manual is fully readable without this.
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var sidebar = document.getElementById('sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      var open = sidebar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Theme: the inline script in <head> has already set data-bs-theme.
  var themeButton = document.querySelector('.theme-toggle');
  if (themeButton) {
    var root = document.documentElement;
    var sync = function () {
      themeButton.setAttribute(
        'aria-pressed',
        String(root.getAttribute('data-bs-theme') === 'dark'),
      );
    };
    sync();
    themeButton.addEventListener('click', function () {
      var next =
        root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-bs-theme', next);
      try {
        localStorage.setItem('tratt.manual.theme', next);
      } catch (e) {}
      sync();
    });
  }

  // Filter the page list. Small enough that no search index is needed.
  var filter = document.querySelector('.nav-filter input');
  if (filter) {
    filter.addEventListener('input', function () {
      var term = filter.value.trim().toLowerCase();
      document.querySelectorAll('.nav-section').forEach(function (section) {
        var visible = 0;
        section.querySelectorAll('li').forEach(function (item) {
          var link = item.querySelector('a');
          if (!link) return;
          var match =
            !term || link.textContent.toLowerCase().indexOf(term) !== -1;
          item.classList.toggle('nav-hidden', !match);
          if (match) visible++;
        });
        section.classList.toggle('nav-hidden', term !== '' && visible === 0);
      });
    });
  }

  // Wide tables get their own horizontal scroll container.
  document.querySelectorAll('article table').forEach(function (table) {
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
})();
