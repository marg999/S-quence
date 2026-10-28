/*
 * Séquence — réglages
 *
 * Laisse les trois valeurs vides pour tester le site en « mode démo » :
 * les données restent dans ton navigateur et la recherche utilise
 * un petit catalogue d'exemple.
 *
 * Pour la vraie version :
 *  - SUPABASE_URL et SUPABASE_ANON_KEY : Supabase > Project Settings > API
 *    (la clé "anon public", jamais la clé "service_role").
 *  - TMDB_TOKEN : themoviedb.org > Paramètres > API > "Jeton d'accès en lecture"
 *    (ou la "Clé d'API" courte, les deux fonctionnent).
 *
 * Ces clés sont publiques par nature (elles sont lues par le navigateur).
 * La sécurité des données est assurée par les règles du fichier supabase/schema.sql.
 */
window.SEQUENCE_CONFIG = {
  SUPABASE_URL: 'https://tahxrwvbeoupwkgpnvdw.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhaHhyd3ZiZW91cHdrZ3BudmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxOTM1NDcsImV4cCI6MjEwODc2OTU0N30.cDKq1oFVLRgKOCwJcafdPaiI2PGTKR2cfND9PsBI878',
  TMDB_TOKEN: ''
     , PARAGRAPHE_URL: 'https://marg999.github.io/Paragraphe/'
};
