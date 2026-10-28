/*
 * Séquence — application (journal privé de films et de séries)
 * Pages : #journal, #videotheque, #a-voir, #stats, #fiche-movie-123, #fiche-tv-123
 */
(function () {
  'use strict';

  var store = window.SequenceStore;
  var TMDB = window.TMDB;
  var uid = window.SequenceUid;
  var app = document.getElementById('app');

  var MONTHS = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEP', 'OCT', 'NOV', 'DÉC'];
  var MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var CRITERIA = [['gen', 'Note générale'], ['sce', 'Scénario'], ['rea', 'Réalisation et image'], ['act', 'Acteurs'], ['emo', 'Émotion'], ['mus', 'Musique']];
  var LIEUX = ['Cinéma', 'Streaming', 'Télé', 'DVD / Blu-ray'];
  var STATUS_LABEL = { a_voir: 'À voir', vu: 'Vu', en_cours: 'En cours', abandonne: 'Abandonné' };

  var ICON = {
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5L21 21"></path></svg>',
    theme: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"></circle><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"></path></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>'
  };

  var state = {
    ready: false,
    user: null,
    loadedFor: null,
    entries: [],
    goal: null,
    details: {},
    detailErr: {},
    detailLoading: {},
    route: { name: 'journal' },
    modal: null,
    ui: {
      editGoal: false,
      tonightMin: 90,
      tonight: null,
      lib: { type: 'all', status: 'seen', genre: '', sort: 'recent', q: '' },
      statsYear: new Date().getFullYear(),
      season: {},
      confirm: null,
      recovery: false,
      auth: { mode: 'login', msg: '', err: '', busy: false }
    }
  };

  /* ---------- Outils ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isoLocal(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function todayISO() { return isoLocal(new Date()); }
  function yesterdayISO() { var d = new Date(); d.setDate(d.getDate() - 1); return isoLocal(d); }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return parseInt(p[2], 10) + ' ' + MONTHS_LONG[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  function fmtShort(iso) { var p = iso.split('-'); return p[2] + '.' + p[1]; }
  function fmtDur(min) {
    if (!min) return '';
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' min';
    return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
  }
  function fmtNum(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }
  function hashCode(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

  /* ---------- Données ---------- */
  function key(type, id) { return type + '-' + id; }
  function findEntry(type, id) {
    for (var i = 0; i < state.entries.length; i++) {
      var e = state.entries[i];
      if (e.media_type === type && String(e.tmdb_id) === String(id)) return e;
    }
    return null;
  }
  function findById(id) {
    for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) return state.entries[i];
    return null;
  }
  function sortedSeasons(e) { return (e.seasons || []).slice().sort(function (a, b) { return a.n - b.n; }); }
  function totalEps(e) { return (e.seasons || []).reduce(function (s, x) { return s + (x.count || 0); }, 0); }
  function seenEps(e) { return Object.keys(e.episodes || {}).length; }
  function nextEp(e) {
    var ss = sortedSeasons(e);
    for (var i = 0; i < ss.length; i++) {
      for (var n = 1; n <= ss[i].count; n++) if (!e.episodes[ss[i].n + '-' + n]) return { s: ss[i].n, e: n };
    }
    return null;
  }
  function lastEpDate(e) {
    var max = '';
    Object.keys(e.episodes || {}).forEach(function (k) { if (e.episodes[k] > max) max = e.episodes[k]; });
    return max;
  }
  function lastActivity(e) {
    var max = lastEpDate(e);
    (e.viewings || []).forEach(function (v) { if (v.date > max) max = v.date; });
    return max;
  }
  function hasActivity(e) { return !!(e && ((e.viewings || []).length || seenEps(e))); }
  function computeStatus(e) {
    if (e.media_type === 'movie') return (e.viewings || []).length ? 'vu' : 'a_voir';
    var seen = seenEps(e), tot = totalEps(e);
    if (tot && seen >= tot) return 'vu';
    if (e.status === 'abandonne' && seen) return 'abandonne';
    if (!seen) return 'a_voir';
    return 'en_cours';
  }
  function normalizeEntry(e) {
    e.notes = e.notes || {};
    e.season_notes = e.season_notes || {};
    e.viewings = e.viewings || [];
    e.episodes = e.episodes || {};
    e.seasons = e.seasons || [];
    e.genres = e.genres || [];
    e.avis = e.avis || '';
    e.status = computeStatus(e);
    return e;
  }
  function newEntry(d) {
    return normalizeEntry({
      tmdb_id: d.tmdb_id, media_type: d.media_type, title: d.title, year: d.year || null,
      poster_path: d.poster_path || null, runtime: d.runtime || null, ep_runtime: d.ep_runtime || null,
      genres: (d.genres || []).slice(), director: d.director || '', seasons: (d.seasons || []).slice(),
      status: 'a_voir', notes: {}, season_notes: {}, per_season: false, avis: '', viewings: [], episodes: {}
    });
  }
  function refreshFromDetail(e, d) {
    if (!d) return e;
    if (d.seasons && d.seasons.length) e.seasons = d.seasons.slice();
    if (d.poster_path) e.poster_path = d.poster_path;
    if (d.runtime) e.runtime = d.runtime;
    if (d.ep_runtime) e.ep_runtime = d.ep_runtime;
    if (d.genres && d.genres.length) e.genres = d.genres.slice();
    if (d.director) e.director = d.director;
    return e;
  }
  function entryFor(type, id) {
    return findEntry(type, id) || (state.details[key(type, id)] ? newEntry(state.details[key(type, id)]) : null);
  }

  function persist(e) {
    e.status = computeStatus(e);
    return store.saveEntry(e).then(function (saved) {
      normalizeEntry(saved);
      var i = state.entries.findIndex(function (x) {
        return x.id === saved.id || (x.media_type === saved.media_type && String(x.tmdb_id) === String(saved.tmdb_id));
      });
      if (i >= 0) state.entries[i] = saved; else state.entries.push(saved);
      return saved;
    }).catch(function (err) {
      toast('Enregistrement impossible : ' + (err && err.message ? err.message : err), true);
      throw err;
    });
  }
  function removeEntry(e) {
    return store.deleteEntry(e.id).then(function () {
      state.entries = state.entries.filter(function (x) { return x.id !== e.id; });
    }).catch(function (err) {
      toast('Suppression impossible : ' + (err && err.message ? err.message : err), true);
      throw err;
    });
  }

  /* ---------- Affichage commun ---------- */
  var toastTimer;
  function toast(msg, isErr) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' toast--err' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3000);
  }

  function poster(e, opts) {
    opts = opts || {};
    var src = TMDB.img(e.poster_path, opts.thumb ? 'w92' : 'w342');
    var cls = 'poster poster--c' + (hashCode(String(e.title || '')) % 5) + (opts.thumb ? ' poster--thumb' : '');
    return '<span class="' + cls + '">' +
      (opts.tag ? '<span class="tag">' + esc(opts.tag) + '</span>' : '') +
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy">' : '<span class="poster__title">' + esc(e.title) + '</span>') +
      '</span>';
  }

  function header() {
    var r = state.route.name;
    function nav(h, label) {
      return '<a href="#' + h + '"' + (r === h ? ' aria-current="page"' : '') + '>' + label + '</a>';
    }
    return '<header class="top"><div class="wrap">' +
      '<a class="logo" href="#journal" aria-label="Séquence, retour au journal">.SÉQUENCE</a>' +
      '<nav class="nav" aria-label="Navigation principale">' +
      nav('journal', 'Journal') + nav('videotheque', 'Vidéothèque') + nav('a-voir', 'À voir') + nav('stats', 'Stats') +
      '</nav><div class="tools">' +
      '<button type="button" class="search-btn" data-act="open-search">' + ICON.search + '<span>Film, série, réalisateur</span></button>' +
      '<button type="button" class="btn btn--accent btn--small" data-act="open-add">J\'ai vu…</button>' +
      '<button type="button" class="icon-btn" data-act="theme" aria-label="Basculer entre mode clair et mode sombre">' + ICON.theme + '</button>' +
      (store.demo ? '' : '<button type="button" class="text-btn" data-act="logout">Déconnexion</button>') +
      '</div></div></header>' +
      (store.demo ? '<div class="demo-bar"><div class="wrap"><span><b>Mode démo.</b> Tes données restent dans ce navigateur. Renseigne config.js pour activer les comptes et la recherche TMDB.</span>' +
        '<button type="button" data-act="reset-demo">Remettre les exemples</button></div></div>' : '');
  }

  function footer() {
    return '<footer class="foot"><div class="wrap">' +
      '<span>.SÉQUENCE — ton journal privé de films et de séries</span>' +
      '<span>' + TMDB.creditHTML() + '</span>' +
      '</div></footer>';
  }

  function cells(act, k, val, label, main) {
    var h = '<div class="cells' + (main ? ' cells--main' : '') + '" role="group" aria-label="' + esc(label) + '">';
    for (var i = 1; i <= 5; i++) {
      h += '<button type="button" class="cell' + (i <= val ? ' is-on' : '') + '" data-act="' + act + '" data-k="' + esc(k) + '" data-v="' + i + '"' +
        ' aria-pressed="' + (i <= val) + '" aria-label="' + esc(label) + ' : ' + i + ' sur 5"></button>';
    }
    return h + '<span class="cells__val num">' + (val ? val + '/5' : '–') + '</span></div>';
  }

  function confirmBtn(what, label) {
    if (state.ui.confirm === what) {
      return '<span class="row__actions"><button type="button" class="danger danger--confirm" data-act="do-confirm" data-what="' + esc(what) + '">Confirmer</button>' +
        '<button type="button" class="danger" data-act="cancel-confirm">Annuler</button></span>';
    }
    return '<button type="button" class="danger" data-act="ask-confirm" data-what="' + esc(what) + '">' + esc(label || 'Supprimer') + '</button>';
  }

  /* ---------- Journal ---------- */
  function viewJournal() {
    var y = new Date().getFullYear();
    var es = state.entries;
    var now = new Date();
    var dateLabel = '.' + now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

    var films = 0;
    es.forEach(function (e) {
      if (e.media_type === 'movie') e.viewings.forEach(function (v) { if (v.date.slice(0, 4) === String(y)) films++; });
    });
    var goal = state.goal;
    var pct = goal ? Math.min(100, Math.round(films / goal * 100)) : 0;
    var dayOfYear = (Date.now() - new Date(y, 0, 1).getTime()) / 864e5;
    var expected = goal ? goal * dayOfYear / 365 : 0;
    var pace = !goal ? 'Fixe-toi un nombre de films à voir cette année.'
      : films >= goal ? 'Objectif atteint. Bravo !'
      : films >= expected ? 'Tu es en avance sur ton rythme.'
      : 'Encore ' + plural(goal - films, 'film', 'films') + ' pour y arriver.';

    var goalHTML = state.ui.editGoal
      ? '<form class="goal" data-form="goal"><label class="label" for="goal-in">Objectif de films en ' + y + '</label>' +
        '<span style="display:flex;gap:10px;flex-wrap:wrap"><input id="goal-in" type="number" min="1" max="999" value="' + (goal || 52) + '">' +
        '<button type="submit" class="btn btn--accent btn--small">Enregistrer</button></span></form>'
      : '<div class="goal"><span class="label">Objectif ' + y + '</span>' +
        '<span class="goal__num num">' + films + '<small> / ' + (goal || '—') + ' films</small></span>' +
        '<span class="bar"><span style="width:' + pct + '%"></span></span>' +
        '<span>' + esc(pace) + '</span>' +
        '<button type="button" class="text-link" data-act="edit-goal">' + (goal ? 'Modifier l\'objectif' : 'Fixer un objectif') + '</button></div>';

    var hero = '<section class="hero"><div class="hero__title"><span class="eyebrow">' + esc(dateLabel) + '</span>' +
      '<h1 class="h1 display">.Mon<br>journal</h1></div>' + goalHTML + '</section>';

    if (!es.length) {
      return '<div class="stack">' + hero + '<div class="empty"><span class="h2 display">.Ton journal est vide</span>' +
        '<p style="margin:0;max-width:60ch">Commence par le dernier film ou la dernière série que tu as regardés. Tu pourras les noter et suivre tes épisodes.</p>' +
        '<button type="button" class="btn btn--accent" data-act="open-add">J\'ai vu…</button></div></div>';
    }

    var enCours = es.filter(function (e) { return e.status === 'en_cours'; })
      .sort(function (a, b) { return lastActivity(b).localeCompare(lastActivity(a)); });
    var enCoursHTML = enCours.length ? '<div class="grid-2">' + enCours.map(function (e) {
      var n = nextEp(e), tot = totalEps(e), seen = seenEps(e);
      return '<div class="card">' + poster(e, { thumb: true }) + '<div class="card__body">' +
        '<a class="card__title" href="#fiche-tv-' + e.tmdb_id + '">' + esc(e.title) + '</a>' +
        '<span>' + (n ? 'Saison ' + n.s + ' · prochain : épisode ' + n.e : 'Tout est vu') + '</span>' +
        '<span class="bar"><span style="width:' + (tot ? Math.round(seen / tot * 100) : 0) + '%"></span></span>' +
        '<span class="label num">' + seen + ' / ' + tot + ' épisodes</span>' +
        (n ? '<span><button type="button" class="btn btn--ink btn--small" data-act="quick-ep" data-id="' + esc(e.id) + '">J\'ai vu S' + n.s + ' · É' + n.e + '</button></span>' : '') +
        '</div></div>';
    }).join('') + '</div>' : '<p class="muted" style="margin:0">Aucune série en cours.</p>';

    var recent = [];
    es.forEach(function (e) {
      if (e.media_type === 'movie') e.viewings.forEach(function (v) { recent.push({ e: e, date: v.date, tag: v.rewatch ? 'Revu' : 'Film' }); });
      else { var d = lastEpDate(e); if (d) recent.push({ e: e, date: d, tag: 'Série' }); }
    });
    recent.sort(function (a, b) { return b.date.localeCompare(a.date); });
    recent = recent.slice(0, 10);
    var recentHTML = recent.length ? '<div class="posters">' + recent.map(function (r) { return tile(r.e, r.tag, fmtShort(r.date)); }).join('') + '</div>'
      : '<p class="muted" style="margin:0">Rien de vu pour l\'instant.</p>';

    var aVoir = es.filter(function (e) { return e.status === 'a_voir'; })
      .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    var aVoirHTML = aVoir.length ? '<div class="chips">' + aVoir.slice(0, 8).map(function (e) {
      var extra = e.media_type === 'movie' ? (e.runtime ? ' · ' + fmtDur(e.runtime) : '') : ' · série';
      return '<a class="chip" href="#fiche-' + e.media_type + '-' + e.tmdb_id + '">' + esc(e.title) + esc(extra) + '</a>';
    }).join('') + '</div>' : '<p class="muted" style="margin:0">Ta liste est vide. Ajoute des titres depuis leur fiche.</p>';

    var t = state.ui.tonight, tonightRes = '';
    if (t && t.none) tonightRes = '<div class="tonight__result">Aucun film de ta liste ne tient en ' + t.min + ' min.</div>';
    else if (t && t.id) {
      var te = findById(t.id);
      if (te) tonightRes = '<div class="tonight__result"><span class="label">Ce soir</span><a href="#fiche-movie-' + te.tmdb_id + '">' + esc(te.title) + '</a><span>' + fmtDur(te.runtime) + '</span></div>';
    }

    return '<div class="stack">' + hero +
      '<section class="section"><h2 class="h2 display">.En cours</h2>' + enCoursHTML + '</section>' +
      '<section class="section"><div class="section-head"><h2 class="h2 display">.Vu récemment</h2><a class="link" href="#videotheque">Toute la vidéothèque</a></div>' + recentHTML + '</section>' +
      '<section class="watch-row"><div class="watch-row__list"><div class="section-head"><h2 class="h2 display">.À voir <span class="label muted">' + aVoir.length + ' dans ta liste</span></h2>' +
      '<a class="link" href="#a-voir">Toute la liste</a></div>' + aVoirHTML + '</div>' +
      '<form class="tonight" data-form="tonight"><span class="display">Ce soir j\'ai…</span>' +
      '<label for="tonight-min"><input id="tonight-min" type="number" min="20" max="400" step="5" value="' + state.ui.tonightMin + '"> minutes devant moi</label>' +
      '<span><button type="submit" class="btn btn--small">Suggère-moi un film</button></span>' + tonightRes + '</form></section>' +
      '</div>';
  }

  function tile(e, tag, meta) {
    var note = e.notes && e.notes.gen ? e.notes.gen + '/5' : '';
    var hasImg = !!TMDB.img(e.poster_path);
    return '<a class="tile" href="#fiche-' + e.media_type + '-' + e.tmdb_id + '">' + poster(e, { tag: tag }) +
      (hasImg ? '<span style="font-weight:700;font-size:14px;line-height:1.3">' + esc(e.title) + '</span>' : '') +
      '<span class="tile__meta num"><span>' + esc(meta || '') + '</span><span class="tile__note">' + note + '</span></span></a>';
  }

  /* ---------- Vidéothèque ---------- */
  function libFiltered() {
    var f = state.ui.lib;
    var q = f.q.trim().toLowerCase();
    var list = state.entries.filter(function (e) {
      if (f.type !== 'all' && e.media_type !== f.type) return false;
      if (f.status === 'seen' && !hasActivity(e)) return false;
      if (f.status !== 'seen' && f.status !== 'all' && e.status !== f.status) return false;
      if (f.genre && e.genres.indexOf(f.genre) === -1) return false;
      if (q && (e.title + ' ' + e.director).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (f.sort === 'note') return (b.notes.gen || 0) - (a.notes.gen || 0) || a.title.localeCompare(b.title, 'fr');
      if (f.sort === 'title') return a.title.localeCompare(b.title, 'fr');
      if (f.sort === 'year') return (b.year || 0) - (a.year || 0);
      return lastActivity(b).localeCompare(lastActivity(a));
    });
    return list;
  }
  function libGrid() {
    var list = libFiltered();
    if (!list.length) return '<div class="empty"><span class="h3 display">Aucun titre ne correspond</span><span>Change les filtres ou ajoute un titre avec « J\'ai vu… ».</span></div>';
    return '<p class="label" style="margin:0 0 14px">' + plural(list.length, 'titre', 'titres') + '</p><div class="posters">' + list.map(function (e) {
      var tag = e.media_type === 'movie' ? 'Film' : (e.status === 'en_cours' ? 'En cours' : e.status === 'abandonne' ? 'Abandonnée' : 'Série');
      var last = lastActivity(e);
      return tile(e, tag, last ? fmtShort(last) + '.' + last.slice(2, 4) : (e.year || ''));
    }).join('') + '</div>';
  }
  function viewLibrary() {
    var f = state.ui.lib;
    var genres = {};
    state.entries.forEach(function (e) { e.genres.forEach(function (g) { genres[g] = 1; }); });
    function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    return '<div class="stack"><div class="section"><span class="eyebrow">.Tout ce que tu as vu</span><h1 class="h1 display">.Vidéo&shy;thèque</h1></div>' +
      '<div class="filters">' +
      '<div class="field"><label class="label" for="lib-type">Type</label><select id="lib-type" data-lib="type">' +
      opt('all', 'Films et séries', f.type) + opt('movie', 'Films', f.type) + opt('tv', 'Séries', f.type) + '</select></div>' +
      '<div class="field"><label class="label" for="lib-status">Statut</label><select id="lib-status" data-lib="status">' +
      opt('seen', 'Tout ce que j\'ai vu', f.status) + opt('vu', 'Terminés', f.status) + opt('en_cours', 'En cours', f.status) +
      opt('abandonne', 'Abandonnés', f.status) + opt('all', 'Tout, même À voir', f.status) + '</select></div>' +
      '<div class="field"><label class="label" for="lib-genre">Genre</label><select id="lib-genre" data-lib="genre">' + opt('', 'Tous les genres', f.genre) +
      Object.keys(genres).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).map(function (g) { return opt(g, g, f.genre); }).join('') + '</select></div>' +
      '<div class="field"><label class="label" for="lib-sort">Trier par</label><select id="lib-sort" data-lib="sort">' +
      opt('recent', 'Vus récemment', f.sort) + opt('note', 'Mieux notés', f.sort) + opt('title', 'Titre', f.sort) + opt('year', 'Année de sortie', f.sort) + '</select></div>' +
      '<div class="field field--grow"><label class="label" for="lib-q">Chercher dans ma vidéothèque</label><input id="lib-q" type="search" data-lib="q" value="' + esc(f.q) + '" placeholder="Titre ou réalisateur"></div>' +
      '</div><div id="lib-grid">' + libGrid() + '</div></div>';
  }

  /* ---------- À voir ---------- */
  function viewToWatch() {
    var list = state.entries.filter(function (e) { return e.status === 'a_voir'; })
      .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    var rows = list.length ? '<div class="rows">' + list.map(function (e) {
      var meta = [e.media_type === 'movie' ? 'Film' : 'Série', e.year, e.media_type === 'movie' ? fmtDur(e.runtime) : plural(e.seasons.length, 'saison', 'saisons'), e.genres.slice(0, 2).join(', ')]
        .filter(Boolean).join(' · ');
      return '<div class="row"><a class="row__main" href="#fiche-' + e.media_type + '-' + e.tmdb_id + '">' + poster(e, { thumb: true }) +
        '<span style="min-width:0;display:flex;flex-direction:column;gap:4px"><span class="row__title">' + esc(e.title) + '</span><span class="muted">' + esc(meta) + '</span></span></a>' +
        '<div class="row__actions"><button type="button" class="btn btn--accent btn--small" data-act="seen-this" data-type="' + e.media_type + '" data-id="' + e.tmdb_id + '">J\'ai vu</button>' +
        confirmBtn('entry:' + e.id, 'Retirer') + '</div></div>';
    }).join('') + '</div>'
      : '<div class="empty"><span class="h3 display">Ta liste est vide</span><span>Ajoute les films et séries que tu veux voir plus tard.</span></div>';
    return '<div class="stack"><div class="section-head"><div class="section"><span class="eyebrow">.' + plural(list.length, 'titre', 'titres') + ' en attente</span>' +
      '<h1 class="h1 display">.À voir</h1></div><button type="button" class="btn btn--ink" data-act="open-towatch">Ajouter à la liste</button></div>' + rows + '</div>';
  }

  /* ---------- Stats ---------- */
  function viewStats() {
    var y = String(state.ui.statsYear);
    var years = {};
    years[new Date().getFullYear()] = 1;
    var movieViews = [], epCount = 0, epMin = 0, active = {}, months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    state.entries.forEach(function (e) {
      e.viewings.forEach(function (v) {
        years[v.date.slice(0, 4)] = 1;
        if (v.date.slice(0, 4) === y) { movieViews.push({ e: e, v: v }); active[e.id] = e; months[parseInt(v.date.slice(5, 7), 10) - 1]++; }
      });
      Object.keys(e.episodes).forEach(function (k) {
        var d = e.episodes[k];
        years[d.slice(0, 4)] = 1;
        if (d.slice(0, 4) === y) { epCount++; epMin += e.ep_runtime || 45; active[e.id] = e; }
      });
    });
    var filmMin = movieViews.reduce(function (s, x) { return s + (x.e.runtime || 0); }, 0);
    var hours = Math.round((filmMin + epMin) / 60);
    var actives = Object.keys(active).map(function (k) { return active[k]; });
    var noted = actives.filter(function (e) { return e.notes.gen; });
    var avg = noted.length ? noted.reduce(function (s, e) { return s + e.notes.gen; }, 0) / noted.length : 0;

    var yearOpts = Object.keys(years).sort().reverse().map(function (yy) {
      return '<option value="' + yy + '"' + (yy === y ? ' selected' : '') + '>' + yy + '</option>';
    }).join('');
    var head = '<div class="section-head"><h1 class="h1 display">.Mon année <span style="color:var(--accent-text)">' + esc(y) + '</span></h1>' +
      '<div class="field"><label class="label" for="stats-year">Année</label><select id="stats-year" data-change="stats-year">' + yearOpts + '</select></div></div>';

    if (!actives.length) {
      return '<div class="stack">' + head + '<div class="empty"><span class="h3 display">Rien de vu en ' + esc(y) + '</span><span>Tes chiffres apparaîtront ici dès ton premier visionnage.</span></div></div>';
    }

    var kpis = '<div class="kpis">' +
      '<div class="kpi"><span class="label">Films vus</span><span class="kpi__v num">' + movieViews.length + '</span></div>' +
      '<div class="kpi"><span class="label">Épisodes vus</span><span class="kpi__v num">' + epCount + '</span></div>' +
      '<div class="kpi"><span class="label">Devant l\'écran</span><span class="kpi__v num">≈ ' + hours + ' h</span></div>' +
      '<div class="kpi kpi--accent"><span class="label">Note moyenne</span><span class="kpi__v num">' + (avg ? fmtNum(avg) : '–') + '</span></div></div>';

    var max = Math.max.apply(null, months.concat([1]));
    var maxMonth = months.indexOf(max);
    var curY = String(new Date().getFullYear()), curM = new Date().getMonth();
    var monthsHTML = '<div class="months-wrap"><div class="months" role="img" aria-label="Films vus par mois en ' + esc(y) + ' : ' +
      months.map(function (v, i) { return MONTHS_LONG[i] + ' ' + v; }).join(', ') + '">' +
      months.map(function (v, i) {
        var future = y === curY && i > curM;
        return '<div class="month"><span class="month__v num">' + (future ? '' : v) + '</span>' +
          '<span class="month__bar' + (v === max && v > 0 && i === maxMonth ? ' month__bar--top' : '') + '" style="height:' + (future ? 3 : Math.max(3, Math.round(v / max * 160))) + 'px' + (future ? ';background:var(--sand)' : '') + '"></span>' +
          '<span class="label">' + MONTHS[i] + '</span></div>';
      }).join('') + '</div></div>';

    var genres = {};
    actives.forEach(function (e) { e.genres.forEach(function (g) { genres[g] = (genres[g] || 0) + 1; }); });
    var topG = Object.keys(genres).map(function (g) { return [g, genres[g]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
    var gMax = topG.length ? topG[0][1] : 1;
    var genresHTML = topG.map(function (g) {
      return '<div style="display:flex;flex-direction:column;gap:4px"><span class="stat-line"><span>' + esc(g[0]) + '</span><span class="num">' + g[1] + '</span></span>' +
        '<span class="bar"><span style="width:' + Math.round(g[1] / gMax * 100) + '%"></span></span></div>';
    }).join('') || '<span class="muted">Pas encore de genres.</span>';

    var lieux = {};
    movieViews.forEach(function (x) { var l = x.v.lieu || 'Autre'; lieux[l] = (lieux[l] || 0) + 1; });
    var lieuList = LIEUX.concat(['Autre']).filter(function (l) { return lieux[l]; });
    var splitHTML = movieViews.length ? '<div class="split" aria-hidden="true">' + lieuList.map(function (l) {
      return '<span style="width:' + (lieux[l] / movieViews.length * 100) + '%"></span>';
    }).join('') + '</div><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">' +
      lieuList.map(function (l, i) {
        var colors = ['var(--accent)', 'var(--fg)', 'var(--sand)', 'var(--soft)', 'var(--paper)'];
        return '<li class="stat-line"><span><span class="dot" style="background:' + colors[i] + '"></span>' + esc(l) + '</span><span class="num">' + lieux[l] + '</span></li>';
      }).join('') + '</ul>' : '<span class="muted">Aucun film vu cette année.</span>';

    var dirs = {};
    movieViews.forEach(function (x) {
      if (!x.e.director) return;
      dirs[x.e.director] = dirs[x.e.director] || {};
      dirs[x.e.director][x.e.id] = 1;
    });
    var topD = Object.keys(dirs).map(function (d) { return [d, Object.keys(dirs[d]).length]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
    var rewatch = movieViews.filter(function (x) { return x.v.rewatch; }).length;
    var dirsHTML = topD.map(function (d) {
      return '<li class="stat-line" style="align-items:baseline"><span class="display" style="font-size:24px">' + esc(d[0]) + '</span><span class="num" style="font-weight:700;color:var(--nav-active)">' + plural(d[1], 'film', 'films') + '</span></li>';
    }).join('') || '<li>Pas encore de films.</li>';

    return '<div class="stack">' + head + kpis +
      '<section class="panel"><div class="section-head"><h2 class="h2 display">.Films par mois</h2>' +
      (max > 0 && movieViews.length ? '<span class="label">Record : ' + MONTHS_LONG[maxMonth] + ' (' + max + ')</span>' : '') + '</div>' + monthsHTML + '</section>' +
      '<div class="stat-cols">' +
      '<section class="stat-box"><h2 class="h3 display">.Genres</h2>' + genresHTML + '</section>' +
      '<section class="stat-box"><h2 class="h3 display">.Où je regarde mes films</h2>' + splitHTML + '</section>' +
      '<section class="stat-box stat-box--ink"><h2 class="h3 display">.Réalisateurs</h2><ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">' + dirsHTML + '</ol>' +
      '<span style="margin-top:auto">' + plural(rewatch, 'revisionnage', 'revisionnages') + ' cette année</span></section>' +
      '</div></div>';
  }

  /* ---------- Fiche ---------- */
  function loadDetail(type, id) {
    var k = key(type, id);
    if (state.detailLoading[k]) return;
    state.detailLoading[k] = true;
    TMDB.details(type, id).then(function (d) {
      state.details[k] = d;
      if (!d.recommendations) {
        TMDB.recommend(d).then(function (list) { d.recommendations = list || []; render(); });
      }
      var e = findEntry(type, id);
      if (e && type === 'tv' && d.seasons.length && JSON.stringify(e.seasons) !== JSON.stringify(d.seasons)) {
        refreshFromDetail(e, d);
        persist(e).then(render).catch(function () {});
      }
      render();
    }).catch(function (err) {
      state.detailErr[k] = err && err.message ? err.message : String(err);
      render();
    }).then(function () { state.detailLoading[k] = false; });
  }

  function viewFiche(type, id) {
    var k = key(type, id);
    var d = state.details[k];
    var e = findEntry(type, id);
    var manual = isManualId(id);
    if (!manual && !d && !state.detailErr[k]) loadDetail(type, id);
    var info = d || e;
    if (!info) {
      if (state.detailErr[k] || manual) {
        return '<div class="empty"><span class="h2 display">.Titre introuvable</span><p style="margin:0">' + esc(state.detailErr[k] || 'Ce titre n\'est plus dans ton journal.') + '</p>' +
          '<a class="btn" href="#journal">Retour au journal</a></div>';
      }
      return '<div class="loading">Chargement…</div>';
    }
    var isTv = type === 'tv';
    var act = hasActivity(e);
    var meta = [isTv ? 'Série' : 'Film', info.year, (info.genres || []).slice(0, 2).join(', '),
      isTv ? plural((info.seasons || []).length, 'saison', 'saisons') : fmtDur(info.runtime)].filter(Boolean).join(' · ');

    var side = '<aside class="fiche__side">' + poster(info) + '<div class="side-actions">' +
      '<button type="button" class="btn btn--accent" data-act="seen-this" data-type="' + type + '" data-id="' + esc(id) + '">' + (isTv ? 'J\'ai vu des épisodes' : 'J\'ai vu ce film') + '</button>';
    if (!e) side += '<button type="button" class="btn" data-act="add-towatch" data-type="' + type + '" data-id="' + esc(id) + '">+ À voir</button>';
    else if (!act) side += '<span class="tag" style="align-self:flex-start;border:2px solid var(--line)">Dans ta liste À voir</span>' + confirmBtn('entry:' + e.id, 'Retirer de À voir');
    if (isTv && e && act && e.status !== 'vu') {
      side += '<button type="button" class="btn" data-act="abandon" data-id="' + esc(e.id) + '">' + (e.status === 'abandonne' ? 'Reprendre la série' : 'J\'abandonne') + '</button>';
    }
    if (manual && e) side += '<button type="button" class="btn" data-act="edit-manual" data-id="' + esc(e.id) + '">Modifier les infos</button>';
    side += '</div></aside>';

    var main = '<div class="section"><span class="label">' + esc(meta) + (e ? ' · ' + esc(STATUS_LABEL[e.status]) : '') + (manual ? ' · Ajouté à la main' : '') + '</span>' +
      '<h1 class="fiche__title display">.' + esc(info.title) + '</h1>' +
      (info.director ? '<span>' + (isTv ? 'Créée par ' : 'Réalisé par ') + '<b>' + esc(info.director) + '</b></span>' : '') +
      (d && d.overview ? '<p class="overview">' + esc(d.overview) + '</p>' : '') +
      '<span>' + googleLink(info.title + (info.year ? ' ' + info.year : ''), type) + '</span></div>';

    if (e && act) {
      if (!isTv) {
        var vs = e.viewings.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
        var last = vs[0];
        main += '<div class="facts">' +
          '<div><span class="label">Vu le</span><span>' + esc(fmtDate(last.date)) + '</span></div>' +
          '<div><span class="label">Où</span><span>' + esc(last.lieu) + ' · ' + esc(last.version) + '</span></div>' +
          '<div><span class="label">Avec</span><span>' + esc(last.avec || 'Seul·e') + '</span></div>' +
          '<div><span class="label">Visionnages</span><span>' + (vs.length === 1 ? '1re fois' : vs.length + ' fois') + '</span></div></div>';
      } else {
        var tot = totalEps(e), seen = seenEps(e);
        main += '<div class="facts">' +
          '<div><span class="label">Progression</span><span class="num">' + seen + ' / ' + tot + ' épisodes</span></div>' +
          '<div><span class="label">Dernier épisode</span><span>' + esc(fmtDate(lastEpDate(e))) + '</span></div>' +
          '<div><span class="label">Statut</span><span>' + esc(STATUS_LABEL[e.status]) + '</span></div></div>';
      }

      var notes = '<section class="panel"><div class="section-head"><h2 class="h2 display">.Ma note</h2><span class="label muted">Clique sur les cases</span></div>';
      if (!isTv) {
        CRITERIA.forEach(function (c, i) {
          notes += '<div class="note-row' + (i === 0 ? ' note-row--main' : '') + '"><span class="note-row__label">' + c[1] + '</span>' +
            cells('note', c[0], e.notes[c[0]] || 0, c[1], i === 0) + '</div>';
        });
      } else {
        notes += '<div class="note-row note-row--main"><span class="note-row__label">Note de la série</span>' + cells('note', 'gen', e.notes.gen || 0, 'Note de la série', true) + '</div>' +
          '<label class="check"><input type="checkbox" data-change="per-season"' + (e.per_season ? ' checked' : '') + '><span>Noter aussi chaque saison <span class="muted">(optionnel)</span></span></label>';
        if (e.per_season) {
          sortedSeasons(e).forEach(function (s) {
            notes += '<div class="note-row"><span class="note-row__label">Saison ' + s.n + '</span>' + cells('snote', String(s.n), e.season_notes[s.n] || 0, 'Saison ' + s.n, false) + '</div>';
          });
        }
      }
      main += notes + '</section>';
    } else if (!e || !act) {
      main += '<div class="empty"><span class="h3 display">' + (isTv ? 'Pas encore d\'épisode vu' : 'Pas encore vu') + '</span>' +
        '<span>Ajoute un visionnage pour pouvoir le noter et écrire ton avis.</span></div>';
    }

    if (e && act) {
      main += '<section class="section field"><label class="h2 display" for="avis">.Mon avis</label>' +
        '<textarea id="avis" data-input="avis" data-id="' + esc(e.id) + '" rows="4" placeholder="Ce que tu en as pensé, une scène, une réplique…">' + esc(e.avis) + '</textarea>' +
        '<span class="saved" id="avis-state" role="status">Privé : visible par toi seul.</span></section>';
    }

    var seasonsSrc = (d && d.seasons && d.seasons.length) ? d.seasons : (e ? e.seasons : []);
    if (isTv && seasonsSrc.length) {
      var ent = e || newEntry(info);
      if (!ent.seasons.length) ent.seasons = seasonsSrc.slice();
      var ss = seasonsSrc.slice().sort(function (a, b) { return a.n - b.n; });
      var n = nextEp(ent);
      var sel = state.ui.season[k] || (n ? n.s : ss[0].n);
      var cur = ss.filter(function (s) { return s.n === sel; })[0] || ss[0];
      var totE = totalEps(ent), seenE = seenEps(ent);
      var allSeen = true;
      for (var i = 1; i <= cur.count; i++) if (!ent.episodes[cur.n + '-' + i]) allSeen = false;
      var epsHTML = '';
      for (var j = 1; j <= cur.count; j++) {
        var date = ent.episodes[cur.n + '-' + j];
        var isNext = n && n.s === cur.n && n.e === j;
        epsHTML += '<li><button type="button" class="ep' + (isNext ? ' ep--next' : '') + '" data-act="ep" data-type="tv" data-id="' + esc(id) + '" data-s="' + cur.n + '" data-e="' + j + '" aria-pressed="' + !!date + '"' +
          ' aria-label="Saison ' + cur.n + ', épisode ' + j + (date ? ', vu le ' + fmtDate(date) : '') + '">' +
          '<span>É' + j + '</span><span style="font-size:12px">' + (date ? fmtShort(date) : (isNext ? 'à suivre' : '')) + '</span></button></li>';
      }
      main += '<section class="section"><div class="section-head"><h2 class="h2 display">.Épisodes</h2><span class="label num">' + seenE + ' / ' + totE + ' vus</span></div>' +
        '<span class="bar"><span style="width:' + (totE ? Math.round(seenE / totE * 100) : 0) + '%"></span></span>' +
        (n ? '<span><button type="button" class="btn btn--accent" data-act="next-ep" data-type="tv" data-id="' + esc(id) + '">J\'ai vu S' + n.s + ' · É' + n.e + '</button></span>' : '<p style="margin:0" class="label">Série terminée</p>') +
        '<div class="tabs" role="tablist" aria-label="Saisons">' + ss.map(function (s) {
          return '<button type="button" role="tab" aria-selected="' + (s.n === cur.n) + '" data-act="season" data-k="' + k + '" data-s="' + s.n + '">Saison ' + s.n + '</button>';
        }).join('') + '</div>' +
        '<ul class="eps">' + epsHTML + '</ul>' +
        '<span><button type="button" class="chip" data-act="season-all" data-type="tv" data-id="' + esc(id) + '" data-s="' + cur.n + '">' + (allSeen ? 'Décocher la saison ' + cur.n : 'Toute la saison ' + cur.n + ' est vue') + '</button></span></section>';
    }

    if (e && !isTv && e.viewings.length) {
      main += '<section class="section"><h2 class="h2 display">.Mes visionnages</h2><ul class="history">' +
        e.viewings.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).map(function (v) {
          return '<li><span><b>' + esc(fmtDate(v.date)) + '</b> · ' + esc(v.lieu) + ' · ' + esc(v.version) + (v.avec ? ' · avec ' + esc(v.avec) : '') + (v.rewatch ? ' · revisionnage' : '') + '</span>' +
            confirmBtn('viewing:' + e.id + ':' + v.id, 'Supprimer') + '</li>';
        }).join('') + '</ul></section>';
    }

    var recoLoading = !!(d && d.recommendations === null);
    var recos = ((d && d.recommendations) || []).slice(0, 6);
    // Compléter avec les titres de la liste À voir qui partagent un genre
    var myGenres = info.genres || [];
    if (recos.length < 6 && myGenres.length) {
      state.entries.filter(function (x) {
        return x.status === 'a_voir' && !(x.media_type === type && String(x.tmdb_id) === String(id)) &&
          x.genres.some(function (g) { return myGenres.indexOf(g) !== -1; }) &&
          !recos.some(function (r) { return r.media_type === x.media_type && String(r.tmdb_id) === String(x.tmdb_id); });
      }).slice(0, 6 - recos.length).forEach(function (x) {
        var common = x.genres.filter(function (g) { return myGenres.indexOf(g) !== -1; })[0];
        recos.push({ tmdb_id: x.tmdb_id, media_type: x.media_type, title: x.title, year: x.year, reason: 'Dans ta liste · ' + common });
      });
    }
    if (recos.length || recoLoading) {
      main += '<section class="section"><h2 class="h2 display">.Si tu as aimé</h2>' +
        (recoLoading ? '<p class="label muted" style="margin:0">Recherche de titres proches…</p>' : '') +
        (recos.length ? '<div class="recos">' + recos.map(function (r) {
          var mine = findEntry(r.media_type, r.tmdb_id);
          var status = mine ? (hasActivity(mine) ? 'déjà vu' : 'dans ta liste') : '';
          return '<a class="reco" href="#fiche-' + r.media_type + '-' + r.tmdb_id + '">' +
            (r.reason ? '<span class="label">' + esc(r.reason) + '</span>' : '') +
            '<span class="display">' + esc(r.title) + '</span><span style="font-size:13px">' +
            esc([r.media_type === 'tv' ? 'Série' : 'Film', r.year, r.reason && r.reason.indexOf('Dans ta liste') === 0 ? '' : status].filter(Boolean).join(' · ')) + '</span></a>';
        }).join('') + '</div>' : '') + '</section>';
    }

    if (e && act) {
      main += '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-top:8px;border-top:2px solid var(--line)"><span class="muted" style="font-size:14px">Retirer ce titre et tout son historique :</span>' +
        confirmBtn('entry:' + e.id, 'Supprimer de mon journal') + '</div>';
    }

    return '<div class="fiche">' + side + '<div class="fiche__main">' + main + '</div></div>';
  }

  /* ---------- Fenêtre d'ajout / recherche ---------- */
  function openModal(mode, preset) {
    state.modal = { mode: mode, step: 'search', q: '', results: [], loading: false, err: '', detail: null, form: null, manual: null, focus: true };
    render();
    if (preset) pick(preset.type, preset.id);
  }
  function closeModal() { state.modal = null; render(); }

  /* Titres ajoutés à la main : identifiant négatif, jamais utilisé par TMDB */
  function isManualId(id) { return Number(id) < 0; }
  function newManualId() { return -(Math.floor(Math.random() * 2000000000) + 1); }

  function startForm(m, d) {
    var e = findEntry(d.media_type, d.tmdb_id);
    var ss = (d.seasons || []).slice().sort(function (a, b) { return a.n - b.n; });
    var n = e ? nextEp(refreshFromDetail(e, d)) : (ss.length ? { s: ss[0].n, e: 1 } : null);
    m.detail = d;
    m.loading = false;
    m.step = 'form';
    m.err = '';
    m.form = {
      when: 'today', date: todayISO(), lieu: 'Streaming', version: 'VO', avec: '',
      note: e && e.notes.gen ? e.notes.gen : 0, rewatch: !!(e && e.viewings.length),
      season: n ? n.s : (ss[0] ? ss[0].n : 1), ep: n ? n.e : 1
    };
    render();
  }

  function pick(type, id) {
    var m = state.modal;
    if (!m) return;
    if (m.mode === 'search') { state.modal = null; go('fiche-' + type + '-' + id); return; }
    if (isManualId(id)) {
      var me = findEntry(type, id);
      if (me) startForm(m, Object.assign({ overview: '', recommendations: [] }, me));
      return;
    }
    m.loading = true;
    m.step = 'form';
    render();
    TMDB.details(type, id).then(function (d) {
      if (state.modal !== m) return;
      state.details[key(type, id)] = d;
      startForm(m, d);
    }).catch(function (err) {
      if (state.modal !== m) return;
      m.loading = false;
      m.step = 'search';
      m.err = err && err.message ? err.message : String(err);
      render();
    });
  }

  function resultsHTML() {
    var m = state.modal;
    var g = googleLink(m.q);
    var manualBtn = '<span style="display:flex;flex-wrap:wrap;gap:4px 20px;align-items:center">' +
      '<button type="button" class="linkish" data-act="m-manual">Il n\'est pas dans la liste ? Ajoute-le à la main</button>' + g + '</span>';
    var demoNote = '';
    if (m.loading) return '<p class="label">Recherche…</p>';
    if (m.err) return '<p class="msg msg--err">' + esc(m.err) + '</p>' + manualBtn;
    if (!m.q.trim()) {
      return '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<p class="muted" style="margin:0">' + esc(TMDB.hint()) + '</p>' + manualBtn + '</div>';
    }
    var q = m.q.trim().toLowerCase();
    var local = state.entries.filter(function (e) { return isManualId(e.tmdb_id) && e.title.toLowerCase().indexOf(q) !== -1; })
      .map(function (e) { return { tmdb_id: e.tmdb_id, media_type: e.media_type, title: e.title, year: e.year, poster_path: null }; });
    var all = local.concat(m.results);
    if (!all.length) {
      return '<div style="display:flex;flex-direction:column;gap:12px">' + demoNote + '<p style="margin:0">Aucun résultat pour « ' + esc(m.q) + ' ».</p>' +
        '<span style="display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center"><button type="button" class="btn btn--ink" data-act="m-manual">Ajouter « ' + esc(m.q.trim()) + ' » à la main</button>' + g + '</span></div>';
    }
    return demoNote + '<ul class="results" style="margin-top:' + (demoNote ? '12px' : '0') + '">' + all.map(function (r) {
      var mine = findEntry(r.media_type, r.tmdb_id);
      return '<li><button type="button" class="result" data-act="m-pick" data-type="' + r.media_type + '" data-id="' + r.tmdb_id + '">' + poster(r, { thumb: true }) +
        '<span style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="result__title">' + esc(r.title) + '</span>' +
        '<span class="label">' + (r.media_type === 'tv' ? 'Série' : 'Film') + (r.year ? ' · ' + r.year : '') + (isManualId(r.tmdb_id) ? ' · ajouté à la main' : '') +
        (mine ? ' · ' + (hasActivity(mine) ? 'déjà vu' : 'dans ta liste') : '') + '</span></span></button></li>';
    }).join('') + '</ul><div style="margin-top:12px">' + manualBtn + '</div>';
  }

  function googleLink(q, kind) {
    q = String(q || '').trim();
    if (!q) return '';
    var url = 'https://www.google.com/search?q=' + encodeURIComponent(q + (kind === 'tv' ? ' série' : kind === 'movie' ? ' film' : ''));
    return '<a class="link" href="' + esc(url) + '" target="_blank" rel="noopener">Chercher « ' + esc(q) + ' » sur Google ↗</a>';
  }

  function manualHTML() {
    var m = state.modal, mm = m.manual, isTv = mm.type === 'tv';
    function field(k, label, type, extra) {
      return '<div class="field"><label class="label" for="mf-' + k + '">' + label + '</label>' +
        '<input id="mf-' + k + '" type="' + (type || 'text') + '" data-input="mf" data-k="' + k + '" value="' + esc(mm[k]) + '"' + (extra || '') + '></div>';
    }
    var h = '<form data-form="manual" novalidate style="display:flex;flex-direction:column;gap:16px">';
    if (m.mode !== 'edit') {
      h += '<div class="field"><span class="label" id="lbl-mf-type">Type</span><div class="chips" role="group" aria-labelledby="lbl-mf-type">' +
        '<button type="button" class="chip" data-act="mf-type" data-v="movie" aria-pressed="' + !isTv + '">Film</button>' +
        '<button type="button" class="chip" data-act="mf-type" data-v="tv" aria-pressed="' + isTv + '">Série</button></div></div>';
    }
    h += field('title', 'Titre', 'text', ' maxlength="200" required');
    h += '<div style="display:flex;flex-wrap:wrap;gap:12px"><div style="flex:1 1 140px">' + field('year', 'Année de sortie', 'number', ' min="1880" max="2100"') + '</div>' +
      '<div style="flex:1 1 180px">' + field('runtime', isTv ? 'Durée d\'un épisode (min)' : 'Durée (min)', 'number', ' min="1" max="999"') + '</div></div>';
    if (isTv) {
      h += field('eps', 'Nombre d\'épisodes par saison', 'text', ' placeholder="ex. 8, 10, 10"') +
        '<span class="muted" style="font-size:14px;margin-top:-8px">Un nombre par saison, séparés par des virgules.</span>';
    }
    h += field('director', isTv ? 'Créée par' : 'Réalisé par', 'text', ' maxlength="200"');
    h += field('genres', 'Genres', 'text', ' placeholder="ex. Drame, Comédie" maxlength="200"');
    if (mm.title) h += '<span style="font-size:14px">Un doute sur l\'année ou la durée ? ' + googleLink(mm.title, mm.type) + '</span>';
    if (m.err) h += '<p class="msg msg--err" role="alert" style="margin:0">' + esc(m.err) + '</p>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end">' +
      (m.mode === 'edit' ? '<button type="button" class="btn" data-act="close-modal">Annuler</button>' : '<button type="button" class="btn" data-act="m-back">Retour à la recherche</button>') +
      '<button type="submit" class="btn btn--accent">' + (m.mode === 'edit' ? 'Enregistrer' : m.mode === 'towatch' ? 'Ajouter à À voir' : 'Continuer') + '</button></div></form>';
    return h;
  }

  function chipGroup(field, options, cur, labelText) {
    return '<div class="field"><span class="label" id="lbl-' + field + '">' + labelText + '</span><div class="chips" role="group" aria-labelledby="lbl-' + field + '">' +
      options.map(function (o) {
        var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
        return '<button type="button" class="chip" data-act="m-set" data-f="' + field + '" data-v="' + esc(v) + '" aria-pressed="' + (cur === v) + '">' + esc(l) + '</button>';
      }).join('') + '</div></div>';
  }

  function viewModal() {
    var m = state.modal;
    var title = m.mode === 'edit' ? 'Modifier les infos' : m.step === 'manual' ? 'Ajout à la main' : m.mode === 'search' ? 'Rechercher' : m.mode === 'towatch' ? 'Ajouter à À voir' : 'J\'ai vu…';
    var body = '', foot = '';
    if (m.step === 'manual') {
      body = manualHTML();
    } else if (m.step === 'search') {
      body = '<div class="field"><label class="label" for="m-q">Titre, réalisateur…</label><input id="m-q" type="search" autocomplete="off" data-input="m-q" value="' + esc(m.q) + '"></div>' +
        '<div id="m-results">' + resultsHTML() + '</div>';
    } else if (m.loading || !m.detail) {
      body = '<p class="label">Chargement…</p>';
    } else {
      var d = m.detail, f = m.form, isTv = d.media_type === 'tv';
      var e = findEntry(d.media_type, d.tmdb_id);
      body = '<div class="picked">' + poster(d, { thumb: true }) + '<span style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px"><span class="result__title">' + esc(d.title) + '</span>' +
        '<span class="label">' + (isTv ? 'Série' : 'Film') + (d.year ? ' · ' + d.year : '') + (d.director ? ' · ' + esc(d.director) : '') + '</span></span>' +
        '<button type="button" class="linkish" style="color:inherit" data-act="m-back">Changer</button></div>';
      if (m.mode === 'towatch') {
        body += e ? '<p class="msg">Ce titre est déjà dans ton journal.</p>' : '<p style="margin:0">Il apparaîtra dans ta liste À voir et sur ton journal.</p>';
        foot = '<button type="button" class="btn" data-act="close-modal">Annuler</button>' + (e ? '' : '<button type="button" class="btn btn--accent" data-act="m-towatch">Ajouter à À voir</button>');
      } else {
        if (isTv) {
          var ss = (d.seasons || []).slice().sort(function (a, b) { return a.n - b.n; });
          var curS = ss.filter(function (s) { return s.n === f.season; })[0] || ss[0];
          if (!ss.length) body += '<p class="msg msg--err">TMDB ne liste aucune saison pour cette série.</p>';
          else {
            var epOpts = '';
            for (var i = 1; i <= curS.count; i++) epOpts += '<option value="' + i + '"' + (i === f.ep ? ' selected' : '') + '>Épisode ' + i + '</option>';
            body += '<div class="field"><span class="label">Jusqu\'où tu en es</span><div class="ep-pick">' +
              '<label class="sr-only" for="m-season">Saison</label><select id="m-season" data-change="m-season" style="min-height:46px;border:2px solid var(--line);background:var(--paper);padding:0 10px">' +
              ss.map(function (s) { return '<option value="' + s.n + '"' + (s.n === curS.n ? ' selected' : '') + '>Saison ' + s.n + '</option>'; }).join('') + '</select>' +
              '<label class="sr-only" for="m-ep">Épisode</label><select id="m-ep" data-change="m-ep" style="min-height:46px;border:2px solid var(--line);background:var(--paper);padding:0 10px">' + epOpts + '</select></div>' +
              '<span class="muted" style="font-size:14px">Tous les épisodes jusqu\'à celui-ci seront cochés.</span></div>';
          }
        }
        body += chipGroup('when', [['today', 'Aujourd\'hui'], ['yesterday', 'Hier'], ['other', 'Autre date']], f.when, 'Quand');
        if (f.when === 'other') {
          body += '<div class="field"><label class="label" for="m-date">Date</label><input id="m-date" type="date" max="' + todayISO() + '" value="' + esc(f.date) + '" data-input="m-date"></div>';
        }
        if (!isTv) {
          body += chipGroup('lieu', LIEUX, f.lieu, 'Où');
          body += chipGroup('version', [['VO', 'VO'], ['VF', 'VF']], f.version, 'Version');
          body += '<div class="field"><label class="label" for="m-avec">Avec qui (facultatif)</label><input id="m-avec" type="text" maxlength="80" data-input="m-avec" value="' + esc(f.avec) + '"></div>';
        }
        body += '<div class="field"><span class="label">' + (isTv ? 'Note de la série' : 'Note générale') + ' (facultatif)</span>' + cells('m-note', 'gen', f.note, 'Note', true) + '</div>';
        if (!isTv) {
          body += '<label class="check"><input id="m-rewatch" type="checkbox" data-change="m-rewatch"' + (f.rewatch ? ' checked' : '') + '><span>C\'est un revisionnage</span></label>';
        }
        foot = (e ? '' : '<button type="button" class="btn" data-act="m-towatch">Plutôt À voir</button>') +
          '<button type="button" class="btn btn--accent" data-act="m-save"' + (isTv && !(d.seasons || []).length ? ' disabled' : '') + '>Ajouter au journal</button>';
      }
    }
    return '<div class="overlay" data-act="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="dialog__head"><span class="display" id="m-title">.' + esc(title) + '</span>' +
      '<button type="button" class="icon-btn" data-act="close-modal" aria-label="Fermer">' + ICON.close + '</button></div>' +
      '<div class="dialog__body">' + body + '</div>' + (foot ? '<div class="dialog__foot">' + foot + '</div>' : '') + '</div></div>';
  }

  function saveFromModal() {
    var m = state.modal, d = m.detail, f = m.form;
    var type = d.media_type;
    var e = findEntry(type, d.tmdb_id) || newEntry(d);
    refreshFromDetail(e, d);
    var date = f.when === 'today' ? todayISO() : f.when === 'yesterday' ? yesterdayISO() : (f.date || todayISO());
    if (type === 'movie') {
      e.viewings = e.viewings.concat([{ id: uid(), date: date, lieu: f.lieu, version: f.version, avec: f.avec.trim(), rewatch: !!(f.rewatch || e.viewings.length) }]);
    } else {
      sortedSeasons(e).forEach(function (s) {
        if (s.n > f.season) return;
        var last = s.n < f.season ? s.count : Math.min(f.ep, s.count);
        for (var i = 1; i <= last; i++) if (!e.episodes[s.n + '-' + i]) e.episodes[s.n + '-' + i] = date;
      });
      if (e.status === 'abandonne') e.status = 'en_cours';
    }
    if (f.note) e.notes = Object.assign({}, e.notes, { gen: f.note });
    persist(e).then(function () {
      state.modal = null;
      toast(type === 'movie' ? 'Ajouté à ton journal' : 'Épisodes enregistrés');
      go('fiche-' + type + '-' + d.tmdb_id);
    }).catch(function () {});
  }

  /* ---------- Connexion ---------- */
  function viewAuth() {
    var a = state.ui.auth;
    var titles = { login: 'Connexion', signup: 'Créer un compte', reset: 'Mot de passe oublié', newpw: 'Nouveau mot de passe' };
    var fields = '';
    if (a.mode !== 'newpw') fields += '<div class="field"><label class="label" for="a-email">E-mail</label><input id="a-email" name="email" type="email" autocomplete="email" required></div>';
    if (a.mode !== 'reset') {
      fields += '<div class="field"><label class="label" for="a-pw">' + (a.mode === 'newpw' ? 'Nouveau mot de passe' : 'Mot de passe') + '</label>' +
        '<input id="a-pw" name="password" type="password" minlength="6" required autocomplete="' + (a.mode === 'login' ? 'current-password' : 'new-password') + '"></div>';
    }
    var submit = { login: 'Se connecter', signup: 'Créer mon compte', reset: 'Recevoir le lien', newpw: 'Changer le mot de passe' }[a.mode];
    var links = a.mode === 'login'
      ? '<button type="button" class="linkish" data-act="auth-mode" data-v="signup">Pas encore de compte ? Crée-le</button><button type="button" class="linkish" data-act="auth-mode" data-v="reset">Mot de passe oublié</button>'
      : a.mode === 'newpw' ? '' : '<button type="button" class="linkish" data-act="auth-mode" data-v="login">J\'ai déjà un compte</button>';
    return '<main class="auth wrap"><div class="auth__box">' +
      '<span class="auth__logo" aria-hidden="true">.SÉQUEN-<br><span>CE</span></span>' +
      '<p style="margin:0;font-size:18px">Ton journal privé de films et de séries.</p>' +
      '<h1 class="h2 display">.' + titles[a.mode] + '</h1>' +
      (a.msg ? '<p class="msg" role="status">' + esc(a.msg) + '</p>' : '') +
      (a.err ? '<p class="msg msg--err" role="alert">' + esc(a.err) + '</p>' : '') +
      '<form data-form="auth" novalidate>' + fields +
      '<button type="submit" class="btn btn--accent"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Un instant…' : submit) + '</button></form>' +
      links + '</div></main>' + footer();
  }

  function authError(err) {
    var msg = (err && err.message) || String(err);
    if (/Invalid login credentials/i.test(msg)) return 'E-mail ou mot de passe incorrect.';
    if (/Email not confirmed/i.test(msg)) return 'Confirme d\'abord ton adresse avec le lien reçu par e-mail.';
    if (/already registered/i.test(msg)) return 'Un compte existe déjà avec cet e-mail.';
    if (/at least 6|Password should be/i.test(msg)) return 'Le mot de passe doit faire au moins 6 caractères.';
    if (/rate limit/i.test(msg)) return 'Trop de tentatives. Réessaie dans quelques minutes.';
    return msg;
  }

  /* ---------- Rendu et navigation ---------- */
  function parseRoute() {
    var h = location.hash.replace(/^#/, '');
    try { h = decodeURIComponent(h); } catch (e) { /* lien mal formé */ }
    var m = h.match(/^fiche-(movie|tv)-(-?\d+)$/);
    if (m) return { name: 'fiche', type: m[1], id: m[2] };
    if (['journal', 'videotheque', 'a-voir', 'stats'].indexOf(h) >= 0) return { name: h };
    return { name: 'journal' };
  }
  function go(h) {
    if (location.hash === '#' + h) { state.route = parseRoute(); render(); }
    else location.hash = h;
  }

  var TITLES = { journal: 'Journal', videotheque: 'Vidéothèque', 'a-voir': 'À voir', stats: 'Stats' };
  function render() {
    if (!state.ready) { app.innerHTML = '<div class="wrap loading">Chargement…</div>'; return; }
    if (!store.demo && (!state.user || state.ui.recovery)) {
      app.innerHTML = viewAuth();
      document.title = 'Séquence';
      return;
    }
    var r = state.route, body = '';
    if (r.name === 'videotheque') body = viewLibrary();
    else if (r.name === 'a-voir') body = viewToWatch();
    else if (r.name === 'stats') body = viewStats();
    else if (r.name === 'fiche') body = viewFiche(r.type, r.id);
    else body = viewJournal();

    var active = document.activeElement && document.activeElement.id;
    app.innerHTML = header() + '<main class="wrap">' + body + '</main>' + footer() + (state.modal ? viewModal() : '');
    document.body.style.overflow = state.modal ? 'hidden' : '';

    if (r.name === 'fiche') {
      var fe = findEntry(r.type, r.id) || state.details[key(r.type, r.id)];
      document.title = (fe ? fe.title + ' — ' : '') + 'Séquence';
    } else document.title = 'Séquence — ' + (TITLES[r.name] || 'Journal');

    if (state.modal && state.modal.focus) {
      state.modal.focus = false;
      var q = document.getElementById('m-q');
      if (q) q.focus();
    } else if (active && document.getElementById(active) && active !== 'avis') {
      document.getElementById(active).focus();
    }
  }

  window.addEventListener('hashchange', function () {
    state.route = parseRoute();
    state.ui.confirm = null;
    state.ui.tonight = null;
    render();
    window.scrollTo(0, 0);
  });

  /* ---------- Thème ---------- */
  function applyTheme() {
    var t = null;
    try { t = localStorage.getItem('sequence-theme'); } catch (e) { /* stockage indisponible */ }
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('sequence-theme', next); } catch (e) { /* stockage indisponible */ }
  }

  /* ---------- Actions ---------- */
  function markEpisode(e, s, n, date) { e.episodes = Object.assign({}, e.episodes); e.episodes[s + '-' + n] = date || todayISO(); }

  var actions = {
    'open-search': function () { openModal('search'); },
    'open-add': function () { openModal('add'); },
    'open-towatch': function () { openModal('towatch'); },
    'theme': toggleTheme,
    'logout': function () { store.signOut(); },
    'reset-demo': function () {
      store.resetDemo().then(function () { state.loadedFor = null; return loadData(true); }).then(function () { toast('Exemples remis en place'); });
    },
    'close-modal': closeModal,
    'overlay': closeModal,
    'edit-goal': function () {
      state.ui.editGoal = true; render();
      var i = document.getElementById('goal-in'); if (i) { i.focus(); i.select(); }
    },
    'quick-ep': function (t) {
      var e = findById(t.dataset.id); if (!e) return;
      var n = nextEp(e); if (!n) return;
      markEpisode(e, n.s, n.e);
      persist(e).then(function () { toast('S' + n.s + ' · É' + n.e + ' vu'); render(); }).catch(function () {});
    },
    'seen-this': function (t) { openModal('add', { type: t.dataset.type, id: t.dataset.id }); },
    'add-towatch': function (t) {
      var d = state.details[key(t.dataset.type, t.dataset.id)]; if (!d) return;
      persist(newEntry(d)).then(function () { toast('Ajouté à À voir'); render(); }).catch(function () {});
    },
    'ask-confirm': function (t) { state.ui.confirm = t.dataset.what; render(); },
    'cancel-confirm': function () { state.ui.confirm = null; render(); },
    'do-confirm': function (t) {
      var p = t.dataset.what.split(':');
      state.ui.confirm = null;
      var e = findById(p[1]); if (!e) { render(); return; }
      if (p[0] === 'entry') {
        removeEntry(e).then(function () { toast('Retiré de ton journal'); render(); }).catch(function () {});
      } else if (p[0] === 'viewing') {
        e.viewings = e.viewings.filter(function (v) { return v.id !== p[2]; });
        persist(e).then(function () { toast('Visionnage supprimé'); render(); }).catch(function () {});
      }
    },
    'note': function (t) {
      var r = state.route, e = findEntry(r.type, r.id); if (!e) return;
      var v = parseInt(t.dataset.v, 10), k = t.dataset.k;
      e.notes = Object.assign({}, e.notes);
      e.notes[k] = e.notes[k] === v ? 0 : v;
      render();
      persist(e).catch(function () {});
    },
    'snote': function (t) {
      var r = state.route, e = findEntry(r.type, r.id); if (!e) return;
      var v = parseInt(t.dataset.v, 10), k = t.dataset.k;
      e.season_notes = Object.assign({}, e.season_notes);
      e.season_notes[k] = e.season_notes[k] === v ? 0 : v;
      render();
      persist(e).catch(function () {});
    },
    'season': function (t) { state.ui.season[t.dataset.k] = parseInt(t.dataset.s, 10); render(); },
    'ep': function (t) {
      var e = entryFor('tv', t.dataset.id); if (!e) return;
      var k = t.dataset.s + '-' + t.dataset.e;
      e.episodes = Object.assign({}, e.episodes);
      if (e.episodes[k]) delete e.episodes[k]; else e.episodes[k] = todayISO();
      if (e.status === 'abandonne') e.status = 'en_cours';
      persist(e).then(render).catch(function () {});
    },
    'next-ep': function (t) {
      var e = entryFor('tv', t.dataset.id); if (!e) return;
      var n = nextEp(e); if (!n) return;
      markEpisode(e, n.s, n.e);
      state.ui.season[key('tv', t.dataset.id)] = n.s;
      persist(e).then(function () { toast('S' + n.s + ' · É' + n.e + ' vu'); render(); }).catch(function () {});
    },
    'season-all': function (t) {
      var e = entryFor('tv', t.dataset.id); if (!e) return;
      var s = parseInt(t.dataset.s, 10);
      var season = sortedSeasons(e).filter(function (x) { return x.n === s; })[0]; if (!season) return;
      var all = true, i;
      for (i = 1; i <= season.count; i++) if (!e.episodes[s + '-' + i]) all = false;
      e.episodes = Object.assign({}, e.episodes);
      for (i = 1; i <= season.count; i++) {
        if (all) delete e.episodes[s + '-' + i];
        else if (!e.episodes[s + '-' + i]) e.episodes[s + '-' + i] = todayISO();
      }
      persist(e).then(render).catch(function () {});
    },
    'abandon': function (t) {
      var e = findById(t.dataset.id); if (!e) return;
      e.status = e.status === 'abandonne' ? 'en_cours' : 'abandonne';
      persist(e).then(function (s) { toast(s.status === 'abandonne' ? 'Série marquée comme abandonnée' : 'Série reprise'); render(); }).catch(function () {});
    },
    'm-pick': function (t) { pick(t.dataset.type, t.dataset.id); },
    'm-back': function () { var m = state.modal; m.step = 'search'; m.detail = null; m.focus = true; render(); },
    'm-set': function (t) { state.modal.form[t.dataset.f] = t.dataset.v; render(); },
    'm-note': function (t) { var f = state.modal.form, v = parseInt(t.dataset.v, 10); f.note = f.note === v ? 0 : v; render(); },
    'm-save': saveFromModal,
    'm-towatch': function () {
      var d = state.modal.detail;
      if (findEntry(d.media_type, d.tmdb_id)) { toast('Déjà dans ton journal'); return; }
      persist(newEntry(d)).then(function () { state.modal = null; toast('Ajouté à À voir'); render(); }).catch(function () {});
    },
    'm-manual': function () {
      var m = state.modal; if (!m) return;
      m.step = 'manual'; m.err = '';
      m.manual = m.manual || { type: 'movie', title: m.q.trim(), year: '', runtime: '', eps: '', director: '', genres: '' };
      render();
      var t = document.getElementById(m.manual.title ? 'mf-year' : 'mf-title'); if (t) t.focus();
    },
    'mf-type': function (t) { state.modal.manual.type = t.dataset.v; render(); },
    'edit-manual': function (t) {
      var e = findById(t.dataset.id); if (!e) return;
      state.modal = {
        mode: 'edit', step: 'manual', q: '', results: [], loading: false, err: '', detail: null, form: null, focus: false,
        manual: {
          id: e.id, type: e.media_type, title: e.title, year: e.year || '',
          runtime: (e.media_type === 'tv' ? e.ep_runtime : e.runtime) || '',
          eps: sortedSeasons(e).map(function (s) { return s.count; }).join(', '),
          director: e.director || '', genres: e.genres.join(', ')
        }
      };
      render();
    },
    'auth-mode': function (t) { state.ui.auth = { mode: t.dataset.v, msg: '', err: '', busy: false }; render(); }
  };

  var forms = {
    goal: function (f) {
      var v = parseInt(f.querySelector('#goal-in').value, 10);
      if (!v || v < 1) { toast('Indique un nombre de films supérieur à 0', true); return; }
      var y = new Date().getFullYear();
      store.setGoal(y, v).then(function () { state.goal = v; state.ui.editGoal = false; render(); })
        .catch(function (err) { toast('Objectif non enregistré : ' + (err.message || err), true); });
    },
    tonight: function (f) {
      var min = parseInt(f.querySelector('#tonight-min').value, 10) || 90;
      state.ui.tonightMin = min;
      var cands = state.entries.filter(function (e) { return e.media_type === 'movie' && e.status === 'a_voir' && e.runtime && e.runtime <= min; });
      state.ui.tonight = cands.length ? { id: cands[Math.floor(Math.random() * cands.length)].id } : { none: true, min: min };
      render();
    },
    manual: function () {
      var m = state.modal, mm = m.manual, isTv = mm.type === 'tv';
      var title = String(mm.title || '').trim();
      var year = parseInt(mm.year, 10);
      var rt = parseInt(mm.runtime, 10);
      var counts = String(mm.eps || '').split(/[^0-9]+/).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; });
      if (!title) { m.err = 'Indique au moins le titre.'; render(); return; }
      if (mm.year !== '' && (!year || year < 1880 || year > 2100)) { m.err = 'L\'année doit être entre 1880 et 2100.'; render(); return; }
      if (isTv && !counts.length) { m.err = 'Indique le nombre d\'épisodes de chaque saison, par exemple « 8, 10 ».'; render(); return; }
      var genres = String(mm.genres || '').split(',').map(function (g) { return g.trim(); }).filter(Boolean).slice(0, 8);
      var seasons = isTv ? counts.slice(0, 60).map(function (c, i) { return { n: i + 1, count: Math.min(c, 500) }; }) : [];
      var fields = {
        title: title, year: year || null, director: String(mm.director || '').trim(), genres: genres,
        runtime: !isTv && rt > 0 ? rt : null, ep_runtime: isTv ? (rt > 0 ? rt : 45) : null, seasons: seasons
      };
      if (m.mode === 'edit') {
        var e = findById(mm.id); if (!e) { closeModal(); return; }
        Object.keys(fields).forEach(function (k) { e[k] = fields[k]; });
        if (isTv) {
          var valid = {};
          seasons.forEach(function (s) { for (var i = 1; i <= s.count; i++) valid[s.n + '-' + i] = 1; });
          Object.keys(e.episodes).forEach(function (k) { if (!valid[k]) delete e.episodes[k]; });
        }
        persist(e).then(function () { state.modal = null; toast('Infos mises à jour'); render(); }).catch(function () {});
        return;
      }
      var d = Object.assign({ tmdb_id: newManualId(), media_type: mm.type, poster_path: null, overview: '', recommendations: [] }, fields);
      if (m.mode === 'towatch') {
        persist(newEntry(d)).then(function () { state.modal = null; toast('Ajouté à À voir'); render(); }).catch(function () {});
        return;
      }
      m.mode = 'add';
      startForm(m, d);
    },
    auth: function (f) {
      var a = state.ui.auth;
      var email = f.querySelector('#a-email') ? f.querySelector('#a-email').value.trim() : '';
      var pw = f.querySelector('#a-pw') ? f.querySelector('#a-pw').value : '';
      if (a.mode !== 'newpw' && !/^\S+@\S+\.\S+$/.test(email)) { a.err = 'Indique une adresse e-mail valide.'; render(); return; }
      if (a.mode !== 'reset' && pw.length < 6) { a.err = 'Le mot de passe doit faire au moins 6 caractères.'; render(); return; }
      a.busy = true; a.err = ''; a.msg = ''; render();
      var p = a.mode === 'login' ? store.signIn(email, pw)
        : a.mode === 'signup' ? store.signUp(email, pw)
        : a.mode === 'reset' ? store.resetPassword(email)
        : store.updatePassword(pw);
      p.then(function () {
        a.busy = false;
        if (a.mode === 'signup') { state.ui.auth = { mode: 'login', msg: 'Compte créé. Ouvre le lien reçu par e-mail pour confirmer ton adresse, puis connecte-toi.', err: '', busy: false }; }
        else if (a.mode === 'reset') { a.msg = 'Si un compte existe avec cette adresse, un e-mail vient de partir.'; }
        else if (a.mode === 'newpw') { state.ui.recovery = false; state.ui.auth = { mode: 'login', msg: '', err: '', busy: false }; toast('Mot de passe changé'); }
        render();
      }).catch(function (err) { a.busy = false; a.err = authError(err); render(); });
    }
  };

  var searchTimer, avisTimer;
  var inputs = {
    'avis': function (t) {
      var e = findById(t.dataset.id); if (!e) return;
      e.avis = t.value;
      var s = document.getElementById('avis-state');
      if (s) s.textContent = 'Enregistrement…';
      clearTimeout(avisTimer);
      avisTimer = setTimeout(function () {
        persist(e).then(function () {
          var s2 = document.getElementById('avis-state'); if (s2) s2.textContent = 'Enregistré · visible par toi seul.';
        }).catch(function () {});
      }, 700);
    },
    'm-q': function (t) {
      var m = state.modal; if (!m) return;
      m.q = t.value; m.err = '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (!m.q.trim()) { m.results = []; updateResults(); return; }
        m.loading = true; updateResults();
        var q = m.q;
        TMDB.search(q).then(function (res) {
          if (state.modal !== m || m.q !== q) return;
          m.results = res; m.loading = false; updateResults();
        }).catch(function (err) {
          if (state.modal !== m) return;
          m.loading = false; m.err = 'Recherche impossible : ' + (err.message || err); updateResults();
        });
      }, 350);
    },
    'm-date': function (t) { state.modal.form.date = t.value; },
    'm-avec': function (t) { state.modal.form.avec = t.value; },
    'mf': function (t) { if (state.modal && state.modal.manual) state.modal.manual[t.dataset.k] = t.value; }
  };
  function updateResults() { var el = document.getElementById('m-results'); if (el) el.innerHTML = resultsHTML(); }

  var changes = {
    'per-season': function (t) {
      var r = state.route, e = findEntry(r.type, r.id); if (!e) return;
      e.per_season = t.checked; render();
      persist(e).catch(function () {});
    },
    'stats-year': function (t) { state.ui.statsYear = parseInt(t.value, 10); render(); },
    'm-season': function (t) { var f = state.modal.form; f.season = parseInt(t.value, 10); f.ep = 1; render(); },
    'm-ep': function (t) { state.modal.form.ep = parseInt(t.value, 10); },
    'm-rewatch': function (t) { state.modal.form.rewatch = t.checked; }
  };

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'overlay' && ev.target !== t) return;
    if (actions[act]) actions[act](t, ev);
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    if (forms[f.dataset.form]) forms[f.dataset.form](f);
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.input && inputs[t.dataset.input]) inputs[t.dataset.input](t);
    if (t.dataset && t.dataset.lib) {
      state.ui.lib[t.dataset.lib] = t.value;
      var g = document.getElementById('lib-grid'); if (g) g.innerHTML = libGrid();
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.change && changes[t.dataset.change]) changes[t.dataset.change](t);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && state.modal) closeModal();
  });

  /* ---------- Démarrage ---------- */
  function loadData(force) {
    if (!state.user) { state.entries = []; state.loadedFor = null; state.ready = true; render(); return Promise.resolve(); }
    var who = state.user.id || state.user.email;
    if (!force && state.loadedFor === who) { render(); return Promise.resolve(); }
    state.loadedFor = who;
    return Promise.all([store.listEntries(), store.getGoal(new Date().getFullYear())]).then(function (res) {
      state.entries = res[0].map(normalizeEntry);
      state.goal = res[1];
      state.ready = true;
      if (/access_token|type=recovery|error_description/.test(location.hash)) {
        history.replaceState(null, '', location.pathname + location.search + '#journal');
      }
      state.route = parseRoute();
      render();
    }).catch(function (err) {
      state.ready = true;
      state.loadedFor = null;
      render();
      toast('Chargement impossible : ' + (err && err.message ? err.message : err), true);
    });
  }

  applyTheme();
  state.route = parseRoute();
  render();
  store.init().then(function (user) {
    state.user = user;
    store.onAuth(function (event, u) {
      state.user = u;
      if (event === 'PASSWORD_RECOVERY') {
        state.ui.recovery = true;
        state.ui.auth = { mode: 'newpw', msg: '', err: '', busy: false };
        state.ready = true;
        render();
        return;
      }
      loadData();
    });
    return loadData();
  }).catch(function (err) {
    app.innerHTML = '<main class="wrap"><div class="empty" style="margin-top:40px"><span class="h2 display">.Connexion impossible</span>' +
      '<p style="margin:0">Le site n\'arrive pas à joindre Supabase. Vérifie SUPABASE_URL et SUPABASE_ANON_KEY dans config.js.</p>' +
      '<p class="muted" style="margin:0">' + esc(err && err.message ? err.message : err) + '</p></div></main>';
  });
})();
