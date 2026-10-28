/*
 * Séquence — catalogue et journal d'exemple pour le mode démo.
 * Utilisé uniquement quand aucune clé TMDB / Supabase n'est renseignée.
 */
(function () {
  'use strict';

  var CATALOG = [
    { tmdb_id: 693134, media_type: 'movie', title: 'Dune : Deuxième partie', year: 2024, runtime: 166,
      genres: ['Science-Fiction', 'Aventure'], director: 'Denis Villeneuve',
      overview: "Paul Atréides s'allie aux Fremen du désert d'Arrakis pour venger sa famille, tout en redoutant l'avenir qu'il entrevoit." },
    { tmdb_id: 915935, media_type: 'movie', title: "Anatomie d'une chute", year: 2023, runtime: 151,
      genres: ['Drame', 'Thriller'], director: 'Justine Triet',
      overview: "Une romancière est soupçonnée d'avoir tué son mari. Leur fils malvoyant est le seul témoin de ce qui s'est passé au chalet." },
    { tmdb_id: 666277, media_type: 'movie', title: 'Past Lives', year: 2023, runtime: 106,
      genres: ['Drame', 'Romance'], director: 'Celine Song',
      overview: "Deux amis d'enfance séparés en quittant la Corée se retrouvent à New York, vingt ans plus tard." },
    { tmdb_id: 406, media_type: 'movie', title: 'La Haine', year: 1995, runtime: 98,
      genres: ['Drame', 'Crime'], director: 'Mathieu Kassovitz',
      overview: "Vingt-quatre heures dans la vie de trois amis d'une cité de banlieue, au lendemain d'une nuit d'émeutes." },
    { tmdb_id: 329865, media_type: 'movie', title: 'Premier contact', year: 2016, runtime: 116,
      genres: ['Science-Fiction', 'Drame'], director: 'Denis Villeneuve',
      overview: "Une linguiste est chargée de communiquer avec des visiteurs venus d'ailleurs, arrivés à bord de mystérieux vaisseaux." },
    { tmdb_id: 335984, media_type: 'movie', title: 'Blade Runner 2049', year: 2017, runtime: 164,
      genres: ['Science-Fiction', 'Drame'], director: 'Denis Villeneuve',
      overview: "Un blade runner découvre un secret enfoui depuis trente ans, capable de bouleverser ce qu'il reste de la société." },
    { tmdb_id: 900001, media_type: 'movie', title: 'Le Règne animal', year: 2023, runtime: 128,
      genres: ['Science-Fiction', 'Drame'], director: 'Thomas Cailley',
      overview: "Dans un monde où certains humains se transforment peu à peu en animaux, un père part à la recherche de sa femme avec leur fils." },
    { tmdb_id: 531428, media_type: 'movie', title: 'Portrait de la jeune fille en feu', year: 2019, runtime: 122,
      genres: ['Drame', 'Romance'], director: 'Céline Sciamma',
      overview: "Bretagne, XVIIIe siècle. Une peintre doit réaliser en secret le portrait d'une jeune femme promise à un mariage." },
    { tmdb_id: 95396, media_type: 'tv', title: 'Severance', year: 2022, ep_runtime: 50,
      genres: ['Drame', 'Mystère', 'Science-Fiction'], director: 'Dan Erickson',
      seasons: [{ n: 1, count: 9 }, { n: 2, count: 10 }],
      overview: "Des employés acceptent que leur mémoire soit séparée entre leur vie au bureau et leur vie privée." },
    { tmdb_id: 62385, media_type: 'tv', title: 'Le Bureau des légendes', year: 2015, ep_runtime: 52,
      genres: ['Drame', 'Thriller'], director: 'Éric Rochant',
      seasons: [{ n: 1, count: 10 }, { n: 2, count: 10 }, { n: 3, count: 10 }, { n: 4, count: 10 }, { n: 5, count: 10 }],
      overview: "Le quotidien des agents clandestins de la DGSE, envoyés sous une fausse identité dans des pays sensibles." },
    { tmdb_id: 136315, media_type: 'tv', title: 'The Bear', year: 2022, ep_runtime: 32,
      genres: ['Drame', 'Comédie'], director: 'Christopher Storer',
      seasons: [{ n: 1, count: 8 }, { n: 2, count: 10 }],
      overview: "Un jeune chef de la haute gastronomie revient à Chicago pour reprendre la sandwicherie de sa famille." }
  ];

  var RECO = {
    'movie-693134': ['movie-329865', 'movie-335984'],
    'movie-329865': ['movie-693134', 'movie-335984'],
    'movie-335984': ['movie-693134', 'movie-329865'],
    'movie-915935': ['movie-666277', 'movie-531428'],
    'movie-666277': ['movie-531428', 'movie-915935'],
    'movie-531428': ['movie-666277', 'movie-915935'],
    'movie-406': ['movie-915935', 'movie-900001'],
    'movie-900001': ['movie-329865', 'movie-406'],
    'tv-95396': ['tv-62385', 'tv-136315'],
    'tv-62385': ['tv-95396', 'tv-136315'],
    'tv-136315': ['tv-95396', 'tv-62385']
  };

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function find(type, id) {
    for (var i = 0; i < CATALOG.length; i++) {
      if (CATALOG[i].media_type === type && String(CATALOG[i].tmdb_id) === String(id)) return CATALOG[i];
    }
    return null;
  }
  function brief(c) {
    return { tmdb_id: c.tmdb_id, media_type: c.media_type, title: c.title, year: c.year, poster_path: null, overview: c.overview };
  }
  function uid() {
    return 'demo-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  function entryFrom(type, id, extra) {
    var c = find(type, id);
    var e = {
      id: uid(), tmdb_id: c.tmdb_id, media_type: c.media_type, title: c.title, year: c.year,
      poster_path: null, runtime: c.runtime || null, ep_runtime: c.ep_runtime || null,
      genres: c.genres.slice(), director: c.director, seasons: (c.seasons || []).slice(),
      status: 'a_voir', notes: {}, season_notes: {}, per_season: false, avis: '',
      viewings: [], episodes: {}, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z'
    };
    Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function v(date, lieu, version, rewatch, avec) {
    return { id: uid(), date: date, lieu: lieu, version: version, avec: avec || '', rewatch: !!rewatch };
  }
  function eps(map, season, from, to, startDate, stepDays) {
    var d = new Date(startDate + 'T12:00:00');
    for (var e = from; e <= to; e++) {
      map[season + '-' + e] = d.toISOString().slice(0, 10);
      d.setDate(d.getDate() + (stepDays || 1));
    }
    return map;
  }

  window.SEQUENCE_DEMO = {
    search: function (q) {
      var n = norm(q).trim();
      return CATALOG.filter(function (c) { return norm(c.title).indexOf(n) !== -1 || norm(c.director).indexOf(n) !== -1; })
        .map(brief);
    },
    details: function (type, id) {
      var c = find(type, id);
      if (!c) return null;
      var recos = (RECO[type + '-' + id] || []).map(function (k) {
        var p = k.split('-');
        return brief(find(p[0], p[1]));
      });
      return {
        tmdb_id: c.tmdb_id, media_type: c.media_type, title: c.title, year: c.year, poster_path: null,
        overview: c.overview, runtime: c.runtime || null, ep_runtime: c.ep_runtime || null,
        genres: c.genres.slice(), director: c.director, seasons: (c.seasons || []).slice(), recommendations: recos
      };
    },
    seed: function () {
      var sev = eps({}, 1, 1, 9, '2026-09-01', 2);
      eps(sev, 2, 1, 6, '2026-10-05', 3);
      var bdl = eps({}, 1, 1, 10, '2026-03-02', 2);
      eps(bdl, 2, 1, 10, '2026-04-10', 2);
      eps(bdl, 3, 1, 4, '2026-05-20', 3);
      var entries = [
        entryFrom('movie', 693134, {
          viewings: [v('2024-03-02', 'Cinéma', 'VO', false), v('2026-10-26', 'Cinéma', 'VO', true)],
          notes: { gen: 5, sce: 4, rea: 5, act: 4, emo: 4, mus: 5 },
          avis: "Encore plus impressionnant au deuxième visionnage. La scène de l'arène en noir et blanc reste la plus marquante."
        }),
        entryFrom('movie', 915935, { viewings: [v('2026-10-21', 'Streaming', 'VF', false)], notes: { gen: 4, sce: 5, rea: 4, act: 5, emo: 4, mus: 3 } }),
        entryFrom('movie', 666277, { viewings: [v('2026-10-14', 'Streaming', 'VO', false)], notes: { gen: 5, sce: 5, rea: 4, act: 5, emo: 5, mus: 4 } }),
        entryFrom('movie', 406, { viewings: [v('2026-10-02', 'Télé', 'VF', true)], notes: { gen: 4 } }),
        entryFrom('movie', 329865, { viewings: [v('2026-06-12', 'Streaming', 'VO', false)], notes: { gen: 4 } }),
        entryFrom('movie', 335984, { viewings: [v('2026-06-20', 'Streaming', 'VO', false)], notes: { gen: 4 } }),
        entryFrom('tv', 95396, { episodes: sev, season_notes: { 1: 5 }, per_season: true }),
        entryFrom('tv', 62385, { episodes: bdl }),
        entryFrom('movie', 900001, {}),
        entryFrom('tv', 136315, {}),
        entryFrom('movie', 531428, {})
      ];
      return { entries: entries, goals: { 2026: 60 } };
    }
  };
})();
