// Sticky Google AdSense banner in a bar above or below the game.
//
// The bar sits outside #stage, so the game shrinks to fit beside it (the
// canvas resizes from the stage) and taps on the ad never reach the game's
// input handlers. Nothing renders until ADS is filled in, except with
// ?adpreview in the URL, which shows a placeholder of the same size.
(function () {
  'use strict';

  var ADS = {
    client: 'ca-pub-XXXXXXXXXXXXXXXX', // AdSense > Account > Publisher ID, with "ca-" in front
    slot: 'XXXXXXXXXX',                // AdSense > Ads > By ad unit > Display ads: data-ad-slot
    position: 'top'                    // 'top' or 'bottom'
  };

  var configured = /^ca-pub-\d{16}$/.test(ADS.client) && /^\d{6,}$/.test(ADS.slot);
  var preview = /[?&]adpreview(=|&|$)/.test(window.location.search);
  if (!configured && !preview) return;

  var bar = document.createElement('aside');
  bar.className = 'fl-ad';
  bar.setAttribute('aria-label', 'Advertisement');
  document.body.setAttribute('data-ad', ADS.position === 'bottom' ? 'bottom' : 'top');

  if (!configured) {
    var box = document.createElement('div');
    box.className = 'fl-ad-slot fl-ad-preview';
    box.textContent = 'Ad';
    bar.appendChild(box);
    document.body.insertBefore(bar, document.body.firstChild);
    return;
  }

  // Exact size per screen width comes from .fl-ad-slot in style.css, which
  // is Google's documented way to pin a responsive unit to banner sizes.
  var ins = document.createElement('ins');
  ins.className = 'adsbygoogle fl-ad-slot';
  ins.style.display = 'block';
  ins.setAttribute('data-ad-client', ADS.client);
  ins.setAttribute('data-ad-slot', ADS.slot);
  bar.appendChild(ins);
  document.body.insertBefore(bar, document.body.firstChild);

  var lib = document.createElement('script');
  lib.async = true;
  lib.crossOrigin = 'anonymous';
  lib.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADS.client;
  document.head.appendChild(lib);
  (window.adsbygoogle = window.adsbygoogle || []).push({});
})();
