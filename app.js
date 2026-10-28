/*
 * Séquence — application (journal privé de films et de séries)
 * Pages : #journal, #videotheque, #a-voir, #stats, #compte, #fiche-movie-123, #fiche-tv-123
 *
 * Dates de visionnage : { date: 'AAAA-MM-JJ' | null, year: AAAA | null, added: 'AAAA-MM-JJ' }
 *   date connue → compte au mois ; « je ne sais plus » → compte dans l'année indiquée,
 *   sinon dans l'année où le titre a été enregistré.
 * Saisons d'une série (colonne episodes) : { "S1": { st: 'vu' | 'en_cours', date, year, added } }
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
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"></path></svg>'
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
      lib: { type: 'all', status: 'seen', genre: '', saga: '', sort: 'recent', q: '' },
      statsYear: new Date().getFullYear(),
      confirm: null,
      recovery: false,
      auth: { mode: 'login', msg: '', err: '', busy: false },
      account: { msg: {}, err: {} }
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
  var CUR_YEAR = new Date().getFullYear();

  /* ---------- Lien vers Paragraphe (le même journal, pour les livres) ---------- */
  var PARAGRAPHE_URL = String((window.SEQUENCE_CONFIG || {}).PARAGRAPHE_URL || '').trim();
  var PARA_LOGO = '<svg class="para__logo" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="#22253A"></rect>' +
    '<text x="24" y="35" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="32" fill="#D9B98C">¶</text></svg>';
  function paraHref() { return /^https?:\/\//.test(PARAGRAPHE_URL) ? PARAGRAPHE_URL : ''; }
  function paraLink(inner, cls) {
    var h = paraHref();
    if (h) return '<a class="' + cls + '" href="' + esc(h) + '" target="_blank" rel="noopener">' + inner + '</a>';
    if (store.demo) return '<button type="button" class="' + cls + '" data-act="para-demo">' + inner + '</button>';
    return '';
  }
  function paraCard() {
    return paraLink(PARA_LOGO + '<span class="para__text"><span class="label">Et pour tes livres ?</span>' +
      '<span class="para__title">Paragraphe</span><span>Le même journal, pour noter et suivre tes lectures.</span></span>' +
      '<span class="para__go" aria-hidden="true">↗</span>', 'para');
  }

  /* ---------- Dates de visionnage ---------- */
  function recYear(r) {
    if (!r) return null;
    if (r.date) return parseInt(r.date.slice(0, 4), 10);
    if (r.year) return parseInt(r.year, 10);
    return r.added ? parseInt(r.added.slice(0, 4), 10) : null;
  }
  function recMonth(r) { return r && r.date ? parseInt(r.date.slice(5, 7), 10) - 1 : null; }
  function recKey(r) { return r ? (r.date || (r.year ? r.year + '-00-00' : '') || r.added || '') : ''; }
  function recLabel(r) {
    if (!r) return '';
    if (r.date) return fmtDate(r.date);
    if (r.year) return 'En ' + r.year + ' (date exacte inconnue)';
    return 'Date inconnue';
  }
  function recShort(r) { return !r ? '' : r.date ? fmtShort(r.date) : r.year ? String(r.year) : '?'; }

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
  function seasonRec(e, n) { return (e.episodes || {})['S' + n] || null; }
  function seasonState(e, n) { var r = seasonRec(e, n); return r ? r.st : ''; }
  function seasonsSeen(e) { return sortedSeasons(e).filter(function (s) { return seasonState(e, s.n) === 'vu'; }).length; }
  function nextSeason(e) {
    var ss = sortedSeasons(e);
    for (var i = 0; i < ss.length; i++) if (seasonState(e, ss[i].n) !== 'vu') return { n: ss[i].n, st: seasonState(e, ss[i].n), count: ss[i].count };
    return null;
  }
  function seasonRecs(e) { return Object.keys(e.episodes || {}).map(function (k) { return e.episodes[k]; }).filter(Boolean); }
  function lastRec(e) {
    var best = null;
    (e.viewings || []).concat(e.media_type === 'tv' ? seasonRecs(e) : []).forEach(function (r) {
      if (!best || recKey(r) > recKey(best)) best = r;
    });
    return best;
  }
  function lastActivity(e) { return recKey(lastRec(e)); }
  function hasActivity(e) { return !!(e && ((e.viewings || []).length || seasonRecs(e).length)); }
  function sagaOf(e) { return e && e.notes && e.notes._saga ? e.notes._saga : null; }

  function computeStatus(e) {
    if (e.media_type === 'movie') return (e.viewings || []).length ? 'vu' : 'a_voir';
    var ss = sortedSeasons(e);
    var any = seasonRecs(e).length;
    if (ss.length && seasonsSeen(e) >= ss.length) return 'vu';
    if (e.status === 'abandonne' && any) return 'abandonne';
    if (!any) return 'a_voir';
    return 'en_cours';
  }

  // Ancien format (épisode par épisode « 1-3 ») → saisons. Saison complète = vue, commencée = en cours.
  function migrateEpisodes(e) {
    var keys = Object.keys(e.episodes || {});
    if (!keys.some(function (k) { return /^\d+-\d+$/.test(k); })) return false;
    var ne = {};
    keys.forEach(function (k) { if (/^S\d+$/.test(k)) ne[k] = e.episodes[k]; });
    sortedSeasons(e).forEach(function (s) {
      if (ne['S' + s.n]) return;
      var dates = [];
      for (var i = 1; i <= s.count; i++) if (e.episodes[s.n + '-' + i]) dates.push(e.episodes[s.n + '-' + i]);
      if (!dates.length) return;
      dates.sort();
      var last = dates[dates.length - 1];
      ne['S' + s.n] = { st: dates.length >= s.count ? 'vu' : 'en_cours', date: last, year: null, added: last };
    });
    e.episodes = ne;
    return true;
  }

  function normalizeEntry(e) {
    e.notes = e.notes || {};
    e.season_notes = e.season_notes || {};
    e.viewings = e.viewings || [];
    e.episodes = e.episodes || {};
    e.seasons = e.seasons || [];
    e.genres = e.genres || [];
    e.avis = e.avis || '';
    if (e.media_type === 'tv' && migrateEpisodes(e)) e._migrated = true;
    e.status = computeStatus(e);
    return e;
  }
  function newEntry(d) {
    var notes = {};
    if (d.saga) notes._saga = { id: d.saga.id, label: d.saga.label, order: d.saga.order || null };
    return normalizeEntry({
      tmdb_id: d.tmdb_id, media_type: d.media_type, title: d.title, year: d.year || null,
      poster_path: d.poster_path || null, runtime: d.runtime || null, ep_runtime: d.ep_runtime || null,
      genres: (d.genres || []).slice(), director: d.director || '', seasons: (d.seasons || []).slice(),
      status: 'a_voir', notes: notes, season_notes: {}, per_season: false, avis: '', viewings: [], episodes: {}
    });
  }
  // Complète la fiche enregistrée avec les infos du catalogue ; renvoie true si quelque chose a changé
  function refreshFromDetail(e, d) {
    if (!d) return false;
    var changed = false;
    if (d.seasons && d.seasons.length && JSON.stringify(e.seasons) !== JSON.stringify(d.seasons)) { e.seasons = d.seasons.slice(); changed = true; }
    if (d.poster_path && !e.poster_path) { e.poster_path = d.poster_path; changed = true; } // ne remplace jamais une affiche choisie
    if (d.runtime && !e.runtime) { e.runtime = d.runtime; changed = true; }
    if (d.ep_runtime && !e.ep_runtime) { e.ep_runtime = d.ep_runtime; changed = true; }
    if (d.genres && d.genres.length && !e.genres.length) { e.genres = d.genres.slice(); changed = true; }
    if (d.director && !e.director) { e.director = d.director; changed = true; }
    // Saga : on suit le catalogue (corrige les anciennes sagas mal détectées, ex. « Pixar » au lieu de « Cars »)
    if ('saga' in d && !isManualId(e.tmdb_id)) {
      var cur = sagaOf(e);
      if (d.saga && (!cur || cur.id !== d.saga.id || cur.label !== d.saga.label || (d.saga.order && cur.order !== d.saga.order))) {
        e.notes = Object.assign({}, e.notes, { _saga: { id: d.saga.id, label: d.saga.label, order: d.saga.order || null } }); changed = true;
      } else if (!d.saga && cur) {
        e.notes = Object.assign({}, e.notes); delete e.notes._saga; changed = true;
      }
    }
    return changed;
  }
  function entryFor(type, id) {
    return findEntry(type, id) || (state.details[key(type, id)] ? newEntry(state.details[key(type, id)]) : null);
  }

  function persist(e) {
    delete e._migrated;
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
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
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
      nav('journal', 'Journal') + nav('videotheque', 'Vidéothèque') + nav('a-voir', 'À voir') + nav('stats', 'Stats') + nav('compte', 'Mon compte') +
      '</nav><div class="tools">' +
      '<button type="button" class="search-btn" data-act="open-search">' + ICON.search + '<span>Film, série, réalisateur</span></button>' +
      '<button type="button" class="btn btn--accent btn--small" data-act="open-add">J\'ai vu…</button>' +
      '<button type="button" class="icon-btn" data-act="theme" aria-label="Basculer entre mode clair et mode sombre">' + ICON.theme + '</button>' +
      '</div></div></header>' +
      (store.demo ? '<div class="demo-bar"><div class="wrap"><span><b>Mode démo.</b> Tes données restent dans ce navigateur. Renseigne config.js pour activer les comptes.</span>' +
        '<button type="button" data-act="reset-demo">Remettre les exemples</button></div></div>' : '');
  }

  function footer() {
    return '<footer class="foot"><div class="wrap">' +
      '<span>.SÉQUENCE — ton journal privé de films et de séries' + (paraHref() ? ' · <a class="link" href="' + esc(paraHref()) + '" target="_blank" rel="noopener">Pour les livres : Paragraphe ↗</a>' : '') + '</span>' +
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

  function googleLink(q, kind) {
    q = String(q || '').trim();
    if (!q) return '';
    var url = 'https://www.google.com/search?q=' + encodeURIComponent(q + (kind === 'tv' ? ' série' : kind === 'movie' ? ' film' : ''));
    return '<a class="link" href="' + esc(url) + '" target="_blank" rel="noopener">Chercher « ' + esc(q) + ' » sur Google ↗</a>';
  }

  function tile(e, tag, meta) {
    var note = e.notes && e.notes.gen ? e.notes.gen + '/5' : '';
    var hasImg = !!TMDB.img(e.poster_path);
    return '<a class="tile" href="#fiche-' + e.media_type + '-' + e.tmdb_id + '">' + poster(e, { tag: tag }) +
      (hasImg ? '<span style="font-weight:700;font-size:14px;line-height:1.3">' + esc(e.title) + '</span>' : '') +
      '<span class="tile__meta num"><span>' + esc(meta || '') + '</span><span class="tile__note">' + note + '</span></span></a>';
  }

  /* ---------- Journal ---------- */
  function filmsInYear(y) {
    var n = 0;
    state.entries.forEach(function (e) {
      if (e.media_type === 'movie') e.viewings.forEach(function (v) { if (recYear(v) === y) n++; });
    });
    return n;
  }

  function viewJournal() {
    var y = CUR_YEAR;
    var es = state.entries;
    var dateLabel = '.' + new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
    var films = filmsInYear(y);
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

    var helpBlock = '<details class="help"' + (es.length ? '' : ' open') + '><summary><span class="h2 display">.Comment ça marche</span></summary><div>' + howtoHTML() + '</div></details>';
    if (!es.length) {
      return '<div class="stack">' + hero + '<div class="empty"><span class="h2 display">.Ton journal est vide</span>' +
        '<p style="margin:0;max-width:60ch">Commence par le dernier film ou la dernière série que tu as regardés. Tu pourras les noter et suivre tes saisons.</p>' +
        '<button type="button" class="btn btn--accent" data-act="open-add">J\'ai vu…</button></div>' + helpBlock + paraCard() + '</div>';
    }

    var enCours = es.filter(function (e) { return e.status === 'en_cours'; })
      .sort(function (a, b) { return lastActivity(b).localeCompare(lastActivity(a)); });
    var enCoursHTML = enCours.length ? '<div class="grid-2">' + enCours.map(function (e) {
      var n = nextSeason(e), tot = sortedSeasons(e).length, seen = seasonsSeen(e);
      return '<div class="card">' + poster(e, { thumb: true }) + '<div class="card__body">' +
        '<a class="card__title" href="#fiche-tv-' + e.tmdb_id + '">' + esc(e.title) + '</a>' +
        '<span>' + (n ? 'Saison ' + n.n + (n.st === 'en_cours' ? ' en cours' : ' à voir') : 'Tout est vu') + '</span>' +
        '<span class="bar"><span style="width:' + (tot ? Math.round(seen / tot * 100) : 0) + '%"></span></span>' +
        '<span class="label num">' + seen + ' / ' + plural(tot, 'saison vue', 'saisons vues') + '</span>' +
        (n ? '<span><button type="button" class="btn btn--ink btn--small" data-act="season-done" data-id="' + esc(e.id) + '" data-s="' + n.n + '">J\'ai fini la saison ' + n.n + '</button></span>' : '') +
        '</div></div>';
    }).join('') + '</div>' : '<p class="muted" style="margin:0">Aucune série en cours.</p>';

    var recent = [];
    es.forEach(function (e) {
      if (e.media_type === 'movie') e.viewings.forEach(function (v) { recent.push({ e: e, r: v, tag: v.rewatch ? 'Revu' : 'Film' }); });
      else { var r = lastRec(e); if (r) recent.push({ e: e, r: r, tag: 'Série' }); }
    });
    recent.sort(function (a, b) { return recKey(b.r).localeCompare(recKey(a.r)); });
    recent = recent.slice(0, 10);
    var recentHTML = recent.length ? '<div class="posters">' + recent.map(function (x) { return tile(x.e, x.tag, recShort(x.r)); }).join('') + '</div>'
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
      helpBlock + paraCard() + '</div>';
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
      if (f.saga && !(sagaOf(e) && sagaOf(e).id === f.saga)) return false;
      if (q && (e.title + ' ' + e.director).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (f.saga) {
        var oa = sagaOf(a).order, ob = sagaOf(b).order;
        if (oa != null && ob != null && oa !== ob) return oa - ob;
        return (a.year || 9999) - (b.year || 9999);
      }
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
    var f = state.ui.lib, sagaNote = '';
    if (f.saga) {
      var s = list.map(sagaOf)[0];
      var seen = list.filter(hasActivity).length;
      sagaNote = '<p class="note" style="margin:0 0 14px">Saga ' + esc(s ? s.label : '') + ' : ' + seen + ' vu' + (seen > 1 ? 's' : '') + ' sur ' + list.length + ' dans ton journal. ' +
        'Ouvre un des films pour voir toute la saga.</p>';
    }
    return sagaNote + '<p class="label" style="margin:0 0 14px">' + plural(list.length, 'titre', 'titres') + '</p><div class="posters">' + list.map(function (e) {
      var tag = e.media_type === 'movie' ? (f.saga && sagaOf(e).order ? 'N° ' + sagaOf(e).order : 'Film')
        : (e.status === 'en_cours' ? 'En cours' : e.status === 'abandonne' ? 'Abandonnée' : 'Série');
      var last = lastRec(e);
      return tile(e, tag, last ? recShort(last) + (last.date ? '.' + last.date.slice(2, 4) : '') : (e.year || ''));
    }).join('') + '</div>';
  }
  function viewLibrary() {
    var f = state.ui.lib;
    var genres = {}, sagas = {};
    state.entries.forEach(function (e) {
      e.genres.forEach(function (g) { genres[g] = 1; });
      var s = sagaOf(e); if (s) sagas[s.id] = s.label;
    });
    function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    var sagaIds = Object.keys(sagas).sort(function (a, b) { return sagas[a].localeCompare(sagas[b], 'fr'); });
    return '<div class="stack"><div class="section"><span class="eyebrow">.Tout ce que tu as vu</span><h1 class="h1 display">.Vidéo&shy;thèque</h1></div>' +
      '<div class="filters">' +
      '<div class="field"><label class="label" for="lib-type">Type</label><select id="lib-type" data-lib="type">' +
      opt('all', 'Films et séries', f.type) + opt('movie', 'Films', f.type) + opt('tv', 'Séries', f.type) + '</select></div>' +
      '<div class="field"><label class="label" for="lib-status">Statut</label><select id="lib-status" data-lib="status">' +
      opt('seen', 'Tout ce que j\'ai vu', f.status) + opt('vu', 'Terminés', f.status) + opt('en_cours', 'En cours', f.status) +
      opt('abandonne', 'Abandonnés', f.status) + opt('all', 'Tout, même À voir', f.status) + '</select></div>' +
      '<div class="field"><label class="label" for="lib-genre">Genre</label><select id="lib-genre" data-lib="genre">' + opt('', 'Tous les genres', f.genre) +
      Object.keys(genres).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).map(function (g) { return opt(g, g, f.genre); }).join('') + '</select></div>' +
      '<div class="field"><label class="label" for="lib-saga">Saga</label><select id="lib-saga" data-lib="saga">' + opt('', sagaIds.length ? 'Toutes les sagas' : 'Aucune saga pour l\'instant', f.saga) +
      sagaIds.map(function (id) { return opt(id, sagas[id], f.saga); }).join('') + '</select></div>' +
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
        '<div class="row__actions"><button type="button" class="btn btn--accent btn--small" data-act="seen-this" data-type="' + e.media_type + '" data-id="' + e.tmdb_id + '">Je l\'ai vu</button>' +
        confirmBtn('entry:' + e.id, 'Retirer') + '</div></div>';
    }).join('') + '</div>'
      : '<div class="empty"><span class="h3 display">Ta liste est vide</span><span>Ajoute les films et séries que tu veux voir plus tard.</span></div>';
    return '<div class="stack"><div class="section-head"><div class="section"><span class="eyebrow">.' + plural(list.length, 'titre', 'titres') + ' en attente</span>' +
      '<h1 class="h1 display">.À voir</h1></div><button type="button" class="btn btn--ink" data-act="open-towatch">Ajouter à la liste</button></div>' + rows + '</div>';
  }

  /* ---------- Stats ---------- */
  function viewStats() {
    var P = state.ui.statsYear; // une année, ou 'all'
    var isAll = P === 'all';
    function inP(r) { return isAll || recYear(r) === P; }
    var years = {};
    years[CUR_YEAR] = 1;
    var movieViews = [], seasonsDone = 0, epMin = 0, active = {}, months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], perYear = {};
    state.entries.forEach(function (e) {
      e.viewings.forEach(function (v) {
        var y = recYear(v); if (y) years[y] = 1;
        if (!inP(v)) return;
        movieViews.push({ e: e, v: v });
        active[e.id] = e;
        var m = recMonth(v); if (m != null) months[m]++;
        if (y) perYear[y] = (perYear[y] || 0) + 1;
      });
      if (e.media_type === 'tv') {
        sortedSeasons(e).forEach(function (s) {
          var r = seasonRec(e, s.n);
          if (!r) return;
          var y = recYear(r); if (y) years[y] = 1;
          if (!inP(r)) return;
          active[e.id] = e;
          if (r.st === 'vu') { seasonsDone++; epMin += (s.count || 0) * (e.ep_runtime || 45); }
        });
      }
    });
    var undated = movieViews.filter(function (x) { return !x.v.date; }).length;
    var filmMin = movieViews.reduce(function (s, x) { return s + (x.e.runtime || 0); }, 0);
    var hours = Math.round((filmMin + epMin) / 60);
    var actives = Object.keys(active).map(function (k) { return active[k]; });
    var noted = actives.filter(function (e) { return e.notes.gen; });
    var avg = noted.length ? noted.reduce(function (s, e) { return s + e.notes.gen; }, 0) / noted.length : 0;

    var yearOpts = '<option value="all"' + (isAll ? ' selected' : '') + '>Depuis le début</option>' +
      Object.keys(years).map(Number).sort(function (a, b) { return b - a; }).map(function (yy) {
        return '<option value="' + yy + '"' + (yy === P ? ' selected' : '') + '>' + yy + '</option>';
      }).join('');
    var head = '<div class="section-head"><h1 class="h1 display">' + (isAll ? '.Depuis le début' : '.Mon année <span style="color:var(--accent-text)">' + esc(P) + '</span>') + '</h1>' +
      '<div class="field"><label class="label" for="stats-year">Période</label><select id="stats-year" data-change="stats-year">' + yearOpts + '</select></div></div>';

    if (!actives.length) {
      return '<div class="stack">' + head + '<div class="empty"><span class="h3 display">Rien de vu ' + (isAll ? 'pour l\'instant' : 'en ' + esc(P)) + '</span><span>Tes chiffres apparaîtront ici dès ton premier visionnage.</span></div></div>';
    }

    var kpis = '<div class="kpis">' +
      '<div class="kpi"><span class="label">Films vus</span><span class="kpi__v num">' + movieViews.length + '</span></div>' +
      '<div class="kpi"><span class="label">Saisons vues</span><span class="kpi__v num">' + seasonsDone + '</span></div>' +
      '<div class="kpi"><span class="label">Devant l\'écran</span><span class="kpi__v num">≈ ' + hours + ' h</span></div>' +
      '<div class="kpi kpi--accent"><span class="label">Note moyenne</span><span class="kpi__v num">' + (avg ? fmtNum(avg) : '–') + '</span></div></div>' +
      (undated ? '<p class="note">Dont ' + plural(undated, 'film', 'films') + ' sans date exacte' +
        (isAll ? '.' : ', comptés dans l\'année que tu as indiquée ou, sinon, celle où tu les as enregistrés. Ils n\'apparaissent pas dans le graphique par mois.') + '</p>' : '');

    var chart;
    if (isAll) {
      var ys = Object.keys(perYear).map(Number).sort(function (a, b) { return a - b; });
      var maxY = Math.max.apply(null, ys.map(function (y) { return perYear[y]; }).concat([1]));
      chart = '<section class="panel"><div class="section-head"><h2 class="h2 display">.Films par année</h2></div>' +
        (ys.length ? '<div class="months-wrap"><div class="months" style="grid-template-columns:repeat(' + ys.length + ', minmax(40px, 1fr));min-width:' + Math.max(300, ys.length * 52) + 'px" role="img" aria-label="Films vus par année : ' +
          ys.map(function (y) { return y + ' ' + perYear[y]; }).join(', ') + '">' +
          ys.map(function (y) {
            return '<div class="month"><span class="month__v num">' + perYear[y] + '</span><span class="month__bar' + (perYear[y] === maxY ? ' month__bar--top' : '') + '" style="height:' + Math.max(3, Math.round(perYear[y] / maxY * 160)) + 'px"></span><span class="label">' + y + '</span></div>';
          }).join('') + '</div></div>' : '<p class="muted">Pas encore de films.</p>') + '</section>';
    } else {
      var max = Math.max.apply(null, months.concat([1]));
      var maxMonth = months.indexOf(max);
      var curM = new Date().getMonth();
      chart = '<section class="panel"><div class="section-head"><h2 class="h2 display">.Films par mois</h2>' +
        (months.some(function (m) { return m > 0; }) ? '<span class="label">Record : ' + MONTHS_LONG[maxMonth] + ' (' + max + ')</span>' : '') + '</div>' +
        '<div class="months-wrap"><div class="months" role="img" aria-label="Films vus par mois en ' + esc(P) + ' : ' +
        months.map(function (v, i) { return MONTHS_LONG[i] + ' ' + v; }).join(', ') + '">' +
        months.map(function (v, i) {
          var future = P === CUR_YEAR && i > curM;
          return '<div class="month"><span class="month__v num">' + (future ? '' : v) + '</span>' +
            '<span class="month__bar' + (v === max && v > 0 && i === maxMonth ? ' month__bar--top' : '') + '" style="height:' + (future ? 3 : Math.max(3, Math.round(v / max * 160))) + 'px' + (future ? ';background:var(--sand)' : '') + '"></span>' +
            '<span class="label">' + MONTHS[i] + '</span></div>';
        }).join('') + '</div></div></section>';
    }

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
    var colors = ['var(--accent)', 'var(--fg)', 'var(--sand)', 'var(--soft)', 'var(--paper)'];
    var splitHTML = movieViews.length ? '<div class="split" aria-hidden="true">' + lieuList.map(function (l) {
      return '<span style="width:' + (lieux[l] / movieViews.length * 100) + '%"></span>';
    }).join('') + '</div><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">' +
      lieuList.map(function (l, i) {
        return '<li class="stat-line"><span><span class="dot" style="background:' + colors[i] + '"></span>' + esc(l) + '</span><span class="num">' + lieux[l] + '</span></li>';
      }).join('') + '</ul>' : '<span class="muted">Aucun film vu sur cette période.</span>';

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

    return '<div class="stack">' + head + kpis + chart +
      '<div class="stat-cols">' +
      '<section class="stat-box"><h2 class="h3 display">.Genres</h2>' + genresHTML + '</section>' +
      '<section class="stat-box"><h2 class="h3 display">.Où je regarde mes films</h2>' + splitHTML + '</section>' +
      '<section class="stat-box stat-box--ink"><h2 class="h3 display">.Réalisateurs</h2><ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">' + dirsHTML + '</ol>' +
      '<span style="margin-top:auto">' + plural(rewatch, 'revisionnage', 'revisionnages') + (isAll ? ' au total' : ' cette année') + '</span></section>' +
      '</div></div>';
  }

  /* ---------- Fiche ---------- */
  function isManualId(id) { return Number(id) < 0; }
  function newManualId() { return -(Math.floor(Math.random() * 2000000000) + 1); }

  function loadDetail(type, id) {
    var k = key(type, id);
    if (state.detailLoading[k]) return;
    state.detailLoading[k] = true;
    TMDB.details(type, id).then(function (d) {
      state.details[k] = d;
      if (!d.recoGroups) {
        TMDB.recommend(d).then(function (groups) {
          d.recoGroups = groups || [];
          // Numéro du film dans la saga, quand le catalogue ne le donne pas
          var sg = d.recoGroups.filter(function (g) { return g.key === 'saga'; })[0];
          var me = sg ? sg.items.filter(function (x) { return x.current; })[0] : null;
          if (d.saga && me && me.order && !d.saga.order) {
            d.saga.order = me.order;
            var en = findEntry(type, id);
            if (en && refreshFromDetail(en, d)) persist(en).catch(function () {});
          }
          render();
        });
      }
      var e = findEntry(type, id);
      if (e && refreshFromDetail(e, d)) persist(e).then(render).catch(function () {});
      render();
    }).catch(function (err) {
      state.detailErr[k] = err && err.message ? err.message : String(err);
      render();
    }).then(function () { state.detailLoading[k] = false; });
  }

  function recoGroupsFor(type, id, d, info) {
    var groups = d && d.recoGroups ? d.recoGroups.map(function (g) { return { key: g.key, title: g.title, items: (g.items || []).slice(0, 6) }; }) : [];
    var myGenres = info.genres || [];
    if (myGenres.length) {
      var genreGroup = groups.filter(function (g) { return g.key === 'genre'; })[0];
      if (!genreGroup) { genreGroup = { key: 'genre', title: 'Du même genre · ' + myGenres[0], items: [] }; groups.push(genreGroup); }
      var taken = {};
      groups.forEach(function (g) { g.items.forEach(function (r) { taken[r.media_type + r.tmdb_id] = 1; }); });
      // Les titres de ta liste À voir passent en premier
      var mine = state.entries.filter(function (x) {
        return x.status === 'a_voir' && !(x.media_type === type && String(x.tmdb_id) === String(id)) && !taken[x.media_type + x.tmdb_id] &&
          x.genres.some(function (g) { return myGenres.indexOf(g) !== -1; });
      }).slice(0, 3).map(function (x) {
        return { tmdb_id: x.tmdb_id, media_type: x.media_type, title: x.title, year: x.year, fromList: true };
      });
      genreGroup.items = mine.concat(genreGroup.items).slice(0, 6);
    }
    return groups.filter(function (g) { return g.items.length; });
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
    var saga = (d && d.saga) || sagaOf(e);
    var seasonsList = (d && d.seasons && d.seasons.length) ? d.seasons : (e ? e.seasons : []);
    var meta = [isTv ? 'Série' : 'Film', info.year, (info.genres || []).slice(0, 2).join(', '),
      isTv ? plural(seasonsList.length, 'saison', 'saisons') : fmtDur(info.runtime)].filter(Boolean).join(' · ');

    /* Colonne de gauche : affiche et actions */
    var shown = Object.assign({}, info, { poster_path: (e && e.poster_path) || info.poster_path });
    var side = '<aside class="fiche__side">' + poster(shown) + '<div class="side-actions">';
    if (act) {
      side += '<span class="in-lib">' + ICON.check + 'Dans ta vidéothèque</span>';
      side += '<button type="button" class="btn btn--accent" data-act="seen-this" data-type="' + type + '" data-id="' + esc(id) + '">' + (isTv ? 'Mettre à jour mes saisons' : 'Je l\'ai revu') + '</button>';
    } else {
      side += '<button type="button" class="btn btn--accent" data-act="seen-this" data-type="' + type + '" data-id="' + esc(id) + '">Ajouter à ma vidéothèque</button>';
      if (!e) side += '<button type="button" class="btn" data-act="add-towatch" data-type="' + type + '" data-id="' + esc(id) + '">+ À voir</button>';
      else side += '<span class="tag" style="align-self:flex-start;border:2px solid var(--line)">Dans ta liste À voir</span>' + confirmBtn('entry:' + e.id, 'Retirer de À voir');
    }
    if (isTv && e && act && e.status !== 'vu') {
      side += '<button type="button" class="btn" data-act="abandon" data-id="' + esc(e.id) + '">' + (e.status === 'abandonne' ? 'Reprendre la série' : 'J\'abandonne') + '</button>';
    }
    if (manual && e) side += '<button type="button" class="btn" data-act="edit-manual" data-id="' + esc(e.id) + '">Modifier les infos</button>';
    if (e) side += '<button type="button" class="linkish" data-act="edit-poster" data-id="' + esc(e.id) + '">' + (e.poster_path ? 'Changer l\'affiche' : 'Ajouter une affiche') + '</button>';
    side += '</div></aside>';

    /* En-tête */
    var main = '<div class="section"><span class="label">' + esc(meta) + (e ? ' · ' + esc(STATUS_LABEL[e.status]) : '') + (manual ? ' · Ajouté à la main' : '') + '</span>' +
      '<h1 class="fiche__title display">.' + esc(info.title) + '</h1>' +
      (info.director ? '<span>' + (isTv ? 'Créée par ' : 'Réalisé par ') + '<b>' + esc(info.director) + '</b></span>' : '') +
      (saga && !isTv ? '<span>Saga <b>' + esc(saga.label) + '</b>' + (saga.order ? ' · film n° ' + esc(saga.order) : '') + '</span>' : '') +
      (d && d.overview ? '<p class="overview">' + esc(d.overview) + '</p>' : '') +
      '<span>' + googleLink(info.title + (info.year ? ' ' + info.year : ''), type) + '</span></div>';

    /* Faits, notes, avis */
    if (e && act) {
      if (!isTv) {
        var vs = e.viewings.slice().sort(function (a, b) { return recKey(b).localeCompare(recKey(a)); });
        var last = vs[0];
        main += '<div class="facts">' +
          '<div><span class="label">Vu le</span><span>' + esc(last.date ? fmtDate(last.date) : last.year ? 'En ' + last.year : 'Je ne sais plus') +
          ' <button type="button" class="linkish" style="font-size:14px" data-act="edit-rec" data-id="' + esc(e.id) + '" data-vid="' + esc(last.id) + '">modifier</button></span></div>' +
          '<div><span class="label">Où</span><span>' + esc(last.lieu) + ' · ' + esc(last.version) + '</span></div>' +
          '<div><span class="label">Avec</span><span>' + esc(last.avec || 'Seul·e') + '</span></div>' +
          '<div><span class="label">Visionnages</span><span>' + (vs.length === 1 ? '1re fois' : vs.length + ' fois') + '</span></div></div>';
      } else {
        var lr = lastRec(e);
        main += '<div class="facts">' +
          '<div><span class="label">Progression</span><span class="num">' + seasonsSeen(e) + ' / ' + plural(sortedSeasons(e).length, 'saison vue', 'saisons vues') + '</span></div>' +
          '<div><span class="label">Dernière mise à jour</span><span>' + esc(lr ? (lr.date ? fmtDate(lr.date) : lr.year ? 'En ' + lr.year : 'Date inconnue') : '') + '</span></div>' +
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

      main += '<section class="section field"><label class="h2 display" for="avis">.Mon avis</label>' +
        '<textarea id="avis" data-input="avis" data-id="' + esc(e.id) + '" rows="4" placeholder="Ce que tu en as pensé, une scène, une réplique…">' + esc(e.avis) + '</textarea>' +
        '<span class="saved" id="avis-state" role="status">Privé : visible par toi seul.</span></section>';
    } else {
      main += '<div class="empty"><span class="h3 display">Pas encore dans ta vidéothèque</span>' +
        '<span>Ajoute-le avec le bouton rouge pour le noter et écrire ton avis.</span></div>';
    }

    /* Saisons */
    if (isTv && seasonsList.length) {
      var ent = e || newEntry(info);
      if (!ent.seasons.length) ent.seasons = seasonsList.slice();
      var ss = sortedSeasons(ent);
      var n = nextSeason(ent);
      var seenS = seasonsSeen(ent);
      main += '<section class="section"><div class="section-head"><h2 class="h2 display">.Saisons</h2><span class="label num">' + seenS + ' / ' + ss.length + ' vues</span></div>' +
        '<span class="bar"><span style="width:' + (ss.length ? Math.round(seenS / ss.length * 100) : 0) + '%"></span></span>' +
        (n ? '<span><button type="button" class="btn btn--accent" data-act="season-done" data-type="tv" data-tid="' + esc(id) + '" data-s="' + n.n + '">J\'ai fini la saison ' + n.n + '</button></span>' : '<p style="margin:0" class="label">Série terminée</p>') +
        '<div class="seasons">' + ss.map(function (s) {
          var st = seasonState(ent, s.n), r = seasonRec(ent, s.n);
          function b(val, label, accent) {
            return '<button type="button"' + (accent ? ' class="seg--accent"' : '') + ' data-act="season-set" data-tid="' + esc(id) + '" data-s="' + s.n + '" data-st="' + val + '" aria-pressed="' + (st === val) + '">' + label + '</button>';
          }
          return '<div class="season-row"><span style="display:flex;flex-direction:column;gap:4px"><span class="season-row__name">Saison ' + s.n + '</span>' +
            '<span class="muted" style="font-size:14px">' + plural(s.count, 'épisode', 'épisodes') + (r ? ' · ' + esc(st === 'vu' ? 'vue' : 'commencée') + ' ' + esc(r.date ? 'le ' + fmtDate(r.date) : r.year ? 'en ' + r.year : '(date inconnue)') : '') +
            (r && e ? ' <button type="button" class="linkish" style="font-size:14px" data-act="edit-rec" data-id="' + esc(e.id) + '" data-s="' + s.n + '">modifier la date</button>' : '') + '</span></span>' +
            '<div class="seg" role="group" aria-label="Saison ' + s.n + '">' + b('', 'Pas vue') + b('en_cours', 'En cours') + b('vu', 'Vue', true) + '</div></div>';
        }).join('') + '</div>' +
        '<span><button type="button" class="chip" data-act="series-all" data-tid="' + esc(id) + '">' + (seenS === ss.length ? 'Tout remettre à « Pas vue »' : 'J\'ai vu toutes les saisons') + '</button></span></section>';
    }

    /* Historique des visionnages */
    if (e && !isTv && e.viewings.length) {
      main += '<section class="section"><h2 class="h2 display">.Mes visionnages</h2><ul class="history">' +
        e.viewings.slice().sort(function (a, b) { return recKey(b).localeCompare(recKey(a)); }).map(function (v) {
          return '<li><span><b>' + esc(recLabel(v)) + '</b> · ' + esc(v.lieu) + ' · ' + esc(v.version) + (v.avec ? ' · avec ' + esc(v.avec) : '') + (v.rewatch ? ' · revisionnage' : '') + '</span>' +
            '<span class="row__actions"><button type="button" class="danger" data-act="edit-rec" data-id="' + esc(e.id) + '" data-vid="' + esc(v.id) + '">Modifier</button>' +
            confirmBtn('viewing:' + e.id + ':' + v.id, 'Supprimer') + '</span></li>';
        }).join('') + '</ul></section>';
    }

    /* Recommandations en rangées */
    var groups = recoGroupsFor(type, id, d, info);
    var recoLoading = !manual && d && !d.recoGroups;
    if (groups.length || recoLoading) {
      main += '<section class="section"><h2 class="h2 display">.Si tu as aimé</h2>' +
        (recoLoading ? '<p class="label muted" style="margin:0">Recherche de titres proches…</p>' : '') +
        groups.map(function (g) {
          return '<div class="reco-group"><h3 class="h3 display" style="margin:0;font-size:24px">.' + esc(g.title) + '</h3><div class="recos">' + g.items.map(function (r) {
            var mineE = findEntry(r.media_type, r.tmdb_id);
            var status = r.current ? 'tu es ici' : mineE ? (hasActivity(mineE) ? 'déjà vu' : 'dans ta liste') : '';
            var tag = r.fromList ? 'Dans ta liste' : (g.key === 'saga' && r.order ? 'N° ' + r.order : '');
            var inner = (tag ? '<span class="label">' + esc(tag) + '</span>' : '') +
              '<span class="display">' + esc(r.title) + '</span><span style="font-size:13px">' +
              esc([r.media_type === 'tv' ? 'Série' : 'Film', r.year, r.fromList ? '' : status].filter(Boolean).join(' · ')) + '</span>';
            return r.current ? '<span class="reco reco--current" aria-current="page">' + inner + '</span>'
              : '<a class="reco" href="#fiche-' + r.media_type + '-' + r.tmdb_id + '">' + inner + '</a>';
          }).join('') + '</div></div>';
        }).join('') + '</section>';
    }

    if (e && act) {
      main += '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-top:8px;border-top:2px solid var(--line)"><span class="muted" style="font-size:14px">Retirer ce titre et tout son historique :</span>' +
        confirmBtn('entry:' + e.id, 'Supprimer de ma vidéothèque') + '</div>';
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

  function startForm(m, d) {
    var e = findEntry(d.media_type, d.tmdb_id);
    if (e) refreshFromDetail(e, d);
    var ss = (d.seasons || []).slice().sort(function (a, b) { return a.n - b.n; });
    var n = e ? nextSeason(e) : null;
    m.detail = d;
    m.loading = false;
    m.step = 'form';
    m.err = '';
    m.form = {
      when: 'today', date: todayISO(), year: '', lieu: 'Streaming', version: 'VO', avec: '',
      note: e && e.notes.gen ? e.notes.gen : 0, rewatch: !!(e && e.viewings.length),
      season: n ? n.n : (ss[0] ? ss[0].n : 1), current: !!(n && n.st === 'en_cours')
    };
    render();
  }

  function pick(type, id) {
    var m = state.modal;
    if (!m) return;
    if (m.mode === 'search') { state.modal = null; go('fiche-' + type + '-' + id); return; }
    if (isManualId(id)) {
      var me = findEntry(type, id);
      if (me) startForm(m, Object.assign({ overview: '' }, me));
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
    if (m.loading) return '<p class="label">Recherche…</p>';
    if (m.err) return '<p class="msg msg--err">' + esc(m.err) + '</p>' + manualBtn;
    if (!m.q.trim()) {
      return '<div style="display:flex;flex-direction:column;gap:12px"><p class="muted" style="margin:0">' + esc(TMDB.hint()) + '</p>' + manualBtn + '</div>';
    }
    var q = m.q.trim().toLowerCase();
    var local = state.entries.filter(function (e) { return isManualId(e.tmdb_id) && e.title.toLowerCase().indexOf(q) !== -1; })
      .map(function (e) { return { tmdb_id: e.tmdb_id, media_type: e.media_type, title: e.title, year: e.year, poster_path: e.poster_path }; });
    var all = local.concat(m.results);
    if (!all.length) {
      return '<div style="display:flex;flex-direction:column;gap:12px"><p style="margin:0">Aucun résultat pour « ' + esc(m.q) + ' ».</p>' +
        '<span style="display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center"><button type="button" class="btn btn--ink" data-act="m-manual">Ajouter « ' + esc(m.q.trim()) + ' » à la main</button>' + g + '</span></div>';
    }
    return '<ul class="results">' + all.map(function (r) {
      var mine = findEntry(r.media_type, r.tmdb_id);
      var inLib = hasActivity(mine);
      var main = '<button type="button" class="result" data-act="m-pick" data-type="' + r.media_type + '" data-id="' + r.tmdb_id + '">' + poster(r, { thumb: true }) +
        '<span style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="result__title">' + esc(r.title) + '</span>' +
        '<span class="label">' + (r.media_type === 'tv' ? 'Série' : 'Film') + (r.year ? ' · ' + r.year : '') + (isManualId(r.tmdb_id) ? ' · ajouté à la main' : '') +
        (mine ? ' · ' + (inLib ? 'dans ta vidéothèque' : 'dans ta liste À voir') : '') + '</span></span></button>';
      var quick = m.mode === 'search'
        ? '<button type="button" class="quick" data-act="m-quickadd" data-type="' + r.media_type + '" data-id="' + r.tmdb_id + '" aria-label="Ajouter ' + esc(r.title) + ' à ma vidéothèque">' + (inLib ? 'Mettre à jour' : '+ Vidéo&shy;thèque') + '</button>' : '';
      return '<li class="result-row">' + main + quick + '</li>';
    }).join('') + '</ul><div style="margin-top:12px">' + manualBtn + '</div>';
  }

  function chipGroup(field, options, cur, labelText) {
    return '<div class="field"><span class="label" id="lbl-' + field + '">' + labelText + '</span><div class="chips" role="group" aria-labelledby="lbl-' + field + '">' +
      options.map(function (o) {
        var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
        return '<button type="button" class="chip" data-act="m-set" data-f="' + field + '" data-v="' + esc(v) + '" aria-pressed="' + (cur === v) + '">' + esc(l) + '</button>';
      }).join('') + '</div></div>';
  }

  function whenFields(f) {
    var h = chipGroup('when', [['today', 'Aujourd\'hui'], ['yesterday', 'Hier'], ['other', 'Autre date'], ['unknown', 'Je ne sais plus']], f.when, 'Quand');
    if (f.when === 'other') {
      h += '<div class="field"><label class="label" for="m-date">Date</label><input id="m-date" type="date" max="' + todayISO() + '" value="' + esc(f.date) + '" data-input="m-date"></div>';
    }
    if (f.when === 'unknown') {
      h += '<div class="field"><label class="label" for="m-year">Je me souviens de l\'année (facultatif)</label>' +
        '<span class="year-pick"><input id="m-year" type="number" min="1900" max="' + CUR_YEAR + '" placeholder="ex. 2019" value="' + esc(f.year) + '" data-input="m-year"></span>' +
        '<span class="note">Sans année, il comptera dans tes stats ' + CUR_YEAR + ', l\'année où tu l\'enregistres.</span></div>';
    }
    return h;
  }

  function viewModal() {
    var m = state.modal;
    if (m.mode === 'poster') return posterModalHTML();
    if (m.mode === 'editrec') return editRecHTML();
    var title = m.mode === 'edit' ? 'Modifier les infos' : m.step === 'manual' ? 'Ajout à la main' : m.mode === 'search' ? 'Rechercher' : m.mode === 'towatch' ? 'Ajouter à À voir' : 'Ma vidéothèque';
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
      var already = hasActivity(e);
      body = '<div class="picked">' + poster(Object.assign({}, d, { poster_path: (e && e.poster_path) || d.poster_path }), { thumb: true }) +
        '<span style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px"><span class="result__title">' + esc(d.title) + '</span>' +
        '<span class="label">' + (isTv ? 'Série' : 'Film') + (d.year ? ' · ' + d.year : '') + (d.director ? ' · ' + esc(d.director) : '') + '</span></span>' +
        '<button type="button" class="linkish" style="color:inherit" data-act="m-back">Changer</button></div>';
      if (m.mode === 'towatch') {
        body += e ? '<p class="msg">Ce titre est déjà dans ton journal' + (already ? ', dans ta vidéothèque.' : ', dans ta liste À voir.') + '</p>'
          : '<p style="margin:0">Il apparaîtra dans ta liste À voir et sur ton journal.</p>';
        foot = '<button type="button" class="btn" data-act="close-modal">Annuler</button>' + (e ? '' : '<button type="button" class="btn btn--accent" data-act="m-towatch">Ajouter à À voir</button>');
      } else {
        if (already) {
          var lr = lastRec(e);
          body += isTv
            ? '<p class="msg"><b>Déjà dans ta vidéothèque</b> (' + seasonsSeen(e) + ' / ' + plural(sortedSeasons(e).length, 'saison vue', 'saisons vues') + '). Tu mets à jour ta progression.</p>'
            : '<p class="msg"><b>Déjà dans ta vidéothèque</b> (vu ' + esc(lr && lr.date ? 'le ' + fmtDate(lr.date) : lr && lr.year ? 'en ' + lr.year : 'à une date inconnue') + '). Ce visionnage sera ajouté comme un revisionnage.</p>';
        }
        if (isTv) {
          var ss = (d.seasons || []).slice().sort(function (a, b) { return a.n - b.n; });
          if (!ss.length) body += '<p class="msg msg--err">Aucune saison connue pour cette série.</p>';
          else {
            body += '<div class="field"><label class="label" for="m-season">Jusqu\'à quelle saison ?</label>' +
              '<select id="m-season" data-change="m-season" style="min-height:46px;border:2px solid var(--line);background:var(--paper);padding:0 10px">' +
              ss.map(function (s) { return '<option value="' + s.n + '"' + (s.n === f.season ? ' selected' : '') + '>Saison ' + s.n + ' (' + plural(s.count, 'épisode', 'épisodes') + ')</option>'; }).join('') + '</select>' +
              '<label class="check"><input id="m-current" type="checkbox" data-change="m-current"' + (f.current ? ' checked' : '') + '><span>Je suis en train de regarder cette saison</span></label>' +
              '<span class="note">Les saisons d\'avant seront marquées comme vues.</span></div>';
          }
        }
        body += whenFields(f);
        if (!isTv) {
          body += chipGroup('lieu', LIEUX, f.lieu, 'Où');
          body += chipGroup('version', [['VO', 'VO'], ['VF', 'VF']], f.version, 'Version');
          body += '<div class="field"><label class="label" for="m-avec">Avec qui (facultatif)</label><input id="m-avec" type="text" maxlength="80" data-input="m-avec" value="' + esc(f.avec) + '"></div>';
        }
        body += '<div class="field"><span class="label">' + (isTv ? 'Note de la série' : 'Note générale') + ' (facultatif)</span>' + cells('m-note', 'gen', f.note, 'Note', true) + '</div>';
        if (!isTv && !already) {
          body += '<label class="check"><input id="m-rewatch" type="checkbox" data-change="m-rewatch"' + (f.rewatch ? ' checked' : '') + '><span>Je l\'avais déjà vu avant (revisionnage)</span></label>';
        }
        foot = (e ? '' : '<button type="button" class="btn" data-act="m-towatch">Plutôt À voir</button>') +
          '<button type="button" class="btn btn--accent" data-act="m-save"' + (isTv && !(d.seasons || []).length ? ' disabled' : '') + '>' + (already ? 'Enregistrer' : 'Ajouter à ma vidéothèque') + '</button>';
      }
    }
    return '<div class="overlay" data-act="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="dialog__head"><span class="display" id="m-title">.' + esc(title) + '</span>' +
      '<button type="button" class="icon-btn" data-act="close-modal" aria-label="Fermer">' + ICON.close + '</button></div>' +
      '<div class="dialog__body">' + body + '</div>' + (foot ? '<div class="dialog__foot">' + foot + '</div>' : '') + '</div></div>';
  }

  function recFromForm(f) {
    var today = todayISO();
    if (f.when === 'unknown') {
      var y = parseInt(f.year, 10);
      return { date: null, year: y >= 1900 && y <= CUR_YEAR ? y : null, added: today };
    }
    var date = f.when === 'today' ? today : f.when === 'yesterday' ? yesterdayISO() : (f.date || today);
    return { date: date, year: null, added: today };
  }

  function saveFromModal() {
    var m = state.modal, d = m.detail, f = m.form;
    var type = d.media_type;
    if (f.when === 'unknown' && f.year !== '' && !(parseInt(f.year, 10) >= 1900 && parseInt(f.year, 10) <= CUR_YEAR)) {
      toast('L\'année doit être entre 1900 et ' + CUR_YEAR + ', ou laisse le champ vide.', true);
      return;
    }
    var e = findEntry(type, d.tmdb_id) || newEntry(d);
    refreshFromDetail(e, d);
    var rec = recFromForm(f);
    if (type === 'movie') {
      e.viewings = e.viewings.concat([Object.assign({ id: uid(), lieu: f.lieu, version: f.version, avec: f.avec.trim(), rewatch: !!(f.rewatch || e.viewings.length) }, rec)]);
    } else {
      e.episodes = Object.assign({}, e.episodes);
      sortedSeasons(e).forEach(function (s) {
        if (s.n > f.season) return;
        var want = s.n < f.season ? 'vu' : (f.current ? 'en_cours' : 'vu');
        var cur = seasonState(e, s.n);
        if (cur === 'vu') return;          // une saison déjà vue reste vue
        if (cur === want) return;
        e.episodes['S' + s.n] = Object.assign({ st: want }, rec);
      });
      if (e.status === 'abandonne') e.status = 'en_cours';
    }
    if (f.note) e.notes = Object.assign({}, e.notes, { gen: f.note });
    persist(e).then(function () {
      state.modal = null;
      toast('Enregistré dans ta vidéothèque');
      go('fiche-' + type + '-' + d.tmdb_id);
    }).catch(function () {});
  }

  /* ---------- Modifier un visionnage (date, lieu…) ou la date d'une saison ---------- */
  function findRec(m) {
    var e = findById(m.entryId);
    if (!e) return null;
    if (m.season) return { e: e, r: seasonRec(e, m.season) };
    return { e: e, r: e.viewings.filter(function (v) { return v.id === m.vid; })[0] };
  }
  function editRecHTML() {
    var m = state.modal, x = findRec(m), f = m.form;
    if (!x || !x.r) return '';
    var body = '<p style="margin:0"><b>' + esc(x.e.title) + '</b>' + (m.season ? ' · saison ' + m.season : '') + '</p>' + whenFields(f);
    if (!m.season) {
      body += chipGroup('lieu', LIEUX, f.lieu, 'Où') + chipGroup('version', [['VO', 'VO'], ['VF', 'VF']], f.version, 'Version') +
        '<div class="field"><label class="label" for="m-avec">Avec qui (facultatif)</label><input id="m-avec" type="text" maxlength="80" data-input="m-avec" value="' + esc(f.avec) + '"></div>' +
        '<label class="check"><input id="m-rewatch" type="checkbox" data-change="m-rewatch"' + (f.rewatch ? ' checked' : '') + '><span>C\'était un revisionnage</span></label>';
    }
    return '<div class="overlay" data-act="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="dialog__head"><span class="display" id="m-title">.' + (m.season ? 'Date de la saison' : 'Modifier le visionnage') + '</span>' +
      '<button type="button" class="icon-btn" data-act="close-modal" aria-label="Fermer">' + ICON.close + '</button></div>' +
      '<div class="dialog__body">' + body + '</div><div class="dialog__foot"><button type="button" class="btn" data-act="close-modal">Annuler</button>' +
      '<button type="button" class="btn btn--accent" data-act="rec-save">Enregistrer</button></div></div></div>';
  }

  /* ---------- Ajout à la main ---------- */
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

  /* ---------- Affiche choisie par l'utilisateur ---------- */
  function posterModalHTML() {
    var m = state.modal, e = findById(m.entryId);
    if (!e) return '';
    var gi = 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(e.title + (e.year ? ' ' + e.year : '') + (e.media_type === 'tv' ? ' série affiche' : ' affiche'));
    var body = '<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">' +
      '<div style="width:150px;flex:0 0 150px">' + poster({ title: e.title, poster_path: m.preview }) + '</div>' +
      '<div style="flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:16px">' +
      '<div class="field"><label class="label" for="pf-file">Une image de ton appareil</label>' +
      '<input id="pf-file" type="file" accept="image/*" data-change="pf-file" style="padding:10px;min-height:0"></div>' +
      '<form class="field" data-form="poster-url"><label class="label" for="pf-url">Ou l\'adresse d\'une image</label>' +
      '<span style="display:flex;flex-wrap:wrap;gap:8px"><input id="pf-url" type="url" placeholder="https://…" style="flex:1 1 180px;min-width:0">' +
      '<button type="submit" class="btn btn--small">Voir</button></span></form>' +
      '<span style="font-size:14px">Astuce : sur <a class="link" href="' + esc(gi) + '" target="_blank" rel="noopener">Google Images ↗</a>, clic droit (ou appui long) sur une affiche, puis « Copier l\'adresse de l\'image ».</span>' +
      (m.busy ? '<p class="label" style="margin:0">Préparation de l\'image…</p>' : '') +
      (m.err ? '<p class="msg msg--err" role="alert" style="margin:0">' + esc(m.err) + '</p>' : '') +
      '</div></div>';
    var foot = (m.preview ? '<button type="button" class="btn" data-act="pf-remove">Sans affiche</button>' : '') +
      '<button type="button" class="btn" data-act="close-modal">Annuler</button>' +
      '<button type="button" class="btn btn--accent" data-act="pf-save"' + (m.busy ? ' disabled' : '') + '>Enregistrer</button>';
    return '<div class="overlay" data-act="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="dialog__head"><span class="display" id="m-title">.Affiche</span>' +
      '<button type="button" class="icon-btn" data-act="close-modal" aria-label="Fermer">' + ICON.close + '</button></div>' +
      '<div class="dialog__body">' + body + '</div><div class="dialog__foot">' + foot + '</div></div></div>';
  }

  // Réduit l'image à 342 px de large (JPEG) pour qu'elle reste légère dans la base
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Choisis un fichier image (JPG, PNG, WebP…).')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Impossible de lire ce fichier.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Ce fichier n\'est pas une image lisible.')); };
        img.onload = function () {
          var w = Math.min(342, img.naturalWidth || 342);
          var h = Math.round(w * (img.naturalHeight || 513) / (img.naturalWidth || 342));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- Mon compte ---------- */
  function accMsg(k) {
    var a = state.ui.account;
    return (a.msg[k] ? '<p class="msg" role="status" style="margin:0">' + esc(a.msg[k]) + '</p>' : '') +
      (a.err[k] ? '<p class="msg msg--err" role="alert" style="margin:0">' + esc(a.err[k]) + '</p>' : '');
  }
  function viewAccount() {
    var demo = store.demo;
    var email = demo ? '' : (state.user && state.user.email) || '';
    var nb = state.entries.length, seen = state.entries.filter(hasActivity).length;
    var h = '<div class="stack"><div class="section"><span class="eyebrow">.' + esc(demo ? 'Mode démo' : email) + '</span><h1 class="h1 display">.Mon compte</h1></div>' +
      (demo ? '<p class="msg" style="margin:0">En mode démo, il n\'y a pas de compte : l\'e-mail, le mot de passe et la suppression du compte s\'activent quand Supabase est configuré.</p>' : '') +
      '<div class="account-grid">';

    if (!demo) {
      h += '<section class="panel"><h2 class="h3 display">.Adresse e-mail</h2><p class="note">Actuelle : <b>' + esc(email) + '</b></p>' +
        '<form data-form="acc-email" novalidate><div class="field"><label class="label" for="acc-email">Nouvelle adresse</label><input id="acc-email" type="email" autocomplete="email"></div>' +
        '<span><button type="submit" class="btn btn--small">Changer mon e-mail</button></span></form>' + accMsg('email') + '</section>';
      h += '<section class="panel"><h2 class="h3 display">.Mot de passe</h2>' +
        '<form data-form="acc-pw" novalidate><div class="field"><label class="label" for="acc-pw1">Nouveau mot de passe</label><input id="acc-pw1" type="password" minlength="6" autocomplete="new-password"></div>' +
        '<div class="field"><label class="label" for="acc-pw2">Confirme-le</label><input id="acc-pw2" type="password" minlength="6" autocomplete="new-password"></div>' +
        '<span><button type="submit" class="btn btn--small">Changer mon mot de passe</button></span></form>' + accMsg('pw') + '</section>';
    }

    h += '<section class="panel"><h2 class="h3 display">.Objectif ' + CUR_YEAR + '</h2><p class="note">Nombre de films que tu veux voir cette année (' + filmsInYear(CUR_YEAR) + ' pour l\'instant).</p>' +
      '<form data-form="acc-goal" novalidate><div class="field"><label class="label" for="acc-goal">Films</label><input id="acc-goal" type="number" min="1" max="999" value="' + (state.goal || '') + '" placeholder="ex. 52"></div>' +
      '<span><button type="submit" class="btn btn--small">Enregistrer</button></span></form>' + accMsg('goal') + '</section>';

    h += '<section class="panel"><h2 class="h3 display">.Exporter mes données</h2><p class="note">' + plural(nb, 'titre', 'titres') + ' dans ton journal, dont ' + seen + ' dans ta vidéothèque. Garde une copie de sauvegarde quand tu veux.</p>' +
      '<span style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" class="btn btn--small" data-act="export-json">Sauvegarde complète (JSON)</button>' +
      '<button type="button" class="btn btn--small" data-act="export-csv">Tableur (CSV)</button></span>' + accMsg('export') + '</section>';

    h += '<section class="panel panel--danger"><h2 class="h3 display">.Vider mon journal</h2><p class="note">Efface tous tes films, séries, notes et avis. Ton compte reste actif. C\'est définitif : pense à exporter avant.</p>' +
      '<form data-form="acc-clear" novalidate><div class="field"><label class="label" for="acc-clear">Tape VIDER pour confirmer</label><input id="acc-clear" type="text" autocomplete="off"></div>' +
      '<span><button type="submit" class="btn btn--small">Vider mon journal</button></span></form>' + accMsg('clear') + '</section>';

    var pc = paraCard();
    if (pc) h += '<section class="panel"><h2 class="h3 display">.Tu veux la même chose pour les livres ?</h2>' + pc + '</section>';

    if (!demo) {
      h += '<section class="panel panel--danger"><h2 class="h3 display">.Supprimer mon compte</h2><p class="note">Supprime ton compte et toutes tes données. C\'est définitif et immédiat.</p>' +
        '<form data-form="acc-delete" novalidate><div class="field"><label class="label" for="acc-delete">Tape SUPPRIMER pour confirmer</label><input id="acc-delete" type="text" autocomplete="off"></div>' +
        '<span><button type="submit" class="btn btn--small btn--accent">Supprimer mon compte</button></span></form>' + accMsg('delete') + '</section>';
      h += '<section class="panel"><h2 class="h3 display">.Se déconnecter</h2><p class="note">Tes données restent enregistrées. Tu pourras te reconnecter sur n\'importe quel appareil.</p>' +
        '<span><button type="button" class="btn btn--small btn--ink" data-act="logout">Me déconnecter</button></span></section>';
    }
    return h + '</div></div>';
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var rows = [['Type', 'Titre', 'Année de sortie', 'Statut', 'Note', 'Réalisateur / créateur', 'Genres', 'Saga', 'Nombre de visionnages', 'Dernier visionnage', 'Saisons vues', 'Avis']];
    state.entries.slice().sort(function (a, b) { return a.title.localeCompare(b.title, 'fr'); }).forEach(function (e) {
      var lr = lastRec(e);
      rows.push([e.media_type === 'tv' ? 'Série' : 'Film', e.title, e.year || '', STATUS_LABEL[e.status], e.notes.gen || '', e.director, e.genres.join(', '),
        sagaOf(e) ? sagaOf(e).label : '', e.media_type === 'movie' ? e.viewings.length : '', lr ? (lr.date || (lr.year ? String(lr.year) : 'inconnue')) : '',
        e.media_type === 'tv' ? seasonsSeen(e) + '/' + sortedSeasons(e).length : '', e.avis]);
    });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
  }

  /* ---------- Comment ça marche ---------- */
  var HOWTO = [
    ['Cherche un titre', 'Tape un film, une série ou un réalisateur dans la barre de recherche. Introuvable ? Ajoute-le à la main en deux secondes, ou vérifie sur Google.'],
    ['Ajoute-le à ta vidéothèque', 'Bouton « J\'ai vu… » ou « + Vidéothèque » : indique quand (aujourd\'hui, hier, une date… ou « je ne sais plus »), où, en VO ou en VF, et avec qui.'],
    ['Suis tes séries saison par saison', 'Chaque saison est « Pas vue », « En cours » ou « Vue ». Un clic sur « J\'ai fini la saison » et ta progression avance.'],
    ['Note et écris ton avis', 'Note sur 5 cases : scénario, réalisation, acteurs, émotion, musique. Ton avis est privé, toi seul le vois. Tu peux corriger une date à tout moment.'],
    ['Garde une liste À voir', 'Mets de côté ce qui te tente. Le soir, dis combien de minutes tu as et Séquence choisit un film de ta liste qui tient dans ce temps.'],
    ['Découvre et fais le bilan', 'Sur chaque fiche : la saga dans l\'ordre, les films du même réalisateur, du même genre. Dans Stats : ton année, tes genres, ton objectif.']
  ];
  function howtoHTML() {
    return '<ol class="howto">' + HOWTO.map(function (h) { return '<li><b>' + esc(h[0]) + '</b><span>' + esc(h[1]) + '</span></li>'; }).join('') + '</ol>' +
      '<p class="note" style="margin:0">Ton journal est privé : personne d\'autre ne voit tes films, tes notes ni tes avis. Tu peux tout exporter ou tout supprimer depuis « Mon compte ».</p>';
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
    var help = a.tab === 'help';
    var tabs = a.mode === 'newpw' ? '' : '<div class="auth-tabs" role="tablist">' +
      '<button type="button" role="tab" aria-selected="' + !help + '" data-act="auth-tab" data-v="form">' + (a.mode === 'signup' ? 'Créer un compte' : 'Connexion') + '</button>' +
      '<button type="button" role="tab" aria-selected="' + help + '" data-act="auth-tab" data-v="help">Comment ça marche</button></div>';
    if (help) {
      return '<main class="auth wrap"><div class="auth__box auth__box--wide">' +
        '<span class="auth__logo" aria-hidden="true">.SÉQUEN-<br><span>CE</span></span>' + tabs +
        '<h1 class="h2 display">.Comment ça marche</h1>' + howtoHTML() +
        '<span style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" class="btn btn--accent" data-act="auth-mode" data-v="signup">Créer mon compte</button>' +
        '<button type="button" class="btn" data-act="auth-mode" data-v="login">J\'ai déjà un compte</button></span></div></main>' + footer();
    }
    return '<main class="auth wrap"><div class="auth__box">' +
      '<span class="auth__logo" aria-hidden="true">.SÉQUEN-<br><span>CE</span></span>' +
      '<p style="margin:0;font-size:18px">Ton journal privé de films et de séries.</p>' + tabs +
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
    if (/already registered|already been registered/i.test(msg)) return 'Un compte existe déjà avec cet e-mail.';
    if (/at least 6|Password should be/i.test(msg)) return 'Le mot de passe doit faire au moins 6 caractères.';
    if (/different from the old/i.test(msg)) return 'Le nouveau mot de passe doit être différent de l\'ancien.';
    if (/rate limit/i.test(msg)) return 'Trop de tentatives. Réessaie dans quelques minutes.';
    return msg;
  }

  /* ---------- Rendu et navigation ---------- */
  function parseRoute() {
    var h = location.hash.replace(/^#/, '');
    try { h = decodeURIComponent(h); } catch (e) { /* lien mal formé */ }
    var m = h.match(/^fiche-(movie|tv)-(-?\d+)$/);
    if (m) return { name: 'fiche', type: m[1], id: m[2] };
    if (['journal', 'videotheque', 'a-voir', 'stats', 'compte'].indexOf(h) >= 0) return { name: h };
    return { name: 'journal' };
  }
  function go(h) {
    if (location.hash === '#' + h) { state.route = parseRoute(); render(); }
    else location.hash = h;
  }

  var TITLES = { journal: 'Journal', videotheque: 'Vidéothèque', 'a-voir': 'À voir', stats: 'Stats', compte: 'Mon compte' };
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
    else if (r.name === 'compte') body = viewAccount();
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
    } else if (active && document.getElementById(active) && active !== 'avis' && active !== 'pf-file') {
      document.getElementById(active).focus();
    }
  }

  window.addEventListener('hashchange', function () {
    state.route = parseRoute();
    state.ui.confirm = null;
    state.ui.tonight = null;
    state.ui.account = { msg: {}, err: {} };
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
  function setSeason(e, n, st) {
    e.episodes = Object.assign({}, e.episodes);
    if (!st) delete e.episodes['S' + n];
    else {
      var prev = e.episodes['S' + n];
      var today = todayISO();
      e.episodes['S' + n] = prev && prev.st === st ? prev : { st: st, date: today, year: null, added: today };
    }
    if (e.status === 'abandonne' && st) e.status = 'en_cours';
  }
  function accSet(k, msg, err) {
    var a = state.ui.account;
    a.msg[k] = msg || ''; a.err[k] = err || '';
    render();
  }

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
    'season-done': function (t) {
      var e = t.dataset.id ? findById(t.dataset.id) : entryFor('tv', t.dataset.tid);
      if (!e) return;
      var n = parseInt(t.dataset.s, 10);
      setSeason(e, n, 'vu');
      persist(e).then(function () { toast('Saison ' + n + ' vue'); render(); }).catch(function () {});
    },
    'season-set': function (t) {
      var e = entryFor('tv', t.dataset.tid); if (!e) return;
      setSeason(e, parseInt(t.dataset.s, 10), t.dataset.st);
      persist(e).then(render).catch(function () {});
    },
    'series-all': function (t) {
      var e = entryFor('tv', t.dataset.tid); if (!e) return;
      var all = seasonsSeen(e) === sortedSeasons(e).length;
      sortedSeasons(e).forEach(function (s) { setSeason(e, s.n, all ? '' : 'vu'); });
      persist(e).then(render).catch(function () {});
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
    'abandon': function (t) {
      var e = findById(t.dataset.id); if (!e) return;
      e.status = e.status === 'abandonne' ? 'en_cours' : 'abandonne';
      persist(e).then(function (s) { toast(s.status === 'abandonne' ? 'Série marquée comme abandonnée' : 'Série reprise'); render(); }).catch(function () {});
    },
    'm-pick': function (t) { pick(t.dataset.type, t.dataset.id); },
    'm-quickadd': function (t) { state.modal.mode = 'add'; pick(t.dataset.type, t.dataset.id); },
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
      if (m.mode === 'search') m.mode = 'add';
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
    'edit-poster': function (t) {
      var e = findById(t.dataset.id); if (!e) return;
      state.modal = { mode: 'poster', step: 'poster', entryId: e.id, preview: e.poster_path || null, err: '', busy: false, focus: false };
      render();
    },
    'edit-rec': function (t) {
      var e = findById(t.dataset.id); if (!e) return;
      var season = t.dataset.s ? parseInt(t.dataset.s, 10) : null;
      var r = season ? seasonRec(e, season) : e.viewings.filter(function (v) { return v.id === t.dataset.vid; })[0];
      if (!r) return;
      state.modal = {
        mode: 'editrec', step: 'editrec', entryId: e.id, vid: t.dataset.vid || null, season: season, focus: false,
        form: { when: r.date ? 'other' : 'unknown', date: r.date || todayISO(), year: r.year || '', lieu: r.lieu || 'Streaming',
          version: r.version || 'VO', avec: r.avec || '', rewatch: !!r.rewatch }
      };
      render();
    },
    'rec-save': function () {
      var m = state.modal, x = findRec(m), f = m.form;
      if (!x || !x.r) { closeModal(); return; }
      if (f.when === 'unknown' && f.year !== '' && !(parseInt(f.year, 10) >= 1900 && parseInt(f.year, 10) <= CUR_YEAR)) {
        toast('L\'année doit être entre 1900 et ' + CUR_YEAR + ', ou laisse le champ vide.', true); return;
      }
      if (f.when === 'other' && (!f.date || f.date > todayISO())) { toast('Choisis une date qui n\'est pas dans le futur.', true); return; }
      var rec = recFromForm(f), e = x.e;
      rec.added = x.r.added || rec.added;
      if (m.season) {
        e.episodes = Object.assign({}, e.episodes);
        e.episodes['S' + m.season] = Object.assign({}, x.r, rec);
      } else {
        e.viewings = e.viewings.map(function (v) {
          return v.id !== m.vid ? v : Object.assign({}, v, rec, { lieu: f.lieu, version: f.version, avec: f.avec.trim(), rewatch: !!f.rewatch });
        });
      }
      persist(e).then(function () { state.modal = null; toast('Visionnage modifié'); render(); }).catch(function () {});
    },
    'pf-remove': function () { state.modal.preview = null; state.modal.err = ''; render(); },
    'pf-save': function () {
      var m = state.modal, e = findById(m.entryId); if (!e) { closeModal(); return; }
      e.poster_path = m.preview || null;
      persist(e).then(function () { state.modal = null; toast(e.poster_path ? 'Affiche enregistrée' : 'Affiche retirée'); render(); }).catch(function () {});
    },
    'export-json': function () {
      var data = { application: 'Séquence', exporte_le: new Date().toISOString(), objectif: { annee: CUR_YEAR, films: state.goal }, titres: state.entries };
      download('sequence-sauvegarde-' + todayISO() + '.json', JSON.stringify(data, null, 2), 'application/json');
      accSet('export', 'Fichier de sauvegarde téléchargé.');
    },
    'export-csv': function () {
      download('sequence-' + todayISO() + '.csv', exportCSV(), 'text/csv;charset=utf-8');
      accSet('export', 'Fichier tableur téléchargé. Il s\'ouvre avec Excel, Numbers ou Google Sheets.');
    },
    'auth-mode': function (t) { state.ui.auth = { mode: t.dataset.v, msg: '', err: '', busy: false }; render(); },
    'para-demo': function () { toast('Lien vers Paragraphe : ajoute PARAGRAPHE_URL dans config.js'); },
    'auth-tab': function (t) { state.ui.auth.tab = t.dataset.v; state.ui.auth.err = ''; render(); }
  };

  var forms = {
    goal: function (f) {
      var v = parseInt(f.querySelector('#goal-in').value, 10);
      if (!v || v < 1) { toast('Indique un nombre de films supérieur à 0', true); return; }
      store.setGoal(CUR_YEAR, v).then(function () { state.goal = v; state.ui.editGoal = false; render(); })
        .catch(function (err) { toast('Objectif non enregistré : ' + (err.message || err), true); });
    },
    tonight: function (f) {
      var min = parseInt(f.querySelector('#tonight-min').value, 10) || 90;
      state.ui.tonightMin = min;
      var cands = state.entries.filter(function (e) { return e.media_type === 'movie' && e.status === 'a_voir' && e.runtime && e.runtime <= min; });
      state.ui.tonight = cands.length ? { id: cands[Math.floor(Math.random() * cands.length)].id } : { none: true, min: min };
      render();
    },
    'poster-url': function (f) {
      var m = state.modal;
      var url = f.querySelector('#pf-url').value.trim();
      if (!/^https:\/\/\S+$/.test(url)) { m.err = 'Colle une adresse qui commence par https://'; render(); return; }
      var img = new Image();
      img.onload = function () { if (state.modal !== m) return; m.preview = url; m.err = ''; render(); };
      img.onerror = function () { if (state.modal !== m) return; m.err = 'Cette adresse ne mène pas à une image. Essaie « Copier l\'adresse de l\'image » plutôt que l\'adresse de la page.'; render(); };
      img.src = url;
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
          seasons.forEach(function (s) { valid['S' + s.n] = 1; });
          e.episodes = Object.assign({}, e.episodes);
          Object.keys(e.episodes).forEach(function (k) { if (!valid[k]) delete e.episodes[k]; });
        }
        persist(e).then(function () { state.modal = null; toast('Infos mises à jour'); render(); }).catch(function () {});
        return;
      }
      var d = Object.assign({ tmdb_id: newManualId(), media_type: mm.type, poster_path: null, overview: '' }, fields);
      if (m.mode === 'towatch') {
        persist(newEntry(d)).then(function () { state.modal = null; toast('Ajouté à À voir'); render(); }).catch(function () {});
        return;
      }
      m.mode = 'add';
      startForm(m, d);
    },
    'acc-email': function (f) {
      var email = f.querySelector('#acc-email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { accSet('email', '', 'Indique une adresse e-mail valide.'); return; }
      store.updateEmail(email).then(function () {
        accSet('email', 'Presque fini : ouvre le lien de confirmation envoyé par e-mail (vérifie aussi ton ancienne adresse). Le changement sera actif ensuite.');
      }).catch(function (err) { accSet('email', '', authError(err)); });
    },
    'acc-pw': function (f) {
      var p1 = f.querySelector('#acc-pw1').value, p2 = f.querySelector('#acc-pw2').value;
      if (p1.length < 6) { accSet('pw', '', 'Le mot de passe doit faire au moins 6 caractères.'); return; }
      if (p1 !== p2) { accSet('pw', '', 'Les deux mots de passe ne sont pas identiques.'); return; }
      store.updatePassword(p1).then(function () { f.reset(); accSet('pw', 'Mot de passe changé.'); })
        .catch(function (err) { accSet('pw', '', authError(err)); });
    },
    'acc-goal': function (f) {
      var v = parseInt(f.querySelector('#acc-goal').value, 10);
      if (!v || v < 1) { accSet('goal', '', 'Indique un nombre de films supérieur à 0.'); return; }
      store.setGoal(CUR_YEAR, v).then(function () { state.goal = v; accSet('goal', 'Objectif enregistré : ' + v + ' films en ' + CUR_YEAR + '.'); })
        .catch(function (err) { accSet('goal', '', 'Objectif non enregistré : ' + (err.message || err)); });
    },
    'acc-clear': function (f) {
      if (f.querySelector('#acc-clear').value.trim().toUpperCase() !== 'VIDER') { accSet('clear', '', 'Tape VIDER dans le champ pour confirmer.'); return; }
      store.deleteAll().then(function () {
        state.entries = []; state.goal = null; state.details = {};
        accSet('clear', 'Ton journal a été vidé.');
      }).catch(function (err) { accSet('clear', '', 'Impossible de vider le journal : ' + (err.message || err)); });
    },
    'acc-delete': function (f) {
      if (f.querySelector('#acc-delete').value.trim().toUpperCase() !== 'SUPPRIMER') { accSet('delete', '', 'Tape SUPPRIMER dans le champ pour confirmer.'); return; }
      store.deleteAccount().then(function () {
        state.ui.auth = { mode: 'login', msg: 'Ton compte et toutes tes données ont été supprimés.', err: '', busy: false };
        render();
      }).catch(function (err) {
        var msg = (err && err.message) || String(err);
        if (/delete_user|function|schema cache|does not exist/i.test(msg)) {
          msg = 'La suppression de compte n\'est pas encore activée sur ce site : il faut coller le fichier supprimer-compte.sql dans Supabase (SQL Editor).';
        }
        accSet('delete', '', msg);
      });
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
    'm-year': function (t) { state.modal.form.year = t.value; },
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
    'stats-year': function (t) { state.ui.statsYear = t.value === 'all' ? 'all' : parseInt(t.value, 10); render(); },
    'm-season': function (t) { state.modal.form.season = parseInt(t.value, 10); state.modal.form.current = false; render(); },
    'm-current': function (t) { state.modal.form.current = t.checked; },
    'm-rewatch': function (t) { state.modal.form.rewatch = t.checked; },
    'pf-file': function (t) {
      var m = state.modal; if (!m) return;
      var file = t.files && t.files[0]; if (!file) return;
      m.busy = true; m.err = ''; render();
      resizeImage(file).then(function (data) {
        if (state.modal !== m) return;
        m.preview = data; m.busy = false; render();
      }).catch(function (err) {
        if (state.modal !== m) return;
        m.busy = false; m.err = err.message; render();
      });
    }
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
    return Promise.all([store.listEntries(), store.getGoal(CUR_YEAR)]).then(function (res) {
      state.entries = res[0].map(normalizeEntry);
      state.goal = res[1];
      state.ready = true;
      if (/access_token|type=recovery|error_description/.test(location.hash)) {
        history.replaceState(null, '', location.pathname + location.search + '#journal');
      }
      state.route = parseRoute();
      render();
      // Séries enregistrées avec l'ancien suivi épisode par épisode : on enregistre la conversion en saisons
      state.entries.filter(function (e) { return e._migrated; }).reduce(function (p, e) {
        return p.then(function () { return persist(e).catch(function () {}); });
      }, Promise.resolve()).then(function () { render(); });
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
      if (event === 'USER_UPDATED') { render(); return; }
      loadData();
    });
    return loadData();
  }).catch(function (err) {
    app.innerHTML = '<main class="wrap"><div class="empty" style="margin-top:40px"><span class="h2 display">.Connexion impossible</span>' +
      '<p style="margin:0">Le site n\'arrive pas à joindre Supabase. Vérifie SUPABASE_URL et SUPABASE_ANON_KEY dans config.js.</p>' +
      '<p class="muted" style="margin:0">' + esc(err && err.message ? err.message : err) + '</p></div></main>';
  });
})();
