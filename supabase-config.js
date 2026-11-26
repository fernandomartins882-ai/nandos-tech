// Configuração pública do Supabase para o Nandos Tech.
// A publishable key é destinada ao uso no navegador.
// A segurança dos dados depende das políticas RLS e das funções RPC no banco.
const SUPABASE_URL = "https://fsqiwclwudgtmcfpgyuk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tRyB9Ooxd17FXcpjd_-a5w_emjNPOJh";

if (!window.supabase?.createClient) {
  throw new Error("Biblioteca do Supabase não foi carregada.");
}

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
