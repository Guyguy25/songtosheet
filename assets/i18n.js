/* Tablurio — langue de l'interface (FR / EN).
 * - Le choix est mémorisé dans localStorage ("tablurio_lang") et suit l'utilisateur partout :
 *   landing, pages outils, parcours de génération, inscription, onboarding, studio.
 * - Sans choix enregistré : français, sauf sur les pages anglaises (/en/...), qui enregistrent "en".
 * - Pages outils statiques : <html data-alt-fr="/..." data-alt-en="/en/..."> → redirection vers la version
 *   dans la langue choisie.
 * - Application (index.html, <html data-i18n="app">) : traduction à la volée avec window.TABLURIO_EN
 *   (assets/i18n-en.js) + MutationObserver pour les textes ajoutés par le JavaScript.
 */
(function () {
  'use strict';
  var KEY = 'tablurio_lang';
  var root = document.documentElement;
  var pageLang = (root.getAttribute('lang') || 'fr').slice(0, 2);
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  var stored = read();
  if (stored !== 'fr' && stored !== 'en') stored = null;
  var lang = stored || (pageLang === 'en' ? 'en' : 'fr');
  if (!stored && pageLang === 'en') write('en');
  // Le serveur lit ce cookie pour envoyer les emails dans la bonne langue.
  try { if (stored || pageLang === 'en') document.cookie = 'tablurio_lang=' + lang + ';path=/;max-age=31536000;samesite=lax'; } catch (e) {}

  // Pages outils : aller directement à la version dans la langue choisie.
  var alt = root.getAttribute('data-alt-' + lang);
  if (stored && lang !== pageLang && alt) { location.replace(alt + location.search + location.hash); return; }

  var isApp = root.getAttribute('data-i18n') === 'app';
  var DICT = window.TABLURIO_EN || {};
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  // Liens vers les pages outils : version anglaise quand l'interface est en anglais.
  var LINKS = { '/apprendre': '/en/learn', '/apprendre/lire-une-tablature-guitare': '/en/learn/how-to-read-guitar-tabs', '/apprendre/transformer-video-youtube-en-tablature': '/en/learn/youtube-to-guitar-tabs', '/a-propos': '/en/about', '/contact': '/en/contact', '/youtube-en-partition': '/en/youtube-to-sheet-music', '/tablature-guitare': '/en/guitar-tab-generator', '/partition-piano': '/en/piano-sheet-music', '/mp3-en-partition': '/en/mp3-to-sheet-music', '/spotify-en-partition': '/en/spotify-to-sheet-music', '/deezer-en-partition': '/en/deezer-to-sheet-music', '/musicxml': '/en/musicxml', '/midi': '/en/midi' };
  var PATTERNS = [
    [/^Étape (\d+) sur (\d+)$/i, 'Step $1 of $2'],
    [/^ÉTAPE (\d+) SUR (\d+)$/, 'STEP $1 OF $2'],
    [/^(\d+) partitions?$/, '$1 sheet music'],
    [/^(\d+) aperçus? gratuits?$/, '$1 free preview(s)'],
    [/^(\d+(?:[.,]\d+)?) Mo$/, '$1 MB'],
    [/^Lien (\w+) reconnu/, '$1 link recognised'],
  ];

  // Clés avec nombres variables : "{n} notes estimées." → "{n} estimated notes."
  var NUMDICT = {};
  for (var dk in DICT) if (Object.prototype.hasOwnProperty.call(DICT, dk) && dk.indexOf('{n}') !== -1) NUMDICT[dk] = DICT[dk];
  var NUM = /\d+(?:[.,:]\d+)*/g;
  function one(key) {
    if (Object.prototype.hasOwnProperty.call(DICT, key)) return DICT[key];
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i][0].test(key)) return key.replace(PATTERNS[i][0], PATTERNS[i][1]);
    var nums = key.match(NUM);
    if (nums) {
      var tpl = key.replace(NUM, '{n}');
      if (Object.prototype.hasOwnProperty.call(NUMDICT, tpl)) { var k = 0; return NUMDICT[tpl].replace(/\{n\}/g, function () { return nums[k++]; }); }
    }
    return null;
  }
  // Morceaux séparés par « · » (méta d'un morceau : instrument · format · accès).
  function dots(key) {
    if (key.indexOf(' · ') === -1) return null;
    // Plus long groupe de morceaux connu d'abord (« Aperçu gratuit · 30 s » est une seule clé).
    var parts = key.split(' · '), out = [], hit = false, i = 0;
    while (i < parts.length) {
      var j = parts.length, t = null;
      for (; j > i; j--) { t = one(parts.slice(i, j).join(' · ')); if (t !== null) break; }
      if (t !== null) { out.push(t); hit = true; i = j; } else { out.push(parts[i]); i++; }
    }
    return hit ? out.join(' · ') : null;
  }
  function tr(text) {
    var key = text.replace(/\s+/g, ' ').trim();
    if (!key) return null;
    var t = one(key);
    if (t !== null) return t;
    if ((t = dots(key)) !== null) return t;
    // Phrases assemblées par le code : traduites une par une.
    var sentences = key.replace(/([.!?…])\s+(?=[A-ZÀ-ÖØ-Þ«(])/g, '$1\u0001').split('\u0001');
    if (sentences.length > 1) {
      var hit = false;
      for (var i = 0; i < sentences.length; i++) { var s = one(sentences[i]); if (s === null) s = dots(sentences[i]); if (s !== null) { sentences[i] = s; hit = true; } }
      if (hit) return sentences.join(' ');
    }
    return null;
  }
  function textNode(n) {
    var p = n.parentNode;
    if (!p || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'TEXTAREA') return;
    var v = n.nodeValue, t = tr(v);
    if (t === null || t === v) return;
    var lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
    n.nodeValue = lead + t + trail;
  }
  function element(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute && el.getAttribute(ATTRS[i]);
      if (a) { var t = tr(a); if (t !== null && t !== a) el.setAttribute(ATTRS[i], t); }
    }
    if (el.hasAttribute && el.hasAttribute('data-word')) {
      var w = el.getAttribute('data-word'), tw = DICT[w];
      if (tw && (el.id === 'hero-typed-word' || (el.classList && el.classList.contains('hero-word-measure')))) el.setAttribute('data-word', tw);
    }
    if (el.tagName === 'A') { var h = el.getAttribute('href'); if (h && Object.prototype.hasOwnProperty.call(LINKS, h)) el.setAttribute('href', LINKS[h]); }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) { var tv = tr(el.value); if (tv) el.value = tv; }
  }
  function walk(node) {
    if (node.nodeType === 3) { textNode(node); return; }
    if (node.nodeType !== 1) return;
    if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;
    element(node);
    var w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else element(n); }
  }
  function title() { var t = tr(document.title); if (t && t !== document.title) document.title = t; }

  function startTranslation() {
    root.setAttribute('lang', 'en');
    root.classList.add('i18n-pending');
    var busy = false;
    var obs = new MutationObserver(function (list) {
      if (busy) return; busy = true;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'characterData') textNode(m.target);
        else if (m.type === 'attributes') element(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
      title(); busy = false;
    });
    obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['data-word']) });
    function full() { walk(document.body || root); title(); root.classList.remove('i18n-pending'); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', full); else full();
    setTimeout(function () { root.classList.remove('i18n-pending'); }, 1500);
  }
  if (isApp && lang === 'en') {
    var st = document.createElement('style');
    st.textContent = 'html.i18n-pending body{visibility:hidden}';
    (document.head || root).appendChild(st);
    startTranslation();
  }

  // Sélecteur FR / EN (boutons .lang-switch [data-lang]).
  function setLang(next) {
    if (next === lang) return;
    write(next);
    var target = root.getAttribute('data-alt-' + next);
    if (target) { location.href = target; return; }
    location.reload();
  }
  function wire() {
    var btns = document.querySelectorAll('.lang-switch [data-lang]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], on = b.getAttribute('data-lang') === lang;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('active', on);
      b.onclick = function (e) { e.preventDefault(); setLang(this.getAttribute('data-lang')); };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.TablurioI18n = { lang: lang, set: setLang, t: function (s) { return lang === 'en' ? (tr(s) || s) : s; } };
})();
