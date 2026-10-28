/*
 * Séquence — recherche de films et séries avec l'API TMDB.
 * Sans clé, utilise le catalogue d'exemple (mode démo).
 */
(function () {
  'use strict';

  var cfg = window.SEQUENCE_CONFIG || {};
  var token = String(cfg.TMDB_TOKEN || '').trim();
  var BASE = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';
  var cache = {};

  function get(path, params) {
    var u = new URL(BASE + path);
    u.searchParams.set('language', 'fr-FR');
    Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]); });
    var headers = { accept: 'application/json' };
    // Jeton d'accès long (v4) → en-tête ; clé courte (v3) → paramètre
    if (token.length > 40) headers.Authorization = 'Bearer ' + token;
    else u.searchParams.set('api_key', token);
    return fetch(u.toString(), { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('TMDB a répondu ' + r.status);
      return r.json();
    });
  }

  function yearOf(d) {
    return d ? (parseInt(String(d).slice(0, 4), 10) || null) : null;
  }

  function brief(x, type) {
    return {
      tmdb_id: x.id,
      media_type: type || x.media_type,
      title: x.title || x.name || '',
      year: yearOf(x.release_date || x.first_air_date),
      poster_path: x.poster_path || null,
      overview: x.overview || ''
    };
  }

  window.TMDB = {
    enabled: !!token,

    img: function (path, size) {
      return path && token ? IMG + (size || 'w342') + path : null;
    },

    search: function (q) {
      if (!String(q || '').trim()) return Promise.resolve([]);
      if (!token) return Promise.resolve(window.SEQUENCE_DEMO.search(q));
      return get('/search/multi', { query: q, include_adult: 'false' }).then(function (d) {
        return (d.results || [])
          .filter(function (x) { return x.media_type === 'movie' || x.media_type === 'tv'; })
          .slice(0, 12)
          .map(function (x) { return brief(x); });
      });
    },

    details: function (type, id) {
      var key = type + '-' + id;
      if (cache[key]) return Promise.resolve(cache[key]);
      var p;
      if (!token) {
        var demo = window.SEQUENCE_DEMO.details(type, id);
        p = demo ? Promise.resolve(demo) : Promise.reject(new Error('Titre introuvable dans le catalogue de démo.'));
      } else if (type === 'movie') {
        p = get('/movie/' + id, { append_to_response: 'credits,recommendations' }).then(function (d) {
          var crew = (d.credits && d.credits.crew) || [];
          var dirs = crew.filter(function (c) { return c.job === 'Director'; }).map(function (c) { return c.name; });
          var out = brief(d, 'movie');
          out.runtime = d.runtime || null;
          out.ep_runtime = null;
          out.genres = (d.genres || []).map(function (g) { return g.name; });
          out.director = dirs.join(', ');
          out.seasons = [];
          out.recommendations = ((d.recommendations && d.recommendations.results) || []).slice(0, 6)
            .map(function (x) { return brief(x, 'movie'); });
          return out;
        });
      } else {
        p = get('/tv/' + id, { append_to_response: 'recommendations' }).then(function (d) {
          var out = brief(d, 'tv');
          out.runtime = null;
          out.ep_runtime = (d.episode_run_time && d.episode_run_time[0]) ||
            (d.last_episode_to_air && d.last_episode_to_air.runtime) || 45;
          out.genres = (d.genres || []).map(function (g) { return g.name; });
          out.director = (d.created_by || []).map(function (c) { return c.name; }).join(', ');
          out.seasons = (d.seasons || [])
            .filter(function (s) { return s.season_number > 0 && s.episode_count > 0; })
            .map(function (s) { return { n: s.season_number, count: s.episode_count }; });
          out.recommendations = ((d.recommendations && d.recommendations.results) || []).slice(0, 6)
            .map(function (x) { return brief(x, 'tv'); });
          return out;
        });
      }
      return p.then(function (out) { cache[key] = out; return out; });
    }
  };
})();
