/*
 * Séquence — sauvegarde des données.
 * Deux versions avec les mêmes fonctions :
 *  - SupabaseStore : comptes + base Supabase (quand config.js est rempli)
 *  - LocalStore    : mode démo, tout reste dans le navigateur
 */
(function () {
  'use strict';

  var cfg = window.SEQUENCE_CONFIG || {};
  var LS_KEY = 'sequence-demo-v1';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
  }
  function readLS() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeLS(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* stockage indisponible */ }
  }

  var LocalStore = {
    demo: true,
    mem: null,
    user: { email: 'mode démo' },
    init: function () {
      this.mem = readLS() || window.SEQUENCE_DEMO.seed();
      writeLS(this.mem);
      return Promise.resolve(this.user);
    },
    onAuth: function () {},
    signUp: function () { return Promise.resolve(); },
    signIn: function () { return Promise.resolve(); },
    signOut: function () { return Promise.resolve(); },
    resetPassword: function () { return Promise.resolve(); },
    updatePassword: function () { return Promise.resolve(); },
    listEntries: function () { return Promise.resolve(clone(this.mem.entries)); },
    saveEntry: function (e) {
      var now = new Date().toISOString();
      var copy = clone(e);
      copy.updated_at = now;
      if (!copy.id) { copy.id = uid(); copy.created_at = now; }
      var i = this.mem.entries.findIndex(function (x) { return x.id === copy.id; });
      if (i >= 0) this.mem.entries[i] = copy; else this.mem.entries.push(copy);
      writeLS(this.mem);
      return Promise.resolve(clone(copy));
    },
    deleteEntry: function (id) {
      this.mem.entries = this.mem.entries.filter(function (x) { return x.id !== id; });
      writeLS(this.mem);
      return Promise.resolve();
    },
    getGoal: function (year) {
      return Promise.resolve((this.mem.goals || {})[year] || null);
    },
    setGoal: function (year, target) {
      this.mem.goals = this.mem.goals || {};
      this.mem.goals[year] = target;
      writeLS(this.mem);
      return Promise.resolve();
    },
    resetDemo: function () {
      this.mem = window.SEQUENCE_DEMO.seed();
      writeLS(this.mem);
      return Promise.resolve();
    }
  };

  var COLS = ['tmdb_id', 'media_type', 'title', 'year', 'poster_path', 'runtime', 'ep_runtime', 'genres',
    'director', 'seasons', 'status', 'notes', 'season_notes', 'per_season', 'avis', 'viewings', 'episodes'];

  function check(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  var SupabaseStore = {
    demo: false,
    client: null,
    user: null,
    init: function () {
      var self = this;
      self.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      return self.client.auth.getSession().then(function (res) {
        self.user = res.data && res.data.session ? res.data.session.user : null;
        return self.user;
      });
    },
    onAuth: function (cb) {
      var self = this;
      self.client.auth.onAuthStateChange(function (event, session) {
        self.user = session ? session.user : null;
        cb(event, self.user);
      });
    },
    redirectUrl: function () { return location.origin + location.pathname; },
    signUp: function (email, password) {
      return this.client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: this.redirectUrl() } }).then(check);
    },
    signIn: function (email, password) {
      return this.client.auth.signInWithPassword({ email: email, password: password }).then(check);
    },
    signOut: function () { return this.client.auth.signOut(); },
    resetPassword: function (email) {
      return this.client.auth.resetPasswordForEmail(email, { redirectTo: this.redirectUrl() }).then(check);
    },
    updatePassword: function (password) {
      return this.client.auth.updateUser({ password: password }).then(check);
    },
    listEntries: function () {
      return this.client.from('entries').select('*').order('updated_at', { ascending: false }).then(check);
    },
    saveEntry: function (e) {
      var row = { user_id: this.user.id, updated_at: new Date().toISOString() };
      COLS.forEach(function (k) { if (e[k] !== undefined) row[k] = e[k]; });
      var q = e.id
        ? this.client.from('entries').update(row).eq('id', e.id).select().single()
        : this.client.from('entries').upsert(row, { onConflict: 'user_id,media_type,tmdb_id' }).select().single();
      return q.then(check);
    },
    deleteEntry: function (id) {
      return this.client.from('entries').delete().eq('id', id).then(check);
    },
    getGoal: function (year) {
      return this.client.from('goals').select('target').eq('year', year).maybeSingle().then(function (res) {
        return res.data ? res.data.target : null;
      });
    },
    setGoal: function (year, target) {
      return this.client.from('goals')
        .upsert({ user_id: this.user.id, year: year, target: target }, { onConflict: 'user_id,year' })
        .then(check);
    }
  };

  var useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  window.SequenceStore = useSupabase ? SupabaseStore : LocalStore;
  window.SequenceUid = uid;
})();
