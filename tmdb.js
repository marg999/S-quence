/*
 * Séquence — catalogue de films et séries.
 *
 * Sans clé TMDB (par défaut) :
 *   - films  : Wikidata (la base de Wikipédia, en français, sans compte)
 *              + affiches des articles Wikipédia
 *   - séries : TVmaze (sans compte, infos en anglais)
 * Avec une clé TMDB dans config.js : TMDB pour tout.
 * En mode démo (sans Supabase) : catalogue d'exemple si le réseau ne répond pas.
 *
 * Recommandations : liste de rangées { key, title, items }
 *   films  : la saga (dans l'ordre), du même réalisateur, du même genre
 *   séries : du même créateur, du même genre
 */
(function () {
  'use strict';

  var cfg = window.SEQUENCE_CONFIG || {};
  var token = String(cfg.TMDB_TOKEN || '').trim();
  var cache = {};

  function yearOf(d) { return d ? (parseInt(String(d).replace(/^\+/, '').slice(0, 4), 10) || null) : null; }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function getJSON(url, opts) {
    return Promise.resolve().then(function () { return fetch(url, opts); }).then(function (r) {
      if (!r.ok) throw new Error('Le service a répondu ' + r.status);
      return r.json();
    });
  }
  function isDemo() { return !!(window.SequenceStore && window.SequenceStore.demo); }
  function uniq(list) { var out = []; list.forEach(function (x) { if (x && out.indexOf(x) === -1) out.push(x); }); return out; }

  /* ======================= TMDB (si clé) ======================= */
  var TMDB_BASE = 'https://api.themoviedb.org/3';
  var TMDB_IMG = 'https://image.tmdb.org/t/p/';
  function tmdbGet(path, params) {
    return Promise.resolve().then(function () {
      var u = new URL(TMDB_BASE + path);
      u.searchParams.set('language', 'fr-FR');
      Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]); });
      var headers = { accept: 'application/json' };
      if (token.length > 40) headers.Authorization = 'Bearer ' + token;
      else u.searchParams.set('api_key', token);
      return getJSON(u.toString(), { headers: headers });
    });
  }
  function tmdbBrief(x, type) {
    return { tmdb_id: x.id, media_type: type || x.media_type, title: x.title || x.name || '',
      year: yearOf(x.release_date || x.first_air_date), poster_path: x.poster_path || null, overview: x.overview || '' };
  }
  var tmdb = {
    search: function (q) {
      return tmdbGet('/search/multi', { query: q, include_adult: 'false' }).then(function (d) {
        return (d.results || []).filter(function (x) { return x.media_type === 'movie' || x.media_type === 'tv'; })
          .slice(0, 12).map(function (x) { return tmdbBrief(x); });
      });
    },
    details: function (type, id) {
      if (type === 'movie') {
        return tmdbGet('/movie/' + id, { append_to_response: 'credits,recommendations' }).then(function (d) {
          var crew = (d.credits && d.credits.crew) || [];
          var out = tmdbBrief(d, 'movie');
          out.runtime = d.runtime || null;
          out.ep_runtime = null;
          out.genres = (d.genres || []).map(function (g) { return g.name; });
          out.director = crew.filter(function (c) { return c.job === 'Director'; }).map(function (c) { return c.name; }).join(', ');
          out.seasons = [];
          out.saga = d.belongs_to_collection ? { id: 'c' + d.belongs_to_collection.id, label: d.belongs_to_collection.name, order: null } : null;
          out.recommendations = ((d.recommendations && d.recommendations.results) || []).slice(0, 6).map(function (x) { return tmdbBrief(x, 'movie'); });
          return out;
        });
      }
      return tmdbGet('/tv/' + id, { append_to_response: 'recommendations' }).then(function (d) {
        var out = tmdbBrief(d, 'tv');
        out.runtime = null;
        out.ep_runtime = (d.episode_run_time && d.episode_run_time[0]) || (d.last_episode_to_air && d.last_episode_to_air.runtime) || 45;
        out.genres = (d.genres || []).map(function (g) { return g.name; });
        out.director = (d.created_by || []).map(function (c) { return c.name; }).join(', ');
        out.seasons = (d.seasons || []).filter(function (s) { return s.season_number > 0 && s.episode_count > 0; })
          .map(function (s) { return { n: s.season_number, count: s.episode_count }; });
        out.saga = null;
        out.recommendations = ((d.recommendations && d.recommendations.results) || []).slice(0, 6).map(function (x) { return tmdbBrief(x, 'tv'); });
        return out;
      });
    },
    recommend: function (d) {
      var sagaP = d.saga
        ? tmdbGet('/collection/' + String(d.saga.id).slice(1)).then(function (c) {
          return (c.parts || []).map(function (x) { var b = tmdbBrief(x, 'movie'); b.current = x.id === d.tmdb_id; return b; })
            .sort(function (a, b) { return (a.year || 9999) - (b.year || 9999); });
        }).catch(function () { return []; })
        : Promise.resolve([]);
      return sagaP.then(function (saga) {
        var groups = [];
        if (saga.length > 1) groups.push({ key: 'saga', title: 'La saga · ' + d.saga.label, items: saga });
        groups.push({ key: 'similar', title: 'Recommandés', items: d.recommendations || [] });
        groups.push({ key: 'genre', title: 'Du même genre', items: [] });
        return groups;
      });
    }
  };

  /* ======================= Wikidata (films) ======================= */
  var WD = 'https://www.wikidata.org/w/api.php';
  // Classes « film » : film, long métrage, film d'animation, court métrage, documentaire, téléfilm, long métrage d'animation
  var FILM_CLASSES = { Q11424: 1, Q24869: 1, Q202866: 1, Q24862: 1, Q93204: 1, Q506240: 1, Q29168811: 1 };
  var FILMQ = ' haswbstatement:P31=Q11424|P31=Q24869|P31=Q202866|P31=Q93204';
  var GENRE_FIX = { 'dramatique': 'Drame', 'comique': 'Comédie', 'comédie dramatique': 'Comédie dramatique', 'policier': 'Policier',
    'd\'animation': 'Animation', 'd\'horreur': 'Horreur', 'd\'action': 'Action', 'd\'aventure': 'Aventure', 'de guerre': 'Guerre',
    'biographique': 'Biographie', 'historique': 'Histoire', 'musical': 'Musical', 'documentaire': 'Documentaire', 'romantique': 'Romance' };

  function wdURL(params) {
    var u = new URL(WD);
    Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); });
    u.searchParams.set('format', 'json');
    u.searchParams.set('origin', '*');
    return u.toString();
  }
  function claims(ent, prop) {
    return ((ent && ent.claims && ent.claims[prop]) || [])
      .filter(function (c) { return c.rank !== 'deprecated' && c.mainsnak && c.mainsnak.datavalue; });
  }
  function claimValues(ent, prop) { return claims(ent, prop).map(function (c) { return c.mainsnak.datavalue.value; }); }
  function label(ent) {
    var l = ent && ent.labels ? (ent.labels.fr || ent.labels.en) : null;
    if (l) return l.value;
    if (ent && ent.labels) { var k = Object.keys(ent.labels)[0]; if (k) return ent.labels[k].value; }
    return '';
  }
  function isFilm(ent) { return claimValues(ent, 'P31').some(function (v) { return v && FILM_CLASSES[v.id]; }); }
  function filmYear(ent) {
    var years = claimValues(ent, 'P577').map(function (v) { return yearOf(v.time); }).filter(Boolean);
    return years.length ? Math.min.apply(null, years) : null;
  }
  function filmRuntime(ent) {
    var v = claimValues(ent, 'P2047')[0];
    if (!v) return null;
    var n = parseFloat(v.amount);
    if (!n) return null;
    if (/Q11574$/.test(v.unit)) n = n / 60;       // secondes
    else if (/Q25235$/.test(v.unit)) n = n * 60;  // heures
    return Math.round(n);
  }
  // Position du film dans sa saga (qualificatif « numéro dans la série »)
  function sagaOrder(ent, sagaId) {
    var cs = claims(ent, 'P179');
    for (var i = 0; i < cs.length; i++) {
      if (cs[i].mainsnak.datavalue.value.id !== sagaId) continue;
      var q = cs[i].qualifiers && cs[i].qualifiers.P1545;
      if (q && q[0] && q[0].datavalue) return parseFloat(q[0].datavalue.value) || null;
    }
    return null;
  }
  function commons(f) { return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(f) + '?width=342'; }

  function getEntities(ids, props) {
    if (!ids.length) return Promise.resolve({});
    var chunks = [];
    for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    return Promise.all(chunks.map(function (chunk) {
      var params = { action: 'wbgetentities', ids: chunk.join('|'), props: props, languages: 'fr|en' };
      if (props.indexOf('sitelinks') !== -1 && props.indexOf('sitelinks/all') === -1) params.sitefilter = 'enwiki|frwiki';
      params.props = props.replace('sitelinks/all', 'sitelinks');
      return getJSON(wdURL(params)).then(function (d) { return d.entities || {}; });
    })).then(function (parts) { return Object.assign.apply(null, [{}].concat(parts)); });
  }
  function searchIds(srsearch, limit) {
    return getJSON(wdURL({ action: 'query', list: 'search', srlimit: String(limit || 20), srsearch: srsearch }))
      .then(function (r) { return ((r.query && r.query.search) || []).map(function (x) { return x.title; }); })
      .catch(function () { return []; });
  }
  function cleanGenre(s) {
    var raw = String(s || '');
    var g = raw.replace(/^film\s+/i, '').replace(/^de\s+(?=[a-z])/i, '').trim();
    var low = g.toLowerCase();
    if (GENRE_FIX[low]) return GENRE_FIX[low];
    var alt = raw.toLowerCase().replace(/^film\s+/, '');
    if (GENRE_FIX[alt]) return GENRE_FIX[alt];
    return g ? g.charAt(0).toUpperCase() + g.slice(1) : '';
  }

  /* Affiche de l'article Wikipédia du film (anglais d'abord, puis français) */
  function pageImages(lang, titles) {
    if (!titles.length) return Promise.resolve({});
    var u = new URL('https://' + lang + '.wikipedia.org/w/api.php');
    var params = { action: 'query', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '342', pilicense: 'any',
      redirects: '1', titles: titles.slice(0, 50).join('|'), format: 'json', origin: '*' };
    Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); });
    return getJSON(u.toString()).then(function (d) {
      var q = d.query || {}, alias = {}, out = {}, byTitle = {};
      (q.normalized || []).concat(q.redirects || []).forEach(function (x) { alias[x.from] = x.to; });
      Object.keys(q.pages || {}).forEach(function (k) {
        var p = q.pages[k];
        if (p.thumbnail && p.thumbnail.source) byTitle[p.title] = p.thumbnail.source;
      });
      titles.forEach(function (t) {
        var final = t, guard = 0;
        while (alias[final] && guard++ < 3) final = alias[final];
        if (byTitle[final]) out[t] = byTitle[final];
      });
      return out;
    }).catch(function () { return {}; });
  }
  // { Qid: url } — préférence : affiche Wikidata, Wikipédia anglais, Wikipédia français, image Wikidata
  function filmPosters(ents) {
    var result = {}, en = [], fr = [];
    ents.forEach(function (ent) {
      var poster = claimValues(ent, 'P3383')[0];
      if (poster) { result[ent.id] = commons(poster); return; }
      var sl = ent.sitelinks || {};
      if (sl.enwiki) en.push(ent);
      else if (sl.frwiki) fr.push(ent);
    });
    return pageImages('en', en.map(function (e) { return e.sitelinks.enwiki.title; })).then(function (found) {
      en.forEach(function (ent) {
        var url = found[ent.sitelinks.enwiki.title];
        if (url) result[ent.id] = url;
        else if (ent.sitelinks.frwiki) fr.push(ent);
      });
      return pageImages('fr', fr.map(function (e) { return e.sitelinks.frwiki.title; }));
    }).then(function (found) {
      fr.forEach(function (ent) { var url = found[ent.sitelinks.frwiki.title]; if (url) result[ent.id] = url; });
      ents.forEach(function (ent) {
        if (!result[ent.id]) { var img = claimValues(ent, 'P18')[0]; if (img) result[ent.id] = commons(img); }
      });
      return result;
    });
  }

  var wikidata = {
    search: function (q) {
      var bySearch = getJSON(wdURL({ action: 'wbsearchentities', search: q, language: 'fr', uselang: 'fr', type: 'item', limit: '30' }))
        .then(function (d) { return (d.search || []).map(function (x) { return x.id; }); })
        .catch(function () { return null; });
      var byText = getJSON(wdURL({ action: 'query', list: 'search', srlimit: '15',
        srsearch: q + ' haswbstatement:P31=Q11424|P31=Q24869|P31=Q202866|P31=Q24862|P31=Q93204|P31=Q506240' }))
        .then(function (d) { return ((d.query && d.query.search) || []).map(function (x) { return x.title; }); })
        .catch(function () { return null; });
      return Promise.all([bySearch, byText]).then(function (res) {
        if (res[0] === null && res[1] === null) throw new Error('Wikidata ne répond pas.');
        var ids = uniq((res[0] || []).concat(res[1] || []).filter(function (id) { return /^Q\d+$/.test(id); }));
        if (!ids.length) return [];
        return getEntities(ids, 'labels|descriptions|claims|sitelinks').then(function (ents) {
          var films = ids.map(function (id) { return ents[id]; })
            .filter(function (ent) { return ent && !ent.missing && isFilm(ent); })
            .slice(0, 10);
          return filmPosters(films).then(function (posters) {
            return films.map(function (ent) {
              var desc = ent.descriptions ? (ent.descriptions.fr || ent.descriptions.en) : null;
              return { tmdb_id: parseInt(ent.id.slice(1), 10), media_type: 'movie', title: label(ent),
                year: filmYear(ent), poster_path: posters[ent.id] || null, overview: desc ? desc.value : '' };
            });
          });
        });
      });
    },

    details: function (id) {
      var qid = 'Q' + id;
      return getEntities([qid], 'labels|descriptions|claims|sitelinks').then(function (ents) {
        var ent = ents[qid];
        if (!ent || ent.missing) throw new Error('Film introuvable sur Wikidata.');
        var dirIds = claimValues(ent, 'P57').map(function (v) { return v.id; }).filter(Boolean).slice(0, 4);
        var genreIds = claimValues(ent, 'P136').map(function (v) { return v.id; }).filter(Boolean).slice(0, 6);
        var sagaId = (claimValues(ent, 'P179')[0] || {}).id || null;
        var labels = getEntities(dirIds.concat(genreIds).concat(sagaId ? [sagaId] : []), 'labels').catch(function () { return {}; });
        var posters = filmPosters([ent]).catch(function () { return {}; });
        return Promise.all([labels, posters]).then(function (res) {
          var more = res[0];
          var desc = ent.descriptions ? (ent.descriptions.fr || ent.descriptions.en) : null;
          var genres = [];
          genreIds.forEach(function (g) { var c = cleanGenre(label(more[g])); if (c && genres.indexOf(c) === -1) genres.push(c); });
          var sagaLabel = sagaId ? label(more[sagaId]).replace(/\s*\((série de films|film series|saga)\)\s*$/i, '') : '';
          return {
            tmdb_id: id, media_type: 'movie', title: label(ent), year: filmYear(ent), poster_path: res[1][qid] || null,
            overview: desc ? desc.value.charAt(0).toUpperCase() + desc.value.slice(1) + '.' : '',
            runtime: filmRuntime(ent), ep_runtime: null, genres: genres,
            director: dirIds.map(function (d) { return label(more[d]); }).filter(Boolean).join(', '),
            seasons: [],
            saga: sagaId ? { id: sagaId, label: sagaLabel || 'Saga', order: sagaOrder(ent, sagaId) } : null,
            _directorIds: dirIds,
            _genreIds: genreIds,
            _prev: claimValues(ent, 'P155').map(function (v) { return v.id; }).filter(Boolean),
            _next: claimValues(ent, 'P156').map(function (v) { return v.id; }).filter(Boolean)
          };
        });
      });
    },

    recommend: function (d) {
      var self = 'Q' + d.tmdb_id;
      var sagaP = d.saga ? searchIds('haswbstatement:P179=' + d.saga.id, 30)
        : Promise.resolve((d._prev || []).concat(d._next || []));
      var dir = (d._directorIds || [])[0];
      var dirP = dir ? searchIds('haswbstatement:P57=' + dir + FILMQ, 20) : Promise.resolve([]);
      var genre = (d._genreIds || [])[0];
      var genP = genre ? searchIds('haswbstatement:P136=' + genre + FILMQ, 40) : Promise.resolve([]);
      return Promise.all([sagaP, dirP, genP]).then(function (res) {
        var sg = res[0], dr = res[1], gn = res[2];
        var all = uniq([self].concat(sg, dr, gn).filter(function (q) { return /^Q\d+$/.test(q); })).slice(0, 100);
        return getEntities(all, 'labels|claims|sitelinks/all').then(function (ents) {
          function ok(q) { var e = ents[q]; return e && !e.missing && label(e) && isFilm(e); }
          function item(q, extra) {
            var e = ents[q];
            return Object.assign({ tmdb_id: parseInt(q.slice(1), 10), media_type: 'movie', title: label(e), year: filmYear(e) }, extra || {});
          }
          var used = {};
          var saga = uniq(sg.concat(sg.length ? [self] : [])).filter(ok).map(function (q) {
            return item(q, { order: d.saga ? sagaOrder(ents[q], d.saga.id) : null, current: q === self });
          });
          saga.sort(function (a, b) {
            if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order;
            return (a.year || 9999) - (b.year || 9999);
          });
          if (saga.length < 2) saga = [];
          used[self] = 1;
          saga.forEach(function (x) { used['Q' + x.tmdb_id] = 1; });
          var director = uniq(dr).filter(function (q) { return !used[q] && ok(q); }).map(function (q) { return item(q); })
            .sort(function (a, b) { return (b.year || 0) - (a.year || 0); }).slice(0, 6);
          director.forEach(function (x) { used['Q' + x.tmdb_id] = 1; });
          var genreItems = uniq(gn).filter(function (q) { return !used[q] && ok(q); })
            .map(function (q) { return { it: item(q), pop: Object.keys(ents[q].sitelinks || {}).length }; })
            .sort(function (a, b) { return b.pop - a.pop; }).slice(0, 6).map(function (x) { return x.it; });
          var groups = [];
          if (saga.length) groups.push({ key: 'saga', title: 'La saga' + (d.saga ? ' · ' + d.saga.label : ''), items: saga });
          if (director.length) groups.push({ key: 'director', title: 'Du même réalisateur', items: director });
          groups.push({ key: 'genre', title: 'Du même genre' + (d.genres && d.genres[0] ? ' · ' + d.genres[0] : ''), items: genreItems });
          return groups;
        });
      });
    }
  };

  /* ======================= TVmaze (séries) ======================= */
  var TVM = 'https://api.tvmaze.com';
  var TV_GENRES = { Drama: 'Drame', Comedy: 'Comédie', 'Science-Fiction': 'Science-Fiction', Crime: 'Crime', Thriller: 'Thriller',
    Action: 'Action', Adventure: 'Aventure', Romance: 'Romance', Horror: 'Horreur', Mystery: 'Mystère', Fantasy: 'Fantastique',
    Family: 'Famille', Anime: 'Anime', War: 'Guerre', History: 'Histoire', Music: 'Musique', Western: 'Western',
    Supernatural: 'Surnaturel', Medical: 'Médical', Legal: 'Judiciaire', Sports: 'Sport', Children: 'Enfants',
    Espionage: 'Espionnage', Food: 'Cuisine', Nature: 'Nature', Travel: 'Voyage', Adult: 'Adulte' };
  function stripHTML(s) {
    var d = document.createElement('div');
    d.innerHTML = String(s || '');
    return (d.textContent || '').trim();
  }
  function tvBrief(show) {
    return { tmdb_id: show.id, media_type: 'tv', title: show.name || '', year: yearOf(show.premiered),
      poster_path: show.image ? (show.image.medium || show.image.original) : null, overview: stripHTML(show.summary) };
  }
  var tvmaze = {
    search: function (q) {
      return getJSON(TVM + '/search/shows?q=' + encodeURIComponent(q)).then(function (res) {
        return (res || []).slice(0, 8).map(function (r) { return tvBrief(r.show); });
      });
    },
    details: function (id) {
      var show = getJSON(TVM + '/shows/' + encodeURIComponent(id) + '?embed=episodes');
      var crew = getJSON(TVM + '/shows/' + encodeURIComponent(id) + '/crew').catch(function () { return []; });
      return Promise.all([show, crew]).then(function (res) {
        var s = res[0];
        var eps = (s._embedded && s._embedded.episodes) || [];
        var counts = {};
        eps.forEach(function (e) {
          if (e.number == null || e.season == null || e.season < 1) return; // épisodes spéciaux ignorés
          counts[e.season] = Math.max(counts[e.season] || 0, e.number);
        });
        var out = tvBrief(s);
        out.runtime = null;
        out.ep_runtime = s.averageRuntime || s.runtime || 45;
        out.genres = (s.genres || []).map(function (g) { return TV_GENRES[g] || g; });
        var creators = (res[1] || []).filter(function (c) { return c.type === 'Creator' && c.person; }).slice(0, 3);
        out.director = creators.map(function (c) { return c.person.name; }).filter(Boolean).join(', ');
        out._creatorIds = creators.map(function (c) { return c.person.id; }).filter(Boolean);
        out.seasons = Object.keys(counts).map(function (n) { return { n: parseInt(n, 10), count: counts[n] }; })
          .sort(function (a, b) { return a.n - b.n; });
        out.saga = null;
        return out;
      });
    },
    recommend: function (d) {
      var pids = (d._creatorIds || []).slice(0, 2);
      var p = !pids.length ? Promise.resolve([]) : Promise.all(pids.map(function (pid) {
        return getJSON(TVM + '/people/' + encodeURIComponent(pid) + '/crewcredits?embed=show').catch(function () { return []; });
      })).then(function (lists) {
        var seen = {}, out = [];
        seen[d.tmdb_id] = 1;
        lists.forEach(function (l) {
          (l || []).forEach(function (c) {
            var s = c && c._embedded && c._embedded.show;
            if (!s || seen[s.id]) return;
            seen[s.id] = 1;
            out.push(tvBrief(s));
          });
        });
        return out.sort(function (a, b) { return (b.year || 0) - (a.year || 0); }).slice(0, 6);
      });
      return p.then(function (creator) {
        var groups = [];
        if (creator.length) groups.push({ key: 'creator', title: 'Du même créateur', items: creator });
        groups.push({ key: 'genre', title: 'Du même genre' + (d.genres && d.genres[0] ? ' · ' + d.genres[0] : ''), items: [] });
        return groups;
      });
    }
  };

  /* ======================= Interface commune ======================= */
  function rankMerge(q, films, shows) {
    var n = norm(q);
    function score(r) { var t = norm(r.title); return t === n ? 0 : t.indexOf(n) === 0 ? 1 : 2; }
    var all = films.map(function (r, i) { return { r: r, s: score(r), i: i }; })
      .concat(shows.map(function (r, i) { return { r: r, s: score(r), i: i + 0.5 }; }));
    all.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return all.map(function (x) { return x.r; }).slice(0, 14);
  }

  window.TMDB = {
    enabled: !!token,
    source: token ? 'tmdb' : 'libre',

    img: function (path, size) {
      if (!path) return null;
      if (/^(https?:\/\/|data:image\/)/.test(path)) return path;
      return token ? TMDB_IMG + (size || 'w342') + path : null;
    },

    hint: function () {
      return token ? 'Tape le titre d\'un film ou d\'une série.'
        : 'Tape le titre d\'un film ou d\'une série. Films : Wikidata, en français. Séries : TVmaze, en anglais.';
    },

    creditHTML: function () {
      if (token) {
        return 'Données et images : <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. ' +
          'This product uses the TMDB API but is not endorsed or certified by TMDB.';
      }
      return 'Films : <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> (CC0) et Wikipédia. ' +
        'Séries : <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a> (CC BY-SA).';
    },

    search: function (q) {
      if (!String(q || '').trim()) return Promise.resolve([]);
      var p;
      if (token) p = tmdb.search(q);
      else {
        var films = wikidata.search(q).catch(function () { return null; });
        var shows = tvmaze.search(q).catch(function () { return null; });
        p = Promise.all([films, shows]).then(function (res) {
          if (res[0] === null && res[1] === null) throw new Error('Les catalogues de films et séries ne répondent pas. Vérifie ta connexion et réessaie.');
          return rankMerge(q, res[0] || [], res[1] || []);
        });
      }
      return p.catch(function (err) {
        if (isDemo()) return window.SEQUENCE_DEMO.search(q);
        throw err;
      });
    },

    details: function (type, id) {
      var k = type + '-' + id;
      if (cache[k]) return Promise.resolve(cache[k]);
      if (isDemo()) {
        var demo = window.SEQUENCE_DEMO.details(type, id);
        if (demo) { cache[k] = demo; return Promise.resolve(demo); }
      }
      var p = token ? tmdb.details(type, id) : (type === 'movie' ? wikidata.details(id) : tvmaze.details(id));
      return p.then(function (out) { cache[k] = out; return out; });
    },

    // Renvoie toujours une liste de rangées (éventuellement vides), jamais d'erreur
    recommend: function (d) {
      if (!d) return Promise.resolve([]);
      if (isDemo() && window.SEQUENCE_DEMO.details(d.media_type, d.tmdb_id)) return Promise.resolve(window.SEQUENCE_DEMO.recommend(d));
      var p = token ? tmdb.recommend(d) : (d.media_type === 'movie' ? wikidata.recommend(d) : tvmaze.recommend(d));
      return p.catch(function () { return []; });
    }
  };
})();
